import { effect, untracked } from '@preact/signals'
import { LAND_COLOR, type LandKind, snapTerrain } from '../core/robotics/terrain'
import { standOnTerrain, turnTerrainPieces } from '../core/robotics/field'
import {
  Box3,
  Color,
  DirectionalLight,
  BufferGeometry,
  EdgesGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineDashedMaterial,
  LineBasicMaterial,
  PlaneGeometry,
  MeshBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  HemisphereLight,
  Matrix4,
  MOUSE,
  Object3D,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  type Box,
  type Doc,
  type DocNode,
  type PrimType,
  type Vec3,
  boxCenter,
  cleanNum,
  cleanVec,
  quatFromRotation,
  unionBoxes
} from '../core/doc/model'
import { type Frame, GROUND, frameFromHit, frameMatrix } from '../core/doc/workplane'
import { type Box2, type Guide, snapToGuides } from '../core/doc/snapping'
import { type DimLabel, dims, sameDims, separateDims } from './dims'
import { type Axis, alignNodes, moveNodes, rotateNodes, setTransform, sizeToScale } from '../core/doc/ops'
import { type AlignDot, AlignTool } from './AlignTool'
import {
  aligning,
  beginGesture,
  cancelGesture,
  commit,
  doc,
  endGesture,
  gridStep,
  inGesture,
  placingRuler,
  placingWorkplane,
  previewGesture,
  refPlanes,
  ruler,
  rulerMode,
  selection,
  workplane
} from '../core/doc/store'
import { geom } from '../core/geom/client'
import { type Key, lang, t } from '../i18n'
import { fmtLen } from '../units'
import { type HandleSpec, Gizmo, worldPerPixel } from './Gizmo'
import { NodeObject, SceneSync, toGeometry } from './SceneSync'
import { CUBE_NORMALS, ViewCube } from './ViewCube'
import { themeId } from '../themes'
import { applyThemeToMaterials, setPrettyMaterials } from './materials'
import { PrettyView } from './PrettyView'
import { MIN_FPS, PRESETS, type Quality, lowerQuality, normView, stepDown } from '../core/robotics/look'
import { THEME } from './theme'
import { Workplane } from './Workplane'
import { RefPlanes } from './RefPlanes'
import { SketchEditor } from './SketchEditor'
import { session, sketchPicking, startSession } from '../core/sketch/session'
import { type PrimNode, type SensorType, isRoboNode } from '../core/doc/model'
import { followId, landBrush, prettyCap, recording, roboticsMode, simActive, simState } from '../core/robotics/state'
import { type Cell, cellAt, lineCells, paintCells, paintLand, rectCells } from '../core/robotics/land'
import { robotSpec } from '../core/robotics/robot'
import { TILE_SIZE } from '../core/robotics/tiles'
import { disposeTree, loadRoboModels, sensorOnPad } from './roboVisuals'

/** the floor of the field (the landscape brush paints cells on it) */
const FLOOR_PLANE = new Plane(new Vector3(0, 0, 1), 0)

type Drag =
  | { type: 'none' }
  | {
      type: 'pending'
      x: number
      y: number
      hitId: string | null
      hitPoint: Vector3 | null
      shift: boolean
      wasSelected: boolean
    }
  | {
      type: 'move'
      plane: Plane
      start: Vector3
      base: Doc
      ids: string[]
      /** selection and other shapes as workplane rectangles, for smart guides */
      moving: Box2
      movingZ: number
      others: Box2[]
    }
  | { type: 'box'; x: number; y: number; shift: boolean }
  | { type: 'scale'; spec: HandleSpec; base: Doc; id: string; ctx: ScaleCtx }
  | { type: 'lift'; base: Doc; ids: string[]; start: Vector3; plane: Plane; normal: Vector3 }
  | {
      type: 'rotate'
      axis: Axis
      axisWorld: Vector3
      base: Doc
      ids: string[]
      center: Vector3
      last: number
      total: number
      start: number
    }

interface ScaleCtx {
  frame: Matrix4
  frameInv: Matrix4
  rot: Quaternion
  geomBox: Box
  scale: Vec3
  lo: Vec3
  hi: Vec3
  plane: Plane
}

/** Where a new shape goes: position and the workplane's rotation. */
export interface Placement {
  position: Vec3
  rotation: Vec3
  /** the same point in workplane coordinates (for labels) */
  local: Vec3
}

export type ShapeDragResult = { kind: 'click' } | { kind: 'drop'; pos: Placement } | { kind: 'cancel' }

const HOME_DIR = new Vector3(0.42, -0.72, 0.55).normalize()
/** normal lens, and a long lens for sketching (almost no perspective, like a drawing) */
const FOV = 40
const SKETCH_FOV = 14
/** camera distance that shows the same size at the target with another lens */
const sameView = (dist: number, fromFov: number, toFov: number) =>
  (dist * Math.tan((fromFov * Math.PI) / 360)) / Math.tan((toFov * Math.PI) / 360)
const EPS = 1e-9

export class Viewport {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly controls: OrbitControls
  readonly sync: SceneSync
  readonly gizmo = new Gizmo()
  readonly alignTool = new AlignTool()
  readonly workplane = new Workplane(200)
  /** the ZY and ZX planes through the origin (3D scene only) */
  readonly refPlanes = new RefPlanes(100, 150)
  private viewCube: ViewCube
  private ray = new Raycaster()
  private needsRender = true
  private drag: Drag = { type: 'none' }
  private disposers: (() => void)[] = []
  private anim: {
    t0: number
    dur: number
    fromDir: Vector3
    toDir: Vector3
    fromDist: number
    toDist: number
    fromTarget: Vector3
    toTarget: Vector3
    fromFov: number
    toFov: number
  } | null = null
  private label: HTMLDivElement
  private boxEl: HTMLDivElement
  private raf = 0
  // active workplane: matrix, inverse, rotation (identity = ground)
  private wp = new Matrix4()
  private wpInv = new Matrix4()
  private wpQ = new Quaternion()
  private wpFrame: Frame | null = null
  private wpPreview: Group
  /** smart guides while moving, and shadows under lifted shapes */
  private guides: LineSegments
  private shadows = new Group()
  private shadowMat = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide })
  private elevLineMat = new LineDashedMaterial({ dashSize: 2, gapSize: 1.5, transparent: true })
  /** the ruler (and its preview while placing), plus its distance lines to the selection */
  private rulerObj = new Group()
  private rulerLines!: LineSegments
  private rulerM = new Matrix4()
  private rulerInv = new Matrix4()
  /** sketch mode editor (while a sketch session is open) */
  private sketchEd: SketchEditor | null = null
  private hiddenNode: string | null = null

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setClearColor(new Color(THEME.clear))
    this.renderer.domElement.className = 'viewport-canvas'
    container.appendChild(this.renderer.domElement)

    this.label = document.createElement('div')
    this.label.className = 'drag-label'
    container.appendChild(this.label)
    this.boxEl = document.createElement('div')
    this.boxEl.className = 'box-select'
    container.appendChild(this.boxEl)

    this.camera = new PerspectiveCamera(FOV, 1, 1, 20000)
    this.camera.up.set(0, 0, 1)
    this.camera.position.copy(HOME_DIR).multiplyScalar(380)
    this.scene.add(this.camera)

    const hemi = new HemisphereLight('#ffffff', '#9aa8b8', 1.5)
    hemi.position.set(0, 0, 1)
    this.scene.add(hemi)
    const key = new DirectionalLight('#ffffff', 1.6)
    this.roomLights = [hemi, key]
    key.position.set(-0.6, 0.9, 0.4)
    const keyTarget = new Object3D()
    keyTarget.position.set(0, 0, -1)
    this.camera.add(key, keyTarget)
    key.target = keyTarget
    const fill = new DirectionalLight('#ffffff', 0.5)
    fill.position.set(1, -1, 2)
    this.scene.add(fill)
    this.roomLights.push(fill)

    this.scene.add(this.workplane.mesh)
    this.scene.add(this.refPlanes.root)
    this.sync = new SceneSync(geom, () => {
      // a mesh arrived or the field changed: the sun's shadow box may have to grow
      this.sunStale = true
      this.invalidate()
    })
    // lamps on the robotics field do not dim the room: it stays as bright as without them
    this.sync.onLamps = () => this.setRoomLight(1)
    this.scene.add(this.sync.root)
    this.scene.add(this.gizmo.root)
    this.scene.add(this.alignTool.root)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.mouseButtons = { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }
    this.controls.zoomToCursor = true
    this.controls.screenSpacePanning = true
    this.controls.minDistance = 5
    this.controls.maxDistance = 5000
    this.controls.addEventListener('change', () => this.invalidate())

    this.viewCube = new ViewCube(this.cubeLabels())

    // square that follows the cursor while choosing a face for the workplane
    this.wpPreview = new Group()
    const pm = new MeshBasicMaterial({
      color: THEME.lift,
      transparent: true,
      opacity: 0.35,
      side: DoubleSide,
      depthTest: false
    })
    const sq = new PlaneGeometry(1, 1)
    this.wpPreview.add(new Mesh(sq, pm))
    this.wpPreview.add(
      new LineSegments(new EdgesGeometry(sq), new LineBasicMaterial({ color: THEME.lift, depthTest: false }))
    )
    this.wpPreview.renderOrder = 999
    this.wpPreview.visible = false
    this.scene.add(this.wpPreview)

    this.guides = new LineSegments(
      new BufferGeometry(),
      new LineDashedMaterial({ dashSize: 3, gapSize: 2, depthTest: false, transparent: true })
    )
    this.guides.renderOrder = 998
    this.guides.frustumCulled = false
    this.scene.add(this.guides)
    this.shadows.renderOrder = -0.5
    this.scene.add(this.shadows)
    this.rulerObj.visible = false
    this.scene.add(this.rulerObj)
    this.rulerLines = new LineSegments(
      new BufferGeometry(),
      new LineDashedMaterial({ dashSize: 2.5, gapSize: 1.5, depthTest: false, transparent: true })
    )
    this.rulerLines.renderOrder = 997
    this.rulerLines.frustumCulled = false
    this.scene.add(this.rulerLines)

    this.bindEvents()
    this.disposers.push(
      effect(() => {
        const d = doc.value
        const s = selection.value
        void geom.revision.value
        this.sync.sync(d, s)
        this.updateGizmo()
        this.updateShadows()
        untracked(() => this.applyPretty())
        this.invalidate()
      }),
      effect(() => {
        void roboticsMode.value
        void session.value
        void prettyCap.value
        untracked(() => this.applyPretty(true))
      }),
      effect(() => {
        // the align tool switched on or off, or its reference shape changed
        void aligning.value
        untracked(() => {
          this.cancelAlignPreview()
          this.updateGizmo()
          this.invalidate()
        })
      }),
      effect(() => {
        this.workplane.setMinor(gridStep.value || 1)
        this.invalidate()
      }),
      effect(() => {
        const f = workplane.value
        this.wpFrame = f
        this.wp = frameMatrix(f)
        this.wpInv = this.wp.clone().invert()
        this.wpQ = new Quaternion().setFromRotationMatrix(this.wp)
        if (!session.peek()) this.workplane.setFrame(f ? this.wp : null)
        this.updateGizmo()
        this.updateShadows()
        this.invalidate()
      }),
      effect(() => {
        // the brush square goes away with the brush
        if (!landBrush.value && this.brushCursor?.visible) {
          this.brushCursor.visible = false
          this.renderer.domElement.style.cursor = ''
          this.invalidate()
        }
      }),
      effect(() => {
        if (!placingWorkplane.value && !sketchPicking.value) {
          this.wpPreview.visible = false
          this.invalidate()
        }
      }),
      effect(() => {
        const s = session.value
        untracked(() => {
          this.sketchEd?.dispose()
          this.sketchEd = null
          if (this.hiddenNode) {
            const o = this.sync.objects.get(this.hiddenNode)
            if (o) o.visible = true
            this.hiddenNode = null
          }
          if (s?.nodeId) {
            // the shape being re-edited steps aside while its sketch is open
            const o = this.sync.objects.get(s.nodeId)
            if (o) o.visible = false
            this.hiddenNode = s.nodeId
          }
          // shapes standing in front of the sketch plane would hide it: they turn see-through
          this.sync.setGhosts(s ? this.inFrontOf(s.frame, s.nodeId ?? null) : [])
          if (s) {
            selection.value = []
            this.sketchEd = new SketchEditor(this.sketchHost(), s.frame)
            this.workplane.setFrame(frameMatrix(s.frame).multiply(new Matrix4().makeTranslation(0, 0, 0.1)))
          } else {
            this.workplane.setFrame(workplane.peek() ? this.wp : null)
            // back to the normal lens, showing the same area
            if (this.camera.fov !== FOV) {
              const off = this.camera.position.clone().sub(this.controls.target)
              const d = sameView(off.length(), this.anim?.toFov ?? this.camera.fov, FOV)
              this.animateTo(off.normalize(), d, this.controls.target.clone(), FOV)
            }
          }
          this.updateGizmo()
          this.updateShadows()
          this.invalidate()
        })
      }),
      effect(() => {
        const r = ruler.value
        const placing = placingRuler.value
        void themeId.value
        this.buildRuler()
        this.rulerObj.visible = !!r && !placing
        if (r) {
          this.rulerM = frameMatrix(r)
          this.rulerInv = this.rulerM.clone().invert()
          this.rulerObj.matrix.copy(this.rulerM)
        }
        this.updateRulerLines()
        this.invalidate()
      }),
      effect(() => {
        void rulerMode.value
        this.updateRulerLines()
        this.invalidate()
      }),
      effect(() => {
        void lang.value
        void themeId.value
        this.applyTheme()
      }),
      effect(() => {
        const { zy, zx } = refPlanes.value
        const model = !roboticsMode.value
        untracked(() => {
          this.refPlanes.setVisible('zy', zy && model)
          this.refPlanes.setVisible('zx', zx && model)
          this.invalidate()
        })
      }),
      effect(() => {
        const on = roboticsMode.value
        untracked(() => {
          // each scene keeps its own camera: coming back shows it the way it was left
          if (this.floorOn !== on) {
            this.views.set(this.floorOn ? 'robo' : 'model', this.saveView())
            this.floorOn = on
            const back = this.views.get(on ? 'robo' : 'model')
            if (back) this.restoreView(back)
            else setTimeout(() => this.fitView(), 60)
          }
          this.workplane.setFloor(on)
          this.controls.maxDistance = on ? 15000 : 5000
          if (on) void loadRoboModels().catch(() => undefined)
          this.invalidate()
        })
      }),
      effect(() => {
        void simActive.value
        untracked(() => {
          if (simActive.peek() && this.drag.type !== 'none') this.cancelDrag()
          // a brush stroke going on when the run starts is taken back (the field is not edited during a run)
          if (simActive.peek()) this.brushCancel?.()
          this.updateGizmo()
          this.invalidate()
        })
      })
    )

    const ro = new ResizeObserver(() => this.resize())
    ro.observe(container)
    this.disposers.push(() => ro.disconnect())
    this.resize()
    const loop = () => {
      this.raf = requestAnimationFrame(loop)
      this.step()
    }
    loop()
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.disposers.forEach((d) => d())
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.label.remove()
    this.boxEl.remove()
  }

  /** Re-read the scene colors (THEME is updated by themes.ts before this runs). */
  private applyTheme(): void {
    this.renderer.setClearColor(new Color(THEME.clear))
    this.workplane.applyTheme()
    this.gizmo.applyTheme()
    this.alignTool.applyTheme()
    ;(this.guides.material as LineDashedMaterial).color.set(THEME.guide)
    this.shadowMat.color.set(THEME.shadow)
    this.shadowMat.opacity = THEME.shadowOpacity
    this.elevLineMat.color.set(THEME.shadow)
    this.elevLineMat.opacity = Math.min(1, THEME.shadowOpacity * 4)
    applyThemeToMaterials()
    this.viewCube.setLabels(this.cubeLabels())
    this.sync.sync(doc.peek(), selection.peek())
    this.invalidate()
  }

  private cubeLabels(): string[] {
    return [t('view.right'), t('view.left'), t('view.back'), t('view.front'), t('view.top'), t('view.bottom')]
  }

  invalidate(): void {
    this.needsRender = true
  }

  private resize(): void {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h)
    this.sketchEd?.setSize(w, h)
    this.pretty?.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.invalidate()
  }

  /**
   * The camera's near and far planes follow how far it is from what it looks at. With the near
   * plane fixed at 1 mm, a field seen from 8 m away has only about 4 mm of depth resolution, and
   * surfaces a few millimetres apart (a grass top over its earth) flicker through each other.
   */
  private fitClipping(): void {
    const d = this.camera.position.distanceTo(this.controls.target)
    const near = Math.min(100, Math.max(1, d / 400))
    const far = Math.max(20000, d * 4)
    if (Math.abs(near - this.camera.near) > 1e-6 || far !== this.camera.far) {
      this.camera.near = near
      this.camera.far = far
      this.camera.updateProjectionMatrix()
    }
  }

  // ---------------------------------------------------------------- the beautiful view

  private pretty: PrettyView | null = null
  /** the settings it was last switched on with (the same object: nothing to set up again) */
  private prettyFor: unknown = null
  /** the field changed since the sun's shadow box was laid out (checked at most twice a second) */
  private sunStale = false
  private sunFitAt = 0

  /** Everything on the field (what the beautiful view's sun has to cover). */
  private fieldBounds(): Box3 {
    const b = new Box3()
    for (const o of this.sync.objects.values()) if (o.box && o.visible) b.union(new Box3().setFromObject(o))
    return b
  }
  /** frame times during a run, to see whether the computer keeps up */
  private frames: number[] = []
  /** called when the view lowers its quality because the computer is too slow */
  onQualityDrop: ((q: Quality) => void) | null = null

  /** Switch the beautiful view on, off or to new settings (as the document and the tab say). */
  private applyPretty(force = false): void {
    const d = doc.peek()
    const v = d.view ? normView(d.view) : null
    const on = !!v?.on && roboticsMode.peek() && !session.peek()
    if (!on || !v) {
      if (this.pretty?.active) {
        this.pretty.set(null, 'low', null)
        this.roomLights.forEach((l) => (l.visible = true))
        this.workplane.mesh.visible = true
        this.prettyFor = null
        if (setPrettyMaterials(null)) this.sync.sync(d, selection.peek())
        this.invalidate()
      }
      return
    }
    if (!force && this.prettyFor === d.view && this.pretty?.active) {
      // only the field changed: lamps and shapes get their shadows, the sun covers all of it
      this.pretty.prepare(this.sync.root)
      this.pretty.fitSun(this.fieldBounds())
      return
    }
    this.prettyFor = d.view
    if (!this.pretty) {
      this.pretty = new PrettyView(this.renderer, this.scene, this.camera)
      this.pretty.setSize(this.container.clientWidth, this.container.clientHeight)
    }
    const cap = prettyCap.peek()
    const q = cap ? lowerQuality(v.quality, cap) : v.quality
    this.pretty.set(v, q, this.fieldBounds())
    this.roomLights.forEach((l) => (l.visible = false))
    this.workplane.mesh.visible = false
    if (setPrettyMaterials({ glowBoost: PRESETS[v.time].glowBoost })) this.sync.sync(d, selection.peek())
    this.pretty.prepare(this.sync.root)
    this.frames = []
    this.invalidate()
  }

  /** During a run: below MIN_FPS for two seconds, the quality goes a step down. */
  private watchFrames(): void {
    if (!this.pretty?.active || !simActive.peek() || simState.peek() !== 'running') {
      this.frames = []
      return
    }
    const now = performance.now()
    this.frames.push(now)
    while (this.frames.length && now - this.frames[0] > 2000) this.frames.shift()
    if (this.frames.length < 2 || now - this.frames[0] < 1900) return
    const fps = (this.frames.length - 1) / ((now - this.frames[0]) / 1000)
    if (fps >= MIN_FPS) return
    const v = normView(doc.peek().view)
    const cur = prettyCap.peek() ? lowerQuality(v.quality, prettyCap.peek()!) : v.quality
    if (cur === 'low') return
    const next = stepDown(cur)
    this.frames = []
    prettyCap.value = next
    this.onQualityDrop?.(next)
  }

  /** time of the last frame (for the follow camera's easing) */
  private lastStep = 0
  /** a picture or a video is being made: no view cube on it */
  private bare = false

  /**
   * The follow camera: the point looked at moves toward the followed object, and the camera moves
   * with it by the same amount (so turning and zooming still work while it follows).
   */
  private followStep(dt: number): void {
    const id = followId.peek()
    if (!id || !simActive.peek() || this.anim) return
    const o = this.sync.objects.get(id)
    if (!o) return
    const want = o.position.clone()
    want.z += 60
    const d = want.sub(this.controls.target)
    if (d.lengthSq() < 0.25) return
    d.multiplyScalar(1 - Math.exp(-dt * 4))
    this.controls.target.add(d)
    this.camera.position.add(d)
    this.controls.update()
    this.invalidate()
  }

  /**
   * A picture of the view as it is now (the beautiful view if it is on), without the view cube.
   * PNG; null if the canvas cannot give one.
   */
  picture(): Promise<Blob | null> {
    // while a video is being recorded the view cube stays away
    const was = this.bare
    this.bare = true
    this.needsRender = true
    this.step()
    this.bare = was
    const canvas = this.renderer.domElement
    // the picture is taken from the frame just drawn (before it is shown and cleared)
    const p = new Promise<Blob | null>((ok) => canvas.toBlob((b) => ok(b), 'image/png'))
    this.invalidate()
    return p
  }

  /**
   * A small picture of the view for the list of recent projects (a JPEG data URL, `w`×`h`, the
   * middle of the view), or null when the view cannot be drawn now.
   */
  thumbnail(w = 320, h = 200): string | null {
    // the shapes only: no view cube, no handles
    const was = this.bare
    const handles = this.gizmo.root.visible
    const dots = this.alignTool.root.visible
    this.bare = true
    this.gizmo.root.visible = false
    this.alignTool.root.visible = false
    this.needsRender = true
    this.step()
    this.bare = was
    this.gizmo.root.visible = handles
    this.alignTool.root.visible = dots
    const src = this.renderer.domElement
    if (!src.width || !src.height) return null
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    if (!g) return null
    // cover: the middle of the view, cut to the picture's shape
    const k = Math.max(w / src.width, h / src.height)
    const sw = w / k
    const sh = h / k
    g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, w, h)
    this.invalidate()
    try {
      return c.toDataURL('image/jpeg', 0.78)
    } catch {
      return null
    }
  }

  private recorder: MediaRecorder | null = null

  /**
   * Record the view for up to `seconds` (WebM). Resolves with the video when it stops: after the
   * time, or earlier by `stopRecording`. Null when recording is not possible here.
   */
  record(seconds: number): Promise<Blob | null> {
    if (this.recorder) return Promise.resolve(null)
    const canvas = this.renderer.domElement
    if (!canvas.captureStream || typeof MediaRecorder === 'undefined') return Promise.resolve(null)
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))
    if (!type) return Promise.resolve(null)
    let stream: MediaStream
    let rec: MediaRecorder
    try {
      stream = canvas.captureStream(30)
      rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 })
    } catch {
      return Promise.resolve(null)
    }
    const chunks: Blob[] = []
    this.recorder = rec
    this.bare = true
    recording.value = true
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    const done = new Promise<Blob | null>((ok) => {
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        this.recorder = null
        this.bare = false
        recording.value = false
        this.invalidate()
        ok(chunks.length ? new Blob(chunks, { type: 'video/webm' }) : null)
      }
    })
    try {
      rec.start(250)
    } catch {
      // it could not start: nothing is being recorded
      stream.getTracks().forEach((t) => t.stop())
      this.recorder = null
      this.bare = false
      recording.value = false
      this.invalidate()
      return Promise.resolve(null)
    }
    const timer = window.setTimeout(() => this.stopRecording(), seconds * 1000)
    void done.then(() => window.clearTimeout(timer))
    // a frame at once, so even a still view gives a picture
    this.invalidate()
    return done
  }

  stopRecording(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
  }

  private step(): void {
    const now = performance.now()
    const dt = this.lastStep ? Math.min(0.1, (now - this.lastStep) / 1000) : 0
    this.lastStep = now
    this.followStep(dt)
    // a video needs every frame drawn, even when nothing moves
    if (this.recorder) this.needsRender = true
    if (this.anim) {
      const a = this.anim
      const k = Math.min(1, (performance.now() - a.t0) / a.dur)
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2
      const dir = slerpDir(a.fromDir, a.toDir, e)
      const dist = a.fromDist + (a.toDist - a.fromDist) * e
      const target = a.fromTarget.clone().lerp(a.toTarget, e)
      if (a.fromFov !== a.toFov) {
        this.camera.fov = a.fromFov + (a.toFov - a.fromFov) * e
        this.camera.updateProjectionMatrix()
      }
      this.controls.target.copy(target)
      this.camera.position.copy(target).addScaledVector(dir, dist)
      this.camera.lookAt(target)
      this.controls.update()
      if (k >= 1) this.anim = null
      this.invalidate()
    }
    if (!this.needsRender) return
    const h = this.container.clientHeight
    // hidden (the circuits tab is open): nothing to draw, and handles sized per pixel would be NaN;
    // the frame is drawn when the view is shown again
    if (h <= 0 || this.container.clientWidth <= 0) return
    this.needsRender = false
    this.gizmo.update(this.camera, h)
    this.alignTool.update(this.camera, h)
    this.renderer.autoClear = true
    this.renderer.setViewport(0, 0, this.container.clientWidth, h)
    this.fitClipping()
    if (this.pretty?.active) {
      if (this.sunStale && performance.now() - this.sunFitAt > 500) {
        this.sunStale = false
        this.sunFitAt = performance.now()
        this.pretty.fitSun(this.fieldBounds())
      }
      this.pretty.render(this.camera.position.distanceTo(this.controls.target))
      this.watchFrames()
    } else this.renderer.render(this.scene, this.camera)
    this.renderer.autoClear = false
    if (!this.bare) this.viewCube.render(this.renderer, this.camera, this.controls.target, h)
    this.renderer.autoClear = true
    this.updateDims()
    this.sketchEd?.updateOverlay()
  }

  // ---------------------------------------------------------------- camera

  private animateTo(dir: Vector3, dist: number, target: Vector3, fov = this.camera.fov): void {
    const from = this.camera.position.clone().sub(this.controls.target)
    this.anim = {
      fromFov: this.camera.fov,
      toFov: fov,
      t0: performance.now(),
      dur: 380,
      fromDir: from.clone().normalize(),
      toDir: dir.clone().normalize(),
      fromDist: from.length(),
      toDist: dist,
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone()
    }
    this.invalidate()
  }

  /** Which scene the camera is looking at (the floor is the robotics field). */
  private floorOn = false
  private views = new Map<'model' | 'robo', { pos: Vector3; target: Vector3; fov: number }>()

  private saveView() {
    return { pos: this.camera.position.clone(), target: this.controls.target.clone(), fov: this.camera.fov }
  }

  private restoreView(v: { pos: Vector3; target: Vector3; fov: number }): void {
    this.anim = null
    this.camera.position.copy(v.pos)
    this.controls.target.copy(v.target)
    this.camera.fov = v.fov
    this.camera.updateProjectionMatrix()
    this.controls.update()
    this.invalidate()
  }

  /** A new or opened project: both scenes start with a fresh camera. */
  forgetViews(): void {
    this.views.clear()
  }

  /** Back to the usual 3/4 view, looking at the given shapes (after finishing a sketch). */
  viewShapes(ids: string[]): void {
    const b = unionBoxes(Object.values(this.sync.worldBoxes(ids)))
    const target = b ? new Vector3(...boxCenter(b)) : this.controls.target.clone()
    const now = sameView(this.camera.position.distanceTo(this.controls.target), this.camera.fov, FOV)
    this.animateTo(HOME_DIR, Math.min(600, Math.max(150, now)), target, FOV)
  }

  lookFrom(normal: Vector3): void {
    const n = normal.clone()
    // avoid the degenerate straight-up/down view for OrbitControls
    if (Math.abs(n.z) > 0.999) n.set(0, -0.002 * Math.sign(n.z || 1), n.z).normalize()
    const dist = this.camera.position.distanceTo(this.controls.target)
    this.animateTo(n, dist, this.controls.target.clone())
  }

  /** Zoom to fit the selection (or everything, or the workplane). */
  fitView(): void {
    const ids = selection.value.length ? selection.value : doc.value.nodes.map((n) => n.id)
    const b = unionBoxes(Object.values(this.sync.worldBoxes(ids)))
    let center: Vector3
    let radius: number
    if (!b) {
      // an empty robotics floor: show a few tiles around the origin, not the whole field
      center = roboticsMode.peek() ? new Vector3(300, 300, 0) : new Vector3()
      radius = roboticsMode.peek() ? 700 : this.workplane.size * 0.6
    } else {
      center = new Vector3(...boxCenter(b))
      radius = Math.max(10, new Vector3(...b.max).distanceTo(new Vector3(...b.min)) / 2)
      // on the robotics field a small object is shown with some floor around it (about a tile)
      if (roboticsMode.peek()) radius = Math.max(radius, 220)
    }
    const fov = (this.camera.fov * Math.PI) / 180
    const fitH = radius / Math.sin(fov / 2)
    const fitW = radius / Math.sin(Math.atan(Math.tan(fov / 2) * this.camera.aspect))
    // a flat track fills its bounding sphere loosely: come closer in robotics
    const dist = Math.max(fitH, fitW) * (roboticsMode.peek() && b ? 0.8 : 1.1)
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    this.animateTo(dir, dist, center)
  }

  zoom(factor: number): void {
    const dir = this.camera.position.clone().sub(this.controls.target)
    const d = Math.min(5000, Math.max(5, dir.length() * factor))
    this.animateTo(dir.normalize(), d, this.controls.target.clone())
  }

  // ---------------------------------------------------------------- geometry helpers

  worldBoxes(ids: string[]): Record<string, Box> {
    return this.sync.worldBoxes(ids)
  }

  selectionBox(ids = selection.value): Box | null {
    return unionBoxes(Object.values(this.sync.worldBoxes(ids)))
  }

  // ---------------------------------------------------------------- workplane

  /** Workplane normal in world space. */
  wpNormal(): Vector3 {
    return new Vector3(0, 0, 1).applyQuaternion(this.wpQ)
  }

  /** World directions of the workplane's X, Y, Z axes. */
  wpAxes(): [Vec3, Vec3, Vec3] {
    return [0, 1, 2].map((k) => {
      const v = new Vector3(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0).applyQuaternion(this.wpQ)
      return cleanVec([v.x, v.y, v.z], 9)
    }) as [Vec3, Vec3, Vec3]
  }

  /** Exact boxes in workplane coordinates. */
  wpBoxes(ids: string[]): Record<string, Box> {
    return this.sync.boxesInFrame(ids, this.wpInv)
  }

  wpSelectionBox(ids = selection.value): Box | null {
    return unionBoxes(Object.values(this.wpBoxes(ids)))
  }

  /** Workplane point -> world point. */
  fromWp(v: Vec3): Vec3 {
    const p = new Vector3(...v).applyMatrix4(this.wp)
    return [p.x, p.y, p.z]
  }

  private toWpDir(v: Vector3): Vector3 {
    return v.clone().applyQuaternion(this.wpQ.clone().invert())
  }

  private toWorldDir(v: Vector3): Vector3 {
    return v.clone().applyQuaternion(this.wpQ)
  }

  private placement(local: Vector3): Placement {
    const w = local.clone().applyMatrix4(this.wp)
    return {
      position: cleanVec([w.x, w.y, w.z], 6),
      rotation: this.wpFrame ? [...this.wpFrame.rotation] : [0, 0, 0],
      local: cleanVec([local.x, local.y, local.z], 6)
    }
  }

  /** World shift for the arrow keys: along the workplane axis closest to the view direction. */
  nudgeVector(key: string, amount: number, vertical: boolean): Vec3 {
    let v: Vector3
    if (vertical) {
      v = new Vector3(0, 0, key === 'ArrowUp' ? amount : -amount)
    } else {
      const d = this.toWpDir(this.camera.getWorldDirection(new Vector3()))
      const fwd = Math.abs(d.x) > Math.abs(d.y) ? new Vector3(Math.sign(d.x), 0, 0) : new Vector3(0, Math.sign(d.y), 0)
      const right = new Vector3(fwd.y, -fwd.x, 0)
      v =
        key === 'ArrowUp'
          ? fwd
          : key === 'ArrowDown'
            ? fwd.clone().negate()
            : key === 'ArrowRight'
              ? right
              : right.clone().negate()
      v.multiplyScalar(amount)
    }
    const w = this.toWorldDir(v)
    return cleanVec([w.x, w.y, w.z], 6)
  }

  /** Face under the cursor as a workplane frame (normal pointing toward the viewer). */
  /**
   * A shown ZY / ZX plane under the cursor, nearer than any shape: a sketch can go on it.
   * The sketch frame sits at the world origin with its normal towards the camera.
   */
  private refPlaneHit(clientX: number, clientY: number): { point: Vector3; frame: Frame } | null {
    const ray = this.setRay(clientX, clientY)
    let best: { point: Vector3; frame: Frame; d: number } | null = null
    for (const id of ['zy', 'zx'] as const) {
      if (!this.refPlanes.isVisible(id)) continue
      const h = ray.intersectObject(this.refPlanes.mesh(id), false)[0]
      if (!h || (best && best.d < h.distance)) continue
      const n = id === 'zy' ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0)
      if (n.dot(ray.ray.direction) > 0) n.negate()
      best = { point: h.point.clone(), frame: frameFromHit(new Vector3(0, 0, 0), n), d: h.distance }
    }
    if (!best) return null
    const face = this.pickNode(clientX, clientY)
    if (face && face.point.distanceTo(this.camera.position) < best.d) return null
    return best
  }

  private faceFrame(clientX: number, clientY: number): Frame | null {
    const hit = this.pickNode(clientX, clientY)
    if (!hit || !hit.normal) return null
    const n = hit.normal.clone()
    if (n.dot(this.ray.ray.direction) > 0) n.negate() // mirrored objects have flipped winding
    return frameFromHit(hit.point, n)
  }

  private ndc(clientX: number, clientY: number): Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect()
    return new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
  }

  private setRay(clientX: number, clientY: number): Raycaster {
    this.ray.setFromCamera(this.ndc(clientX, clientY), this.camera)
    return this.ray
  }

  private pickNode(clientX: number, clientY: number): { id: string; point: Vector3; normal: Vector3 | null } | null {
    const ray = this.setRay(clientX, clientY)
    const hits = ray.intersectObjects(this.sync.pickables(), true)
    for (const h of hits) {
      let o: Object3D | null = h.object
      while (o && !(o instanceof NodeObject)) o = o.parent
      if (o instanceof NodeObject) {
        const normal = h.face
          ? h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize()
          : null
        return { id: o.nodeId, point: h.point.clone(), normal }
      }
    }
    return null
  }

  private rayPlane(clientX: number, clientY: number, plane: Plane): Vector3 | null {
    const ray = this.setRay(clientX, clientY)
    return ray.ray.intersectPlane(plane, new Vector3())
  }

  /**
   * Where a new shape dropped at this screen point should go: on top of a surface facing the
   * same way as the workplane, or on the workplane itself; snapped to the grid in plane axes.
   */
  dropPoint(clientX: number, clientY: number): Placement {
    const step = gridStep.value
    const n = this.wpNormal()
    const hit = this.pickNode(clientX, clientY)
    let local: Vector3 | null = null
    if (hit && hit.normal && Math.abs(hit.normal.dot(n)) > 0.7 && hit.normal.dot(n) > 0) {
      local = hit.point.clone().applyMatrix4(this.wpInv)
    }
    if (!local) {
      const p = this.rayPlane(clientX, clientY, new Plane().setFromNormalAndCoplanarPoint(n, this.origin()))
      if (p) local = p.applyMatrix4(this.wpInv).setZ(0)
    }
    if (!local) local = new Vector3()
    local.set(snap(local.x, step), snap(local.y, step), cleanNum(Math.max(0, local.z)))
    return this.placement(local)
  }

  /** The shapes reaching out in front of a plane (on the side it faces), but the one given. */
  private inFrontOf(frame: Frame, except: string | null): string[] {
    const m = frameMatrix(frame)
    const o = new Vector3().setFromMatrixPosition(m)
    const nrm = new Vector3().setFromMatrixColumn(m, 2).normalize()
    const boxes = this.worldBoxes(doc.peek().nodes.map((n) => n.id))
    const out: string[] = []
    for (const [id, b] of Object.entries(boxes)) {
      if (id === except) continue
      let front = -Infinity
      for (const x of [b.min[0], b.max[0]])
        for (const y of [b.min[1], b.max[1]])
          for (const z of [b.min[2], b.max[2]]) front = Math.max(front, new Vector3(x, y, z).sub(o).dot(nrm))
      if (front > 0.5) out.push(id)
    }
    return out
  }

  private origin(): Vector3 {
    return new Vector3().setFromMatrixPosition(this.wp)
  }

  /**
   * A spot on the workplane near its origin not covered by existing shapes (for click-to-add).
   * `area` is what the new shape covers around that spot: [minX, maxX, minY, maxY] (mm).
   */
  freeSpot(area: [number, number, number, number] = [-12, 12, -12, 12]): Placement {
    const boxes = Object.values(this.wpBoxes(doc.value.nodes.map((n) => n.id)))
    const gap = 2
    const free = (x: number, y: number) =>
      boxes.every(
        (b) =>
          b.max[0] < x + area[0] - gap || b.min[0] > x + area[1] + gap || b.max[1] < y + area[2] - gap || b.min[1] > y + area[3] + gap
      )
    const step = Math.max(25, Math.ceil(Math.max(area[1] - area[0], area[3] - area[2]) / 2 / 5) * 5)
    for (let ring = 0; ring <= 6; ring++) {
      for (let i = -ring; i <= ring; i++) {
        for (let j = -ring; j <= ring; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue
          if (free(i * step, j * step)) return this.placement(new Vector3(i * step, j * step, 0))
        }
      }
    }
    return this.placement(new Vector3())
  }

  // ---------------------------------------------------------------- landscape brush

  /** the square under the cursor while the landscape brush is on */
  private brushCursor: Group | null = null

  /** The floor point (z = 0) under the cursor, or null when looking away from the floor. */
  private floorPoint(clientX: number, clientY: number): Vector3 | null {
    const p = new Vector3()
    return this.setRay(clientX, clientY).ray.intersectPlane(FLOOR_PLANE, p) ? p : null
  }

  /**
   * Show the brush square on the cell under the cursor (null: hide it); with `span` it covers the
   * rectangle of those two cells (Shift: an area).
   */
  private showBrush(e: { clientX: number; clientY: number } | null, span?: [Cell, Cell]): void {
    const kind = landBrush.peek()
    const p = e && kind ? this.floorPoint(e.clientX, e.clientY) : null
    if (!this.brushCursor) {
      const g = new Group()
      const h = TILE_SIZE / 2
      const outline = new LineSegments(
        new BufferGeometry().setFromPoints([
          new Vector3(-h, -h, 0), new Vector3(h, -h, 0), new Vector3(h, -h, 0), new Vector3(h, h, 0),
          new Vector3(h, h, 0), new Vector3(-h, h, 0), new Vector3(-h, h, 0), new Vector3(-h, -h, 0)
        ]),
        new LineBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true })
      )
      const fill = new Mesh(new PlaneGeometry(TILE_SIZE, TILE_SIZE), new MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }))
      outline.renderOrder = fill.renderOrder = 30
      g.add(fill, outline)
      g.traverse((o) => (o.raycast = () => undefined))
      this.brushCursor = g
      this.scene.add(g)
    }
    const g = this.brushCursor
    g.visible = !!p
    if (p && kind) {
      const [cx, cy] = snapTerrain(p.x, p.y, 0, 1)
      g.position.set(cx, cy, 16)
      g.scale.set(1, 1, 1)
      if (span) {
        const [a, b] = span
        const nx = Math.abs(b[0] - a[0]) + 1
        const ny = Math.abs(b[1] - a[1]) + 1
        g.position.set(((Math.min(a[0], b[0]) + nx / 2) * TILE_SIZE), (Math.min(a[1], b[1]) + ny / 2) * TILE_SIZE, 16)
        g.scale.set(nx, ny, 1)
      }
      const color = kind === 'erase' ? '#ff4d4d' : LAND_COLOR[kind]
      ;((g.children[0] as Mesh).material as MeshBasicMaterial).color.set(color)
      ;((g.children[1] as LineSegments).material as LineBasicMaterial).color.set(kind === 'erase' ? '#ff4d4d' : '#ffffff')
      this.renderer.domElement.style.cursor = 'crosshair'
    }
    this.invalidate()
  }

  /**
   * A brush stroke: every cell the cursor passes over gets a landscape tile (or loses it). Started
   * with Shift it covers the rectangle from the first cell to the cursor; with Ctrl, a straight
   * line of cells. Either way the whole stroke is one undo step.
   */
  /** takes back the brush stroke going on (null: none) */
  private brushCancel: (() => void) | null = null

  private startBrush(e: PointerEvent): void {
    const kind = landBrush.peek()
    if (!kind) return
    const paint = kind === 'erase' ? null : kind
    const shape: 'free' | 'area' | 'line' = e.shiftKey ? 'area' : e.ctrlKey || e.metaKey ? 'line' : 'free'
    this.renderer.domElement.setPointerCapture(e.pointerId)
    const base = beginGesture()
    let cur = base
    let last: Vector3 | null = null
    let first: Cell | null = null
    const label = (k: LandKind) => t(`robo.land.${k}` as Key)
    const count = base.nodes.filter((n) => n.kind === 'prim' && n.prim === 'terrain').length
    const name = () =>
      `${t(`robo.land.${paint ?? 'grass'}` as Key)} ${cur.nodes.filter((n) => n.kind === 'prim' && n.prim === 'terrain').length + 1}`
    const at = (ev: { clientX: number; clientY: number }) => {
      const p = this.floorPoint(ev.clientX, ev.clientY)
      if (!p) return
      if (shape !== 'free') {
        // the area or the line is laid again from the start at every move
        const c = cellAt(p.x, p.y)
        first ??= c
        const cells = shape === 'area' ? rectCells(first, c) : lineCells(first, c)
        cur = paintCells(base, cells, paint, (k) => `${t(`robo.land.${paint ?? 'grass'}` as Key)} ${count + k + 1}`, label)
        previewGesture(cur)
        this.showBrush(ev, shape === 'area' ? [first, cells[cells.length - 1]] : undefined)
        return
      }
      // a fast stroke: the cells between the last point and this one too
      const from = last ?? p
      const steps = Math.max(1, Math.ceil(from.distanceTo(p) / (TILE_SIZE / 3)))
      for (let i = 1; i <= steps; i++) {
        const q = from.clone().lerp(p, i / steps)
        cur = paintLand(cur, q.x, q.y, paint, name, label).doc
      }
      last = p
      previewGesture(cur)
      this.showBrush(ev)
    }
    const move = (ev: PointerEvent) => at(ev)
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key, true)
      this.brushCancel = null
    }
    const up = () => {
      stop()
      endGesture()
    }
    const cancel = () => {
      stop()
      cancelGesture()
      this.showBrush(null)
    }
    this.brushCancel = cancel
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      cancel()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key, true)
    at(e)
  }

  // ---------------------------------------------------------------- drag from the shapes panel

  private ghost: Group | null = null

  /**
   * Drag a new shape from the panel. A translucent preview follows the cursor over the workplane
   * (snapped to the grid, landing on top of other shapes) until the button is released.
   */
  beginShapeDrag(
    node: DocNode,
    e: PointerEvent,
    done: (r: ShapeDragResult) => void,
    adjust: (p: Placement) => Placement = (p) => p
  ): void {
    const x0 = e.clientX
    const y0 = e.clientY
    let moved = false
    let pos: Placement | null = null
    const ghost = new Group()
    ghost.visible = false
    this.ghost = ghost
    this.scene.add(ghost)
    geom
      .request(node)
      .then((res) => {
        if (this.ghost !== ghost || res.indices.length === 0) return
        const g = toGeometry(res)
        const mat = new MeshStandardMaterial({
          color: new Color(node.color),
          emissive: new Color(node.color).multiplyScalar(0.25),
          transparent: true,
          opacity: 0.55,
          depthWrite: false
        })
        const edges = new LineSegments(
          new EdgesGeometry(g, 25),
          new LineBasicMaterial({ color: THEME.ghostEdge, transparent: true, opacity: 0.9 })
        )
        ghost.add(new Mesh(g, mat), edges)
        this.invalidate()
      })
      .catch(() => undefined)

    const inside = (ev: PointerEvent) => {
      const r = this.renderer.domElement.getBoundingClientRect()
      return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
    }
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
      moved = true
      document.body.classList.add('shape-dragging')
      if (inside(ev)) {
        pos = adjust(this.dropPoint(ev.clientX, ev.clientY))
        ghost.position.set(...pos.position)
        ghost.quaternion.copy(quatFromRotation(pos.rotation))
        ghost.visible = true
        const l = pos.local
        this.showLabel(ev, `X ${fmt(l[0])}   Y ${fmt(l[1])}${l[2] ? `   Z ${fmt(l[2])}` : ''}`)
      } else {
        pos = null
        ghost.visible = false
        this.label.style.display = 'none'
      }
      this.invalidate()
    }
    const finish = (r: ShapeDragResult) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key, true)
      document.body.classList.remove('shape-dragging')
      this.label.style.display = 'none'
      this.scene.remove(ghost)
      ghost.traverse((o) => {
        const m = o as Mesh
        m.geometry?.dispose()
      })
      if (this.ghost === ghost) this.ghost = null
      this.invalidate()
      done(r)
    }
    const up = (ev: PointerEvent) => {
      if (!moved) return finish({ kind: 'click' })
      if (inside(ev)) pos = adjust(this.dropPoint(ev.clientX, ev.clientY))
      finish(pos && inside(ev) ? { kind: 'drop', pos } : { kind: 'cancel' })
    }
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      finish({ kind: 'cancel' })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key, true)
  }

  // ---------------------------------------------------------------- sensors onto robot pads

  /**
   * The robot pad closest to the cursor (in pixels), if it is near enough to snap to.
   * Ports already carrying a sensor can be chosen too (the sensor is simply there already).
   */
  padAt(clientX: number, clientY: number, radiusPx = 45): { id: string; port: number } | null {
    let best: { id: string; port: number } | null = null
    let bestD = radiusPx
    for (const n of doc.value.nodes) {
      if (n.kind !== 'prim' || n.prim !== 'robot') continue
      const obj = this.sync.objects.get(n.id)
      if (!obj) continue
      obj.updateWorldMatrix(true, false)
      for (const pad of robotSpec(n.params.robot?.model).pads) {
        const w = new Vector3(pad.x, pad.y, pad.z).applyMatrix4(obj.matrixWorld)
        const sp = this.toScreen(w)
        if (!sp) continue
        const r = this.container.getBoundingClientRect()
        const d = Math.hypot(sp.x + r.left - clientX, sp.y + r.top - clientY)
        if (d < bestD) {
          bestD = d
          best = { id: n.id, port: pad.port }
        }
      }
    }
    return best
  }

  /**
   * Drag a sensor from the panel onto a robot: the pads light up, the one under the cursor
   * pulls the sensor in like a magnet, and releasing there attaches it.
   */
  beginSensorDrag(e: PointerEvent, done: (r: { id: string; port: number } | 'click' | null) => void, type: SensorType = 'line'): void {
    const x0 = e.clientX
    const y0 = e.clientY
    let moved = false
    let hot: { id: string; port: number } | null = null
    const busy = (id: string) => {
      const n = doc.value.nodes.find((x) => x.id === id)
      return n && n.kind === 'prim' ? (n.params.robot?.sensors ?? []).map((s) => s.port) : []
    }
    const ghost = new Group()
    const floor = new Plane(new Vector3(0, 0, 1), 0)
    this.scene.add(ghost)
    // the ghost model is only rebuilt when it moves to another pad (or off the pads)
    let ghostKey = ''
    const setGhost = (ev: PointerEvent) => {
      const key = hot ? `${hot.id}:${hot.port}` : 'free'
      if (key !== ghostKey) {
        ghostKey = key
        for (const c of ghost.children) disposeTree(c)
        ghost.clear()
        let s: Object3D | null = null
        if (hot) {
          const n = doc.value.nodes.find((x) => x.id === hot!.id)
          const spec = n && n.kind === 'prim' ? robotSpec(n.params.robot?.model) : null
          const pad = spec?.pads.find((p) => p.port === hot!.port)
          s = pad ? sensorOnPad(pad, type, spec!) : null
        } else s = sensorOnPad({ port: 0, x: 0, y: 0, z: 0, facing: 0 }, type)
        if (s) ghost.add(s)
        // models still loading: try again on the next move
        else ghostKey = ''
      }
      ghost.matrixAutoUpdate = false
      ghost.visible = false
      if (hot) {
        const obj = this.sync.objects.get(hot.id)
        if (obj) {
          ghost.matrix.copy(obj.matrixWorld)
          ghost.visible = true
        }
      } else {
        const p = this.rayPlane(ev.clientX, ev.clientY, floor)
        if (p) {
          ghost.matrix.makeTranslation(p.x, p.y, p.z)
          ghost.visible = true
        }
      }
      ghost.matrixWorldNeedsUpdate = true
    }
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
      if (!moved) {
        moved = true
        document.body.classList.add('shape-dragging')
      }
      hot = this.padAt(ev.clientX, ev.clientY)
      this.sync.showPads(true, hot, busy)
      setGhost(ev)
      this.invalidate()
    }
    const finish = (r: { id: string; port: number } | 'click' | null) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key, true)
      document.body.classList.remove('shape-dragging')
      this.scene.remove(ghost)
      for (const c of ghost.children) disposeTree(c)
      this.sync.showPads(false, null, busy)
      this.invalidate()
      done(r)
    }
    const up = (ev: PointerEvent) => finish(moved ? this.padAt(ev.clientX, ev.clientY) : 'click')
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      finish(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key, true)
  }

  // ---------------------------------------------------------------- gizmo

  /** the shapes' boxes when the align tool was laid out (the preview moves the shapes) */
  private alignBoxes: Record<string, Box> = {}
  /** a dot of the align tool is pointed at: the shapes are shown where they would go */
  private alignBase: Doc | null = null

  /** Lay the align tool's dots round the selection (or its reference shape). */
  private updateAlign(): void {
    const a = aligning.peek()
    const ids = selection.peek()
    if (a && (ids.length < 2 || session.peek() || simActive.peek() || this.sketchEd)) {
      // nothing (or not enough) to align any more
      queueMicrotask(() => (aligning.value = null))
    }
    if (!a || ids.length < 2) {
      this.alignTool.setTarget(null, this.wp)
      return
    }
    // while a preview is shown the dots stay where they were
    if (this.alignBase) return
    this.alignBoxes = this.wpBoxes(ids)
    const key = a.key && ids.includes(a.key) && this.alignBoxes[a.key] ? a.key : null
    const box = key ? this.alignBoxes[key] : unionBoxes(Object.values(this.alignBoxes))
    this.alignTool.setTarget(box ?? null, this.wp, !!key, doc.peek().scene !== 'robo')
  }

  /** The document with the selection lined up at a dot (from the document before any preview). */
  private aligned(spec: AlignDot, base: Doc): Doc {
    const ids = selection.peek()
    const key = aligning.peek()?.key ?? null
    return alignNodes(base, ids, spec.axis, spec.mode, this.alignBoxes, this.wpAxes(), key && ids.includes(key) ? key : null)
  }

  /** Show the selection where the pointed-at dot would put it (null: back as it was). */
  private previewAlign(spec: AlignDot | null): void {
    if (!spec) return this.cancelAlignPreview()
    this.alignBase ??= beginGesture()
    previewGesture(this.aligned(spec, this.alignBase))
  }

  private cancelAlignPreview(): void {
    if (!this.alignBase) return
    this.alignBase = null
    cancelGesture()
  }

  /** Line the selection up at a dot: one step of undo; the tool stays on for the next one. */
  private applyAlign(spec: AlignDot): void {
    if (this.alignBase) {
      this.alignBase = null
      endGesture()
    } else commit(this.aligned(spec, doc.peek()))
    this.updateAlign()
    this.invalidate()
  }

  /** Where an align dot is on screen, in window coordinates (tests). */
  alignDotScreen(axis: 0 | 1 | 2, mode: 'min' | 'center' | 'max'): { x: number; y: number } | null {
    this.alignTool.update(this.camera, this.container.clientHeight)
    const p = this.alignTool.dotLocal({ axis, mode })
    const s = p ? this.toScreen(p.clone().applyMatrix4(this.wp)) : null
    if (!s) return null
    // in window coordinates, like mouse events
    const r = this.renderer.domElement.getBoundingClientRect()
    return { x: s.x + r.left, y: s.y + r.top }
  }

  private updateGizmo(): void {
    this.updateAlign()
    const ids = selection.value
    if (ids.length === 0 || session.peek() || simActive.peek() || aligning.peek() || (this.drag.type === 'move' && inGesture())) {
      this.gizmo.setTarget(null, false)
      return
    }
    const wb = this.wpSelectionBox(ids)
    if (!wb) {
      this.gizmo.setTarget(null, false)
      return
    }
    // tiles and robots lie flat on the floor: they only turn around Z
    const flat = doc.value.nodes.some((n) => ids.includes(n.id) && isRoboNode(n))
    if (flat) {
      this.gizmo.setTarget({ frame: new Matrix4(), scaledBox: null, plane: this.wp, planeBox: wb, flat }, false)
      return
    }
    if (ids.length === 1) {
      const n = doc.value.nodes.find((x) => x.id === ids[0])
      const obj = this.sync.objects.get(ids[0])
      if (n && obj?.box) {
        const t = n.transform
        const frame = new Matrix4().compose(
          new Vector3(...t.position),
          quatFromRotation(t.rotation),
          new Vector3(1, 1, 1)
        )
        const { lo, hi } = scaledBox(obj.box, t.scale)
        this.gizmo.setTarget({ frame, scaledBox: { min: lo, max: hi }, plane: this.wp, planeBox: wb }, true)
        return
      }
    }
    this.gizmo.setTarget({ frame: new Matrix4(), scaledBox: null, plane: this.wp, planeBox: wb }, false)
  }

  // ---------------------------------------------------------------- events

  private bindEvents(): void {
    const el = this.renderer.domElement
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void
    ) => {
      target.addEventListener(type, fn as EventListener)
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener))
    }
    on(el, 'pointerdown', (e) => this.onDown(e))
    on(el, 'pointermove', (e) => this.onMove(e))
    on(el, 'pointerup', (e) => this.onUp(e))
    on(el, 'pointercancel', () => this.cancelDrag())
    on(el, 'pointerleave', () => {
      if (this.sketchEd && !this.sketchEd.dragging) this.sketchEd.onLeave()
      if (this.drag.type !== 'none') return
      if (this.gizmo.setHover(null) || this.viewCube.setHover(-1)) this.invalidate()
    })
    on(el, 'contextmenu', (e) => {
      e.preventDefault()
      this.sketchEd?.onContextMenu(e)
    })
    on(el, 'dblclick', (e) => {
      if (this.sketchEd) return this.sketchEd.onDblClick()
      if (simActive.peek()) {
        // during a run: follow the robot or hero double-clicked (again: stop following)
        const hit = this.pickNode(e.clientX, e.clientY)
        const n = hit && doc.peek().nodes.find((x) => x.id === hit.id)
        if (n && n.kind === 'prim' && (n.prim === 'robot' || n.prim === 'nerpa')) followId.value = followId.peek() === n.id ? null : n.id
        return
      }
      const hit = this.pickNode(e.clientX, e.clientY)
      if (!hit) return this.fitView()
      this.editSketchNode(hit.id)
    })
  }

  /** hemisphere, key and fill lights of the room, with their full intensities */
  private roomLights: (HemisphereLight | DirectionalLight)[] = []
  private roomBase: number[] | null = null
  private roomK = 1

  /** Dim the room lights (1 = full, as in the 3D tab). */
  setRoomLight(k: number): void {
    if (k === this.roomK) return
    if (!this.roomBase) this.roomBase = this.roomLights.map((l) => l.intensity)
    this.roomK = k
    this.roomLights.forEach((l, i) => (l.intensity = this.roomBase![i] * k))
    this.invalidate()
  }

  /** set by the simulation: an object clicked during a run ("when clicked" blocks) */
  onSimClick: ((id: string) => void) | null = null

  cancelDrag(): void {
    this.sketchEd?.cancelDrag()
    if (this.drag.type === 'box') this.boxEl.style.display = 'none'
    if (
      this.drag.type === 'move' ||
      this.drag.type === 'scale' ||
      this.drag.type === 'lift' ||
      this.drag.type === 'rotate'
    ) {
      cancelGesture()
    }
    this.finishDrag()
  }

  get dragging(): boolean {
    return this.drag.type !== 'none' || !!this.sketchEd?.dragging
  }

  /** The sketch editor while sketching (keyboard handling lives there). */
  get sketchEditor(): SketchEditor | null {
    return this.sketchEd
  }

  private finishDrag(): void {
    this.drag = { type: 'none' }
    this.drawGuides([], 0)
    this.label.style.display = 'none'
    this.gizmo.setActive(null)
    this.gizmo.hideProtractor()
    this.gizmo.setVisible(true)
    this.updateGizmo()
    this.invalidate()
  }

  private showLabel(e: { clientX: number; clientY: number }, text: string): void {
    const r = this.container.getBoundingClientRect()
    this.label.textContent = text
    this.label.style.display = 'block'
    this.label.style.left = `${e.clientX - r.left + 16}px`
    this.label.style.top = `${e.clientY - r.top + 14}px`
  }

  private onDown(e: PointerEvent): void {
    if (this.sketchEd && e.button === 2) return this.sketchEd.onDown(e)
    if (e.button !== 0) return
    // finish any pending edit in a text field before a drag starts changing the document
    const active = document.activeElement as HTMLElement | null
    if (active && active !== document.body && active.blur) active.blur()
    this.anim = null
    const canvasRect = this.renderer.domElement.getBoundingClientRect()
    const face = this.viewCube.hit(e.clientX, e.clientY, canvasRect, this.camera)
    if (face >= 0) {
      this.lookFrom(CUBE_NORMALS[face])
      return
    }
    if (face === -1) return
    // during a simulation run the scene can be looked at, not edited; clicks go to the programs
    if (simActive.peek()) {
      const hit = this.pickNode(e.clientX, e.clientY)
      if (hit) this.onSimClick?.(hit.id)
      return
    }

    if (sketchPicking.value) return this.startSketchAt(e.clientX, e.clientY)
    if (this.sketchEd) return this.sketchEd.onDown(e)

    if (placingWorkplane.value) {
      // click on a face: workplane goes there; click on empty space: back to the ground
      workplane.value = this.faceFrame(e.clientX, e.clientY)
      placingWorkplane.value = false
      return
    }
    if (placingRuler.value) {
      const f = this.rulerPoint(e.clientX, e.clientY)
      if (f) ruler.value = f
      placingRuler.value = false
      return
    }

    if (landBrush.peek() && doc.peek().scene === 'robo') return this.startBrush(e)

    // the align tool: a dot lines the shapes up; a selected shape becomes (or stops being) the
    // reference; anything else switches the tool off and is a normal click
    if (this.alignTool.active) {
      const dot = this.alignTool.pick(this.setRay(e.clientX, e.clientY))
      if (dot) return this.applyAlign(dot)
      const on = this.pickNode(e.clientX, e.clientY)
      const a = aligning.peek()
      if (a && on && selection.peek().includes(on.id)) {
        aligning.value = { key: a.key === on.id ? null : on.id }
        return
      }
      this.cancelAlignPreview()
      aligning.value = null
    }

    this.renderer.domElement.setPointerCapture(e.pointerId)
    const spec = this.gizmo.pick(this.setRay(e.clientX, e.clientY))
    if (spec) {
      this.startHandle(spec, e)
      return
    }
    const hit = this.pickNode(e.clientX, e.clientY)
    const sel = selection.value
    if (hit) {
      const wasSelected = sel.includes(hit.id)
      if (e.shiftKey) {
        selection.value = wasSelected ? sel.filter((s) => s !== hit.id) : [...sel, hit.id]
      } else if (!wasSelected) {
        selection.value = [hit.id]
      }
      this.drag = {
        type: 'pending',
        x: e.clientX,
        y: e.clientY,
        hitId: hit.id,
        hitPoint: hit.point,
        shift: e.shiftKey,
        wasSelected
      }
    } else {
      this.drag = {
        type: 'pending',
        x: e.clientX,
        y: e.clientY,
        hitId: null,
        hitPoint: null,
        shift: e.shiftKey,
        wasSelected: false
      }
    }
  }

  private onMove(e: PointerEvent): void {
    if (this.sketchEd) {
      if (!this.sketchEd.dragging) {
        const face = this.viewCube.hit(e.clientX, e.clientY, this.renderer.domElement.getBoundingClientRect(), this.camera)
        if (this.viewCube.setHover(face >= 0 ? face : -1)) this.invalidate()
        if (face >= -1) {
          this.renderer.domElement.style.cursor = face >= 0 ? 'pointer' : ''
          this.sketchEd.onLeave()
          return
        }
      }
      return this.sketchEd.onMove(e)
    }
    const d = this.drag
    if (d.type === 'none') {
      this.hover(e)
      return
    }
    if (d.type === 'pending') {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return
      if (d.hitId && d.hitPoint && selection.value.includes(d.hitId)) {
        const base = beginGesture()
        const ids = [...selection.value]
        const all = this.wpBoxes(doc.value.nodes.map((n) => n.id))
        const mb = unionBoxes(ids.map((id) => all[id]).filter(Boolean))
        const idSet = new Set(ids)
        this.drag = {
          type: 'move',
          plane: new Plane().setFromNormalAndCoplanarPoint(this.wpNormal(), d.hitPoint),
          start: d.hitPoint,
          base,
          ids,
          moving: mb ? { min: [mb.min[0], mb.min[1]], max: [mb.max[0], mb.max[1]] } : { min: [0, 0], max: [0, 0] },
          movingZ: mb ? mb.min[2] : 0,
          others: Object.entries(all)
            .filter(([id]) => !idSet.has(id))
            .map(([, b]) => ({ min: [b.min[0], b.min[1]] as [number, number], max: [b.max[0], b.max[1]] as [number, number] }))
        }
        this.gizmo.setVisible(false)
        this.renderer.domElement.style.cursor = 'grabbing'
      } else if (!d.hitId) {
        this.drag = { type: 'box', x: d.x, y: d.y, shift: d.shift }
      } else {
        return
      }
    }
    const dd = this.drag
    switch (dd.type) {
      case 'move':
        this.doMove(dd, e)
        break
      case 'box': {
        const r = this.container.getBoundingClientRect()
        const x0 = Math.min(dd.x, e.clientX) - r.left
        const y0 = Math.min(dd.y, e.clientY) - r.top
        Object.assign(this.boxEl.style, {
          display: 'block',
          left: `${x0}px`,
          top: `${y0}px`,
          width: `${Math.abs(e.clientX - dd.x)}px`,
          height: `${Math.abs(e.clientY - dd.y)}px`
        })
        break
      }
      case 'scale':
        this.doScale(dd, e)
        break
      case 'lift':
        this.doLift(dd, e)
        break
      case 'rotate':
        this.doRotate(dd, e)
        break
    }
  }

  private onUp(e: PointerEvent): void {
    if (this.sketchEd) return this.sketchEd.onUp(e)
    const el = this.renderer.domElement
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    el.style.cursor = ''
    const d = this.drag
    switch (d.type) {
      case 'pending':
        if (!d.hitId && !d.shift) selection.value = []
        else if (d.hitId && !d.shift && d.wasSelected) selection.value = [d.hitId]
        break
      case 'move':
      case 'scale':
      case 'lift':
      case 'rotate':
        endGesture()
        break
      case 'box':
        this.finishBox(d, e)
        break
    }
    this.finishDrag()
  }

  private hover(e: PointerEvent): void {
    if (landBrush.peek() && doc.peek().scene === 'robo') return this.showBrush(e)
    if (placingRuler.value) {
      const f = this.rulerPoint(e.clientX, e.clientY)
      this.rulerObj.visible = !!f
      if (f) this.rulerObj.matrix.copy(frameMatrix(f))
      this.renderer.domElement.style.cursor = 'crosshair'
      this.invalidate()
      return
    }
    if (placingWorkplane.value || sketchPicking.value) {
      const onPlane = sketchPicking.value ? this.refPlaneHit(e.clientX, e.clientY) : null
      const f = onPlane ? { ...onPlane.frame, position: cleanVec([onPlane.point.x, onPlane.point.y, onPlane.point.z], 4) } : this.faceFrame(e.clientX, e.clientY)
      this.wpPreview.visible = !!f
      if (f) {
        const p = new Vector3(...f.position)
        this.wpPreview.position.copy(p)
        this.wpPreview.quaternion.copy(quatFromRotation(f.rotation))
        this.wpPreview.scale.setScalar(70 * this.worldPerPixelAt(p))
      }
      this.renderer.domElement.style.cursor = 'crosshair'
      this.invalidate()
      return
    }
    const canvasRect = this.renderer.domElement.getBoundingClientRect()
    const face = this.viewCube.hit(e.clientX, e.clientY, canvasRect, this.camera)
    if (this.viewCube.setHover(face >= 0 ? face : -1)) this.invalidate()
    if (face >= -1 || simActive.peek()) {
      this.renderer.domElement.style.cursor = face >= 0 ? 'pointer' : ''
      return
    }
    if (this.alignTool.active) {
      const dot = this.alignTool.pick(this.setRay(e.clientX, e.clientY))
      if (this.alignTool.setHover(dot)) {
        this.previewAlign(dot)
        this.invalidate()
      }
      const on = dot ? null : this.pickNode(e.clientX, e.clientY)
      this.renderer.domElement.style.cursor = dot || (on && selection.peek().includes(on.id)) ? 'pointer' : ''
      return
    }
    const spec = this.gizmo.pick(this.setRay(e.clientX, e.clientY))
    if (this.gizmo.setHover(spec)) this.invalidate()
    if (spec) {
      this.renderer.domElement.style.cursor = spec.kind === 'rotate' ? 'grab' : 'pointer'
      return
    }
    const hit = this.pickNode(e.clientX, e.clientY)
    this.renderer.domElement.style.cursor = hit ? 'move' : ''
  }

  private finishBox(d: Extract<Drag, { type: 'box' }>, e: PointerEvent): void {
    this.boxEl.style.display = 'none'
    const a = this.ndc(d.x, d.y)
    const b = this.ndc(e.clientX, e.clientY)
    const minX = Math.min(a.x, b.x)
    const maxX = Math.max(a.x, b.x)
    const minY = Math.min(a.y, b.y)
    const maxY = Math.max(a.y, b.y)
    const hits: string[] = []
    for (const n of doc.value.nodes) {
      const box = this.sync.worldBox(n.id)
      if (!box) continue
      // project the 8 corners; select when the screen rect overlaps
      let x0 = Infinity
      let x1 = -Infinity
      let y0 = Infinity
      let y1 = -Infinity
      for (let i = 0; i < 8; i++) {
        const v = new Vector3(
          i & 1 ? box.max[0] : box.min[0],
          i & 2 ? box.max[1] : box.min[1],
          i & 4 ? box.max[2] : box.min[2]
        ).project(this.camera)
        x0 = Math.min(x0, v.x)
        x1 = Math.max(x1, v.x)
        y0 = Math.min(y0, v.y)
        y1 = Math.max(y1, v.y)
      }
      if (x1 >= minX && x0 <= maxX && y1 >= minY && y0 <= maxY) hits.push(n.id)
    }
    selection.value = d.shift ? [...new Set([...selection.value, ...hits])] : hits
  }

  // ---------------------------------------------------------------- move

  private doMove(d: Extract<Drag, { type: 'move' }>, e: PointerEvent): void {
    const p = this.rayPlane(e.clientX, e.clientY, d.plane)
    if (!p) return
    const step = gridStep.value
    // the drag happens in the workplane: snap the shift along its X and Y
    const local = this.toWpDir(p.clone().sub(d.start))
    let dx: number
    let dy: number
    let guides: Guide[] = []
    if (e.altKey || d.others.length === 0) {
      // Alt: grid only
      dx = snap(local.x, step)
      dy = snap(local.y, step)
    } else {
      const tol = 7 * this.worldPerPixelAt(d.start)
      const r = snapToGuides(d.moving, d.others, [local.x, local.y], tol, (v) => snap(v, step))
      dx = cleanNum(r.delta[0])
      dy = cleanNum(r.delta[1])
      guides = r.guides
    }
    if (e.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0
      else dx = 0
      guides = []
    }
    // tiles and terrain move by whole cells: they stay on the 300 mm grid
    const tile = d.base.nodes.find((n) => d.ids.includes(n.id) && n.kind === 'prim' && n.prim === 'tile')
    const piece = d.base.nodes.find((n) => d.ids.includes(n.id) && n.kind === 'prim' && n.prim === 'terrain') as PrimNode | undefined
    if (piece && !this.wpFrame) {
      const [px, py] = piece.transform.position
      const len = piece.params.terrain?.kind === 'ramp' ? (piece.params.terrain.length ?? 2) : 1
      const [sx, sy] = snapTerrain(px + dx, py + dy, (piece.transform.rotation[2] * Math.PI) / 180, len)
      dx = cleanNum(sx - px)
      dy = cleanNum(sy - py)
      guides = []
    } else if (tile && !this.wpFrame) {
      const [px, py] = tile.transform.position
      dx = cleanNum(snapCell(px + dx) - px)
      dy = cleanNum(snapCell(py + dy) - py)
      guides = []
    }
    this.drawGuides(guides, d.movingZ)
    const w = this.toWorldDir(new Vector3(dx, dy, 0))
    const moved = moveNodes(d.base, d.ids, cleanVec([w.x, w.y, w.z], 6), d.base)
    // on the robotics field, things put down stand on the highest surface there
    previewGesture(d.base.scene === 'robo' && !this.wpFrame ? standOnTerrain(moved, d.ids, d.base) : moved)
    this.showLabel(e, `X ${fmt(dx)}   Y ${fmt(dy)}`)
  }

  // ---------------------------------------------------------------- handles

  private startHandle(spec: HandleSpec, e: PointerEvent): void {
    const ids = [...selection.value]
    if (ids.length === 0) return
    this.gizmo.setActive(spec)
    const camDir = this.camera.getWorldDirection(new Vector3())

    if (spec.kind === 'rotate') {
      const wb = this.wpSelectionBox(ids)
      if (!wb) return
      const center = new Vector3(...this.fromWp(boxCenter(wb)))
      const axisWorld = this.toWorldDir(axisVec(spec.axis))
      const plane = new Plane().setFromNormalAndCoplanarPoint(axisWorld, center)
      const p = this.rayPlane(e.clientX, e.clientY, plane)
      if (!p) return
      const base = beginGesture()
      const k = this.worldPerPixelAt(center)
      const r = Math.max(p.distanceTo(center), 40 * k)
      const startDeg = planeAngle(this.toWpDir(p.clone().sub(center)), spec.axis)
      this.gizmo.showProtractor(spec.axis, center, r, startDeg, k, this.wpQ)
      this.drag = {
        type: 'rotate',
        axis: spec.axis,
        axisWorld,
        base,
        ids,
        center,
        last: startDeg,
        total: 0,
        start: startDeg
      }
      return
    }

    if (spec.kind === 'lift') {
      const wb = this.wpSelectionBox(ids)
      if (!wb) return
      const c = new Vector3(...this.fromWp(boxCenter(wb)))
      const normal = this.wpNormal()
      // a plane that contains the lift direction and faces the camera as much as possible
      const m = camDir.clone().addScaledVector(normal, -camDir.dot(normal))
      if (m.lengthSq() < 1e-6) m.copy(this.toWorldDir(new Vector3(0, 1, 0)))
      const plane = new Plane().setFromNormalAndCoplanarPoint(m.normalize(), c)
      const p = this.rayPlane(e.clientX, e.clientY, plane)
      if (!p) return
      const base = beginGesture()
      this.drag = { type: 'lift', base, ids, start: p, plane, normal }
      return
    }

    // scale handles: single object
    const id = ids[0]
    const node = doc.value.nodes.find((n) => n.id === id)
    const obj = this.sync.objects.get(id)
    if (!node || !obj?.box) return
    const t = node.transform
    const rot = quatFromRotation(t.rotation)
    const frame = new Matrix4().compose(new Vector3(...t.position), rot, new Vector3(1, 1, 1))
    const { lo, hi } = scaledBox(obj.box, t.scale)
    const zAxis = new Vector3(0, 0, 1).applyQuaternion(rot)
    let normal: Vector3
    let anchorPoint: Vector3
    if (spec.kind === 'height') {
      normal = camDir.clone().addScaledVector(zAxis, -camDir.dot(zAxis))
      if (normal.lengthSq() < 1e-6) normal = new Vector3(1, 0, 0).applyQuaternion(rot)
      anchorPoint = new Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, hi[2]).applyMatrix4(frame)
    } else {
      normal = zAxis.clone()
      if (Math.abs(normal.dot(camDir)) < 0.12) normal = camDir.clone().negate()
      anchorPoint = new Vector3(0, 0, lo[2]).applyMatrix4(frame)
    }
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), anchorPoint)
    const base = beginGesture()
    this.drag = {
      type: 'scale',
      spec,
      base,
      id,
      ctx: {
        frame,
        frameInv: frame.clone().invert(),
        rot,
        geomBox: obj.box,
        scale: [...t.scale] as Vec3,
        lo,
        hi,
        plane
      }
    }
  }

  private doScale(d: Extract<Drag, { type: 'scale' }>, e: PointerEvent): void {
    const c = d.ctx
    const w = this.rayPlane(e.clientX, e.clientY, c.plane)
    if (!w) return
    const L = w.clone().applyMatrix4(c.frameInv)
    const step = gridStep.value
    const minSize = Math.max(step, 0.1)
    const oldExt: Vec3 = [c.hi[0] - c.lo[0], c.hi[1] - c.lo[1], c.hi[2] - c.lo[2]]
    const newLo: Vec3 = [...c.lo]
    const newHi: Vec3 = [...c.hi]
    // which axes move, and toward which side (+1 = max side moves)
    const moves: [number, 1 | -1][] = []
    const s = d.spec
    if (s.kind === 'corner') moves.push([0, s.sx], [1, s.sy])
    else if (s.kind === 'side') moves.push([s.axis, s.s])
    else if (s.kind === 'height') moves.push([2, 1])

    const ext: Vec3 = [...oldExt]
    for (const [k, side] of moves) {
      const anchor = side > 0 ? c.lo[k] : c.hi[k]
      const raw = side > 0 ? L.getComponent(k) - anchor : anchor - L.getComponent(k)
      ext[k] = Math.max(minSize, snap(raw, step))
    }
    if (e.shiftKey) {
      // proportional: use the largest relative change among moved axes
      let f = 1
      let best = 0
      for (const [k] of moves) {
        if (oldExt[k] < EPS) continue
        const fk = ext[k] / oldExt[k]
        if (Math.abs(fk - 1) >= best) {
          best = Math.abs(fk - 1)
          f = fk
        }
      }
      for (let k = 0; k < 3; k++) ext[k] = oldExt[k] * f
    }
    for (let k = 0; k < 3; k++) {
      const mv = moves.find((m) => m[0] === k)
      if (mv) {
        if (mv[1] > 0) {
          newLo[k] = c.lo[k]
          newHi[k] = c.lo[k] + ext[k]
        } else {
          newHi[k] = c.hi[k]
          newLo[k] = c.hi[k] - ext[k]
        }
      } else if (k === 2) {
        newLo[k] = c.lo[k]
        newHi[k] = c.lo[k] + ext[k]
      } else {
        const mid = (c.lo[k] + c.hi[k]) / 2
        newLo[k] = mid - ext[k] / 2
        newHi[k] = mid + ext[k] / 2
      }
    }
    const node = d.base.nodes.find((n) => n.id === d.id)!
    const g = c.geomBox
    const newScale = [...c.scale] as Vec3
    const offset = new Vector3()
    for (let k = 0; k < 3; k++) {
      const ge = g.max[k] - g.min[k]
      if (ge < EPS) continue
      const sAbs = (newHi[k] - newLo[k]) / ge
      newScale[k] = cleanNum(c.scale[k] < 0 ? -sAbs : sAbs)
      const a = g.min[k] * newScale[k]
      const b = g.max[k] * newScale[k]
      offset.setComponent(k, newLo[k] - Math.min(a, b))
    }
    offset.applyQuaternion(c.rot)
    const p = node.transform.position
    const pos: Vec3 = [cleanNum(p[0] + offset.x), cleanNum(p[1] + offset.y), cleanNum(p[2] + offset.z)]
    previewGesture(
      setTransform(d.base, d.id, { ...node.transform, position: pos, scale: newScale })
    )
    const sz = [newHi[0] - newLo[0], newHi[1] - newLo[1], newHi[2] - newLo[2]]
    this.showLabel(e, `${fmtLen(sz[0])} × ${fmtLen(sz[1])} × ${fmtLen(sz[2], true)}`)
  }

  private doLift(d: Extract<Drag, { type: 'lift' }>, e: PointerEvent): void {
    const p = this.rayPlane(e.clientX, e.clientY, d.plane)
    if (!p) return
    const dz = snap(p.clone().sub(d.start).dot(d.normal), gridStep.value)
    const w = d.normal.clone().multiplyScalar(dz)
    previewGesture(moveNodes(d.base, d.ids, cleanVec([w.x, w.y, w.z], 6), d.base))
    this.showLabel(e, `Z ${dz >= 0 ? '+' : ''}${fmtLen(dz, true)}`)
  }

  private doRotate(d: Extract<Drag, { type: 'rotate' }>, e: PointerEvent): void {
    const plane = new Plane().setFromNormalAndCoplanarPoint(d.axisWorld, d.center)
    const p = this.rayPlane(e.clientX, e.clientY, plane)
    if (!p) return
    const a = planeAngle(this.toWpDir(p.clone().sub(d.center)), d.axis)
    let delta = a - d.last
    while (delta > 180) delta -= 360
    while (delta < -180) delta += 360
    d.total += delta
    d.last = a
    // a full turn brings the object back where it started: restart the count from 0
    if (d.total >= 360) d.total -= 360
    if (d.total <= -360) d.total += 360
    // platforms, ramps and bridges lie on the tile grid: they turn by quarter turns only
    const terrain = d.base.nodes.some((n) => d.ids.includes(n.id) && n.kind === 'prim' && n.prim === 'terrain')
    const stepDeg = terrain ? 90 : e.shiftKey ? 1 : 22.5
    let snapped = Math.round(d.total / stepDeg) * stepDeg
    if (Math.abs(snapped) >= 360) snapped = 0
    const turned = rotateNodes(
      d.base,
      d.ids,
      [d.axisWorld.x, d.axisWorld.y, d.axisWorld.z],
      snapped,
      [d.center.x, d.center.y, d.center.z],
      d.base
    )
    previewGesture(terrain ? turnTerrainPieces(d.base, turned, d.ids, d.ids.length > 1 ? [d.center.x, d.center.y] : undefined) : turned)
    this.gizmo.setSweep(snapped)
    this.showLabel(e, `${snapped > 0 ? '+' : ''}${fmt(snapped)}°`)
  }

  // ---------------------------------------------------------------- ruler

  /**
   * Where the ruler would go for this cursor position: on the workplane, snapped to the grid,
   * or to a corner of a shape's footprint when close to one.
   */
  private rulerPoint(clientX: number, clientY: number): Frame | null {
    const n = this.wpNormal()
    const p = this.rayPlane(clientX, clientY, new Plane().setFromNormalAndCoplanarPoint(n, this.origin()))
    if (!p) return null
    const l = p.clone().applyMatrix4(this.wpInv)
    let x = snap(l.x, gridStep.value)
    let y = snap(l.y, gridStep.value)
    const tol = 8 * this.worldPerPixelAt(p)
    let best = tol
    for (const b of Object.values(this.wpBoxes(doc.peek().nodes.map((nd) => nd.id)))) {
      for (const cx of [b.min[0], b.max[0]])
        for (const cy of [b.min[1], b.max[1]]) {
          const d = Math.hypot(cx - l.x, cy - l.y)
          if (d < best) {
            best = d
            x = cleanNum(cx)
            y = cleanNum(cy)
          }
        }
    }
    const w = new Vector3(x, y, 0).applyMatrix4(this.wp)
    return {
      position: cleanVec([w.x, w.y, w.z], 6),
      rotation: this.wpFrame ? [...this.wpFrame.rotation] : [0, 0, 0]
    }
  }

  /** L-shaped ruler with ticks every 1 / 5 / 10 mm, in its own frame. */
  private buildRuler(): void {
    for (const c of [...this.rulerObj.children]) {
      this.rulerObj.remove(c)
      ;(c as LineSegments).geometry?.dispose()
    }
    this.rulerObj.matrixAutoUpdate = false
    const L = 120
    const pts: number[] = [0, 0, 0.1, L, 0, 0.1, 0, 0, 0.1, 0, L, 0.1]
    for (let i = 1; i <= L; i++) {
      const len = i % 10 === 0 ? 5 : i % 5 === 0 ? 3 : 1.5
      pts.push(i, 0, 0.1, i, -len, 0.1)
      pts.push(0, i, 0.1, -len, i, 0.1)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pts, 3))
    const legs = new LineSegments(
      g,
      new LineBasicMaterial({ color: THEME.handleCorner, depthTest: false, transparent: true })
    )
    legs.renderOrder = 996
    legs.raycast = () => undefined
    const dot = new Mesh(
      new PlaneGeometry(4, 4),
      new MeshBasicMaterial({ color: THEME.handleCorner, depthTest: false, transparent: true, side: DoubleSide })
    )
    dot.renderOrder = 996
    dot.raycast = () => undefined
    this.rulerObj.add(legs, dot)
    ;(this.rulerLines.material as LineDashedMaterial).color.set(THEME.handleCorner)
  }

  /** Selection box in the ruler's frame, and the measured point (near edge or center). */
  private rulerMeasure(): { box: Box; at: [number, number] } | null {
    if (!ruler.peek() || placingRuler.peek()) return null
    const ids = selection.peek()
    if (!ids.length) return null
    const box = unionBoxes(Object.values(this.sync.boxesInFrame(ids, this.rulerInv)))
    if (!box) return null
    const center = rulerMode.peek() === 'center'
    const pick = (k: 0 | 1) => {
      if (center) return (box.min[k] + box.max[k]) / 2
      // the edge nearer to the ruler leg
      return Math.abs(box.min[k]) <= Math.abs(box.max[k]) ? box.min[k] : box.max[k]
    }
    return { box, at: [cleanNum(pick(0), 4), cleanNum(pick(1), 4)] }
  }

  /** Dashed lines from the ruler legs to the measured point of the selection. */
  private updateRulerLines(): void {
    if (!this.rulerLines) return
    const m = this.rulerMeasure()
    const pts: number[] = []
    if (m) {
      const [x, y] = m.at
      const v = new Vector3()
      const push = (a: number, b: number) => {
        v.set(a, b, 0.2).applyMatrix4(this.rulerM)
        pts.push(v.x, v.y, v.z)
      }
      push(0, y)
      push(x, y)
      push(x, 0)
      push(x, y)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pts, 3))
    this.rulerLines.geometry.dispose()
    this.rulerLines.geometry = g
    this.rulerLines.computeLineDistances()
  }

  // ---------------------------------------------------------------- guides, shadows, dimensions

  private drawGuides(list: Guide[], z: number): void {
    const pts: number[] = []
    const v = new Vector3()
    const push = (x: number, y: number) => {
      v.set(x, y, z).applyMatrix4(this.wp)
      pts.push(v.x, v.y, v.z)
    }
    for (const g of list) {
      const pad = 6
      if (g.axis === 0) {
        push(g.value, g.from - pad)
        push(g.value, g.to + pad)
      } else {
        push(g.from - pad, g.value)
        push(g.to + pad, g.value)
      }
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(pts, 3))
    this.guides.geometry.dispose()
    this.guides.geometry = geo
    this.guides.computeLineDistances()
    this.invalidate()
  }

  /**
   * Flattened copies of lifted selected shapes lying on the workplane (the exact silhouette),
   * plus a dashed line from the shape down to it.
   */
  private updateShadows(): void {
    this.updateRulerLines()
    for (const c of [...this.shadows.children]) {
      this.shadows.remove(c)
      if (c instanceof LineSegments) c.geometry.dispose()
    }
    if (placingWorkplane.peek() || session.peek()) return
    const flatten = new Matrix4().makeScale(1, 1, 0).setPosition(0, 0, 0.05)
    const proj = this.wp.clone().multiply(flatten).multiply(this.wpInv)
    for (const id of selection.peek()) {
      const obj = this.sync.objects.get(id)
      const b = this.sync.boxInFrame(id, this.wpInv)
      if (!obj || !b || b.min[2] < 0.05) continue
      obj.updateWorldMatrix(true, true)
      obj.traverse((o) => {
        if (!(o instanceof Mesh) || !o.visible) return
        const s = new Mesh(o.geometry, this.shadowMat)
        s.matrixAutoUpdate = false
        s.matrix.multiplyMatrices(proj, o.matrixWorld)
        s.raycast = () => undefined
        s.renderOrder = -0.5
        this.shadows.add(s)
      })
      const cx = (b.min[0] + b.max[0]) / 2
      const cy = (b.min[1] + b.max[1]) / 2
      const a = new Vector3(cx, cy, 0).applyMatrix4(this.wp)
      const top = new Vector3(cx, cy, b.min[2]).applyMatrix4(this.wp)
      const g = new BufferGeometry().setFromPoints([a, top])
      const line = new LineSegments(g, this.elevLineMat)
      line.computeLineDistances()
      line.raycast = () => undefined
      this.shadows.add(line)
    }
  }

  // ---------------------------------------------------------------- sketch mode

  private sketchHost() {
    return {
      scene: this.scene,
      camera: this.camera,
      canvas: this.renderer.domElement,
      invalidate: () => this.invalidate(),
      ray: (x: number, y: number) => this.setRay(x, y).ray,
      worldPerPixelAt: (p: Vector3) => this.worldPerPixelAt(p),
      showLabel: (e: { clientX: number; clientY: number }, text: string) => this.showLabel(e, text),
      hideLabel: () => {
        this.label.style.display = 'none'
      },
      showBox: (x0: number, y0: number, x1: number, y1: number) => {
        const r = this.container.getBoundingClientRect()
        Object.assign(this.boxEl.style, {
          display: 'block',
          left: `${Math.min(x0, x1) - r.left}px`,
          top: `${Math.min(y0, y1) - r.top}px`,
          width: `${Math.abs(x1 - x0)}px`,
          height: `${Math.abs(y1 - y0)}px`
        })
      },
      hideBox: () => {
        this.boxEl.style.display = 'none'
      },
      toView: (p: Vector3) => this.toScreen(p),
      toClient: (p: Vector3) => {
        const s = this.toScreen(p)
        if (!s) return null
        const r = this.container.getBoundingClientRect()
        return { x: s.x + r.left, y: s.y + r.top }
      }
    }
  }

  /**
   * Start a sketch where the user clicked: on the face under the cursor, or else on the
   * workplane. On a face the sketch origin is the workplane origin projected onto the face, so
   * coordinates line up with the grid. The camera turns to look straight at the plane.
   */
  private startSketchAt(clientX: number, clientY: number): void {
    const onPlane = this.refPlaneHit(clientX, clientY)
    const hit = onPlane ? null : this.pickNode(clientX, clientY)
    let frame: Frame
    let target: Vector3
    if (onPlane) {
      frame = onPlane.frame
      target = onPlane.point
    } else if (hit && hit.normal) {
      const n = hit.normal.clone()
      if (n.dot(this.ray.ray.direction) > 0) n.negate()
      const f = frameFromHit(hit.point, n)
      const o = this.origin()
      const onFace = o.clone().addScaledVector(n, -o.clone().sub(hit.point).dot(n))
      frame = { position: cleanVec([onFace.x, onFace.y, onFace.z], 4), rotation: f.rotation }
      target = hit.point
    } else {
      frame = this.wpFrame ?? GROUND
      const n = this.wpNormal()
      const plane = new Plane().setFromNormalAndCoplanarPoint(n, this.origin())
      target = plane.projectPoint(this.controls.target, new Vector3())
    }
    this.wpPreview.visible = false
    startSession(frame)
    this.lookAtPlane(new Vector3(0, 0, 1).applyQuaternion(quatFromRotation(frame.rotation)), target)
  }

  /** Turn the camera to face a plane head-on. */
  lookAtPlane(normal: Vector3, target: Vector3): void {
    const n = normal.clone().normalize()
    if (Math.abs(n.z) > 0.999) n.set(0, -0.002 * Math.sign(n.z || 1), n.z).normalize()
    const now = sameView(this.camera.position.distanceTo(this.controls.target), this.camera.fov, FOV)
    const dist = Math.min(600, Math.max(120, now))
    this.animateTo(n, sameView(dist, FOV, SKETCH_FOV), target, SKETCH_FOV)
  }

  /** Open an extruded sketch shape for editing (double click). Returns false for other shapes. */
  editSketchNode(id: string): boolean {
    const n = doc.peek().nodes.find((x) => x.id === id)
    if (!n || n.kind !== 'prim' || n.prim !== 'sketch' || !n.params.sketch) return false
    placingWorkplane.value = false
    placingRuler.value = false
    sketchPicking.value = false
    startSession({ position: [...n.transform.position], rotation: [...n.transform.rotation] }, n.params.sketch, id, 'select')
    this.lookAtSketch()
    return true
  }

  /** Camera back to looking at the current sketch plane. */
  lookAtSketch(): void {
    const s = session.peek()
    if (!s) return
    this.lookAtPlane(new Vector3(0, 0, 1).applyQuaternion(quatFromRotation(s.frame.rotation)), new Vector3(...s.frame.position))
  }

  private toScreen(p: Vector3): { x: number; y: number } | null {
    const v = p.clone().project(this.camera)
    if (v.z > 1 || v.z < -1) return null
    return {
      x: ((v.x + 1) / 2) * this.container.clientWidth,
      y: ((1 - v.y) / 2) * this.container.clientHeight
    }
  }

  /** Size labels next to the selected shape's edges, and its height above the workplane. */
  private updateDims(): void {
    const next: DimLabel[] = []
    // a pin over each static shape of the field (while editing): it does not move
    const d0 = doc.peek()
    if (d0.scene === 'robo' && !this.bare && !simActive.peek()) {
      const fixed = d0.nodes.filter((n) => n.kind === 'prim' && n.prim === 'mesh' && n.fixed).map((n) => n.id)
      const boxes = fixed.length ? this.sync.worldBoxes(fixed) : {}
      for (const id of fixed) {
        const b = boxes[id]
        if (!b) continue
        const s = this.toScreen(new Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.max[2]))
        if (s) next.push({ id: `pin-${id}`, kind: 'pin', axis: 2, value: 0, x: s.x, y: s.y - 16 })
      }
    }
    const ids = selection.peek()
    const dt = this.drag.type
    const show =
      ids.length === 1 &&
      !aligning.peek() &&
      !session.peek() &&
      !placingWorkplane.peek() &&
      (dt === 'none' || dt === 'scale' || dt === 'lift' || dt === 'pending')
    if (show) {
      const id = ids[0]
      const n = doc.peek().nodes.find((x) => x.id === id)
      const obj = this.sync.objects.get(id)
      if (n && obj?.box) {
        const tr = n.transform
        const F = new Matrix4().compose(
          new Vector3(...tr.position),
          quatFromRotation(tr.rotation),
          new Vector3(1, 1, 1)
        )
        const { lo, hi } = scaledBox(obj.box, tr.scale)
        const cam = this.camera.getWorldPosition(new Vector3()).applyMatrix4(F.clone().invert())
        const cx = (lo[0] + hi[0]) / 2
        const cy = (lo[1] + hi[1]) / 2
        const sx = cam.x < cx ? -1 : 1
        const sy = cam.y < cy ? -1 : 1
        const xs = sx < 0 ? lo[0] : hi[0]
        const ys = sy < 0 ? lo[1] : hi[1]
        const place = (local: Vector3, out: Vector3, idx: 0 | 1 | 2, value: number) => {
          const a = this.toScreen(local.clone().applyMatrix4(F))
          const b = this.toScreen(local.clone().add(out).applyMatrix4(F))
          if (!a || !b) return
          let dx = b.x - a.x
          let dy = b.y - a.y
          const len = Math.hypot(dx, dy) || 1
          dx /= len
          dy /= len
          next.push({ id: `size${idx}`, kind: 'size', axis: idx, value, x: a.x + dx * 30, y: a.y + dy * 30, push: [dx, dy] })
        }
        const unit = Math.max(1, hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 0.1
        place(new Vector3(cx, ys, lo[2]), new Vector3(0, sy * unit, 0), 0, hi[0] - lo[0])
        place(new Vector3(xs, cy, lo[2]), new Vector3(sx * unit, 0, 0), 1, hi[1] - lo[1])
        // height: beside the vertical edge nearest the camera, pushed sideways away from the shape
        const hEdge = this.toScreen(new Vector3(xs, ys, (lo[2] + hi[2]) / 2).applyMatrix4(F))
        const hMid = this.toScreen(new Vector3(cx, cy, (lo[2] + hi[2]) / 2).applyMatrix4(F))
        if (hEdge && hMid) {
          const side = hEdge.x >= hMid.x ? 1 : -1
          next.push({ id: 'size2', kind: 'size', axis: 2, value: hi[2] - lo[2], x: hEdge.x + side * 36, y: hEdge.y - 10, push: [side, 0] })
        }
        const wb = this.sync.boxInFrame(id, this.wpInv)
        if (wb && Math.abs(wb.min[2]) > 0.05) {
          const mid = new Vector3((wb.min[0] + wb.max[0]) / 2, (wb.min[1] + wb.max[1]) / 2, wb.min[2] / 2)
          const s = this.toScreen(mid.applyMatrix4(this.wp))
          if (s) next.push({ id: 'elev', kind: 'elev', axis: 2, value: cleanNum(wb.min[2], 3), x: s.x - 40, y: s.y, push: [-1, 0] })
        }
      }
    }
    // ruler: its buttons at the origin, and the distances to the selection along its legs
    const r = ruler.peek()
    if (r && !session.peek() && !placingRuler.peek() && dt !== 'move' && dt !== 'rotate') {
      const o = this.toScreen(new Vector3(...r.position))
      if (o) next.push({ id: 'rulerOrigin', kind: 'rulerOrigin', axis: 0, value: 0, x: o.x - 34, y: o.y + 28 })
      const m = this.rulerMeasure()
      if (m) {
        const [x, y] = m.at
        const lx = this.toScreen(new Vector3(x / 2, y, 0).applyMatrix4(this.rulerM))
        const ly = this.toScreen(new Vector3(x, y / 2, 0).applyMatrix4(this.rulerM))
        if (lx && Math.abs(x) > 1e-6) next.push({ id: 'rulerX', kind: 'ruler', axis: 0, value: x, x: lx.x, y: lx.y })
        if (ly && Math.abs(y) > 1e-6) next.push({ id: 'rulerY', kind: 'ruler', axis: 1, value: y, x: ly.x, y: ly.y })
      }
    }
    // labels never cover each other (on a small or far shape they would all meet) nor the handles
    const placed = separateDims(next, 4, this.gizmo.screenPoints((p) => this.toScreen(p)))
    if (!sameDims(dims.peek(), placed)) dims.value = placed
  }

  /** Apply a number typed into a dimension label. */
  applyDim(d: DimLabel, value: number): void {
    if (d.kind === 'ruler') return this.applyRulerDim(d, value)
    const id = selection.peek()[0]
    if (!id) return
    const n = doc.peek().nodes.find((x) => x.id === id)
    const obj = this.sync.objects.get(id)
    if (!n || !obj?.box) return
    if (d.kind === 'size') {
      if (value <= 0) return
      const { lo, hi } = scaledBox(obj.box, n.transform.scale)
      const size: Vec3 = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]
      size[d.axis] = value
      commit(setTransform(doc.peek(), id, { ...n.transform, scale: sizeToScale(obj.box, size, n.transform.scale) }))
    } else {
      const shift = this.wpNormal().multiplyScalar(value - d.value)
      commit(moveNodes(doc.peek(), [id], cleanVec([shift.x, shift.y, shift.z], 6)))
    }
  }

  /** Move the selection so its distance from the ruler along one leg becomes `value`. */
  private applyRulerDim(d: DimLabel, value: number): void {
    const ids = selection.peek()
    if (!ids.length) return
    const axisDir = new Vector3(d.axis === 0 ? 1 : 0, d.axis === 1 ? 1 : 0, 0).applyQuaternion(
      new Quaternion().setFromRotationMatrix(this.rulerM)
    )
    const shift = axisDir.multiplyScalar(value - d.value)
    commit(moveNodes(doc.peek(), ids, cleanVec([shift.x, shift.y, shift.z], 6)))
  }

  /** Pixel size in world units at a point (for UI that wants constant screen size). */
  worldPerPixelAt(p: Vector3): number {
    return worldPerPixel(this.camera, p, this.container.clientHeight)
  }

  /** Canvas as PNG data URL (used for tests/screenshots). */
  snapshot(): string {
    this.needsRender = true
    this.step()
    return this.renderer.domElement.toDataURL('image/png')
  }

  /** For drag-and-drop from the shapes panel. */
  shapeDropTarget(): HTMLElement {
    return this.container
  }
}

export function scaledBox(g: Box, s: Vec3): { lo: Vec3; hi: Vec3 } {
  const lo = [0, 0, 0] as Vec3
  const hi = [0, 0, 0] as Vec3
  for (let k = 0; k < 3; k++) {
    const a = g.min[k] * s[k]
    const b = g.max[k] * s[k]
    lo[k] = Math.min(a, b)
    hi[k] = Math.max(a, b)
  }
  return { lo, hi }
}

/** Middle of the 300 mm floor cell a coordinate falls in (tile centres). */
export const snapCell = (v: number) => Math.floor(v / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2

export function snap(v: number, step: number): number {
  if (!step) return cleanNum(v, 4)
  return cleanNum(Math.round(v / step) * step, 6)
}

function fmt(v: number): string {
  return (Math.round(v * 100) / 100).toString()
}

function axisVec(axis: Axis): Vector3 {
  return new Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0)
}

/** Angle (degrees) of a vector in the plane perpendicular to `axis`, right-handed around it. */
function planeAngle(v: Vector3, axis: Axis): number {
  const a = v.getComponent((axis + 1) % 3)
  const b = v.getComponent((axis + 2) % 3)
  return (Math.atan2(b, a) * 180) / Math.PI
}

function slerpDir(a: Vector3, b: Vector3, t: number): Vector3 {
  const q = new Quaternion().setFromUnitVectors(a, b)
  const qi = new Quaternion().slerp(q, t)
  return a.clone().applyQuaternion(qi).normalize()
}

export type { PrimType }
