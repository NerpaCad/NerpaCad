/**
 * Tinkercad-style manipulation handles:
 *  - 4 yellow corner squares on the bottom face (scale X+Y),
 *  - 4 cyan side squares on the bottom edges (scale one axis),
 *  - a yellow square on top (height),
 *  - a red cone above the object (lift along Z),
 *  - 3 curved double-headed arrows (rotate around world X / Y / Z).
 * While rotating, a protractor with degree ticks and the swept sector replaces the handles.
 * Handles keep a constant size on screen and are drawn on top of everything.
 */
import {
  BufferGeometry,
  Camera,
  Color,
  ConeGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3
} from 'three'
import type { Box } from '../core/doc/model'
import { THEME } from './theme'

export type HandleSpec =
  | { kind: 'corner'; sx: -1 | 1; sy: -1 | 1 }
  | { kind: 'side'; axis: 0 | 1; s: -1 | 1 }
  | { kind: 'height' }
  | { kind: 'lift' }
  | { kind: 'rotate'; axis: 0 | 1 | 2 }

export interface GizmoTarget {
  /** node frame without scale: T·R */
  frame: Matrix4
  /** geometry box multiplied by scale, sorted (min<max), in the node frame */
  scaledBox: Box | null
  /** workplane frame (lift and rotation handles work along its axes) */
  plane: Matrix4
  /** box of the selection in workplane coordinates */
  planeBox: Box
  /** things that stay flat on the floor (tiles, robots): only the turn around Z */
  flat?: boolean
}

interface HandleObj {
  spec: HandleSpec
  obj: Object3D
  mats: (MeshBasicMaterial | LineBasicMaterial)[]
  base: Color
  hot: Color
  pick: Mesh
}

/** A rim colour that stands out from `c`: white round a dark colour, near-black round a light one. */
export function rimFor(c: string): string {
  const k = new Color(c)
  return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b < 0.45 ? '#ffffff' : '#15171f'
}

const onTop = (o: Object3D) => {
  o.renderOrder = 1000
  o.traverse((c) => {
    c.renderOrder = 1000
    const m = (c as Mesh).material as MeshBasicMaterial | undefined
    if (m) {
      m.depthTest = false
      m.depthWrite = false
      m.transparent = true
    }
  })
}

/**
 * Outline of a curved double-headed arrow lying on a circle of radius r in the XY plane,
 * centred on angle 0 and spanning `span` radians. All sizes in world units.
 */
function arrowOutline(r: number, span: number, w: number, headLen: number, headW: number): Vector2[] {
  const P = (a: number, rad: number) => new Vector2(Math.cos(a) * rad, Math.sin(a) * rad)
  const a0 = -span / 2
  const a1 = span / 2
  const hA = Math.min(headLen / r, span / 3)
  const n = 20
  const pts: Vector2[] = [P(a1, r), P(a1 - hA, r + headW)]
  for (let i = 0; i <= n; i++) pts.push(P(a1 - hA - ((span - 2 * hA) * i) / n, r + w))
  pts.push(P(a0 + hA, r + headW), P(a0, r), P(a0 + hA, r - headW))
  for (let i = 0; i <= n; i++) pts.push(P(a0 + hA + ((span - 2 * hA) * i) / n, r - w))
  pts.push(P(a1 - hA, r - headW))
  return pts
}

function shapeGeometry(pts: Vector2[]): BufferGeometry {
  return new ShapeGeometry(new Shape(pts))
}

function loopGeometry(pts: Vector2[]): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, 0]), 3))
  return g
}

export class Gizmo {
  readonly root = new Group()
  private handles: HandleObj[] = []
  private outlineMats: LineBasicMaterial[] = []
  /**
   * The light (or dark) rims drawn behind the handles, each with the colour it stands out from:
   * a handle is seen on a shape of its own colour too
   */
  private rims: { mat: MeshBasicMaterial; of: () => string }[] = []
  private target: GizmoTarget | null = null
  private hovered: HandleObj | null = null
  private active: HandleObj | null = null
  private showScale = true
  private protractor: {
    group: Group
    sector: Mesh
    edge: LineSegments
    radius: number
    start: number
  } | null = null

  constructor() {
    this.root.name = 'gizmo'
    this.root.visible = false
    const square = new PlaneGeometry(1, 1)
    const squareEdges = new EdgesGeometry(square)
    const mkSquare = (spec: HandleSpec, color: string, size: number, of: () => string) => {
      const mat = new MeshBasicMaterial({ color, side: DoubleSide })
      const m = new Mesh(square, mat)
      m.scale.setScalar(size)
      const om = new LineBasicMaterial({ color: THEME.handleOutline })
      this.outlineMats.push(om)
      const e = new LineSegments(squareEdges, om)
      m.add(e)
      // a rim 2 px wide all round
      const rim = new Mesh(square, this.rim(of))
      rim.scale.setScalar(size + 4)
      rim.name = 'rim'
      const holder = new Group()
      holder.add(rim, m)
      this.add({
        spec,
        obj: holder,
        mats: [mat],
        base: new Color(color),
        hot: new Color(THEME.handleHot),
        pick: m
      })
    }
    for (const sx of [-1, 1] as const)
      for (const sy of [-1, 1] as const) mkSquare({ kind: 'corner', sx, sy }, THEME.handleCorner, 9, () => THEME.handleCorner)
    for (const axis of [0, 1] as const)
      for (const s of [-1, 1] as const) mkSquare({ kind: 'side', axis, s }, THEME.handleSide, 7, () => THEME.handleSide)
    mkSquare({ kind: 'height' }, THEME.handleCorner, 9, () => THEME.handleCorner)

    // lift cone, with a rim of the opposite brightness drawn behind it: seen on a dark shape and
    // on a light one alike
    {
      const mat = new MeshBasicMaterial({ color: THEME.lift })
      const cone = new Mesh(new ConeGeometry(5, 14, 20), mat)
      cone.rotation.x = Math.PI / 2 // ConeGeometry points +Y; make it point +Z
      const rim = new Mesh(new ConeGeometry(7.2, 18.5, 20), this.rim(() => THEME.lift))
      rim.rotation.x = Math.PI / 2
      rim.position.z = 0.6
      rim.name = 'lift-rim'
      const holder = new Group()
      holder.add(rim, cone)
      this.add({
        spec: { kind: 'lift' },
        obj: holder,
        mats: [mat],
        base: new Color(THEME.lift),
        hot: new Color(THEME.handleHot),
        pick: cone
      })
    }

    // rotation arrows: geometry is rebuilt in update() since it depends on distance and zoom
    for (const axis of [0, 1, 2] as const) {
      const fillMat = new MeshBasicMaterial({ color: THEME.rotate, side: DoubleSide })
      const lineMat = new LineBasicMaterial({ color: THEME.handleOutline })
      this.outlineMats.push(lineMat)
      const fill = new Mesh(new BufferGeometry(), fillMat)
      const outline = new LineLoop(new BufferGeometry(), lineMat)
      const pick = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ visible: false, side: DoubleSide }))
      const rim = new Mesh(new BufferGeometry(), this.rim(() => THEME.rotate))
      rim.name = 'rim'
      const holder = new Group()
      holder.add(fill, outline, pick, rim)
      this.add({
        spec: { kind: 'rotate', axis },
        obj: holder,
        mats: [fillMat],
        base: new Color(THEME.rotate),
        hot: new Color(THEME.rotateHot),
        pick
      })
    }
  }

  private rim(of: () => string): MeshBasicMaterial {
    const mat = new MeshBasicMaterial({ color: rimFor(of()), side: DoubleSide })
    this.rims.push({ mat, of })
    return mat
  }

  private add(h: HandleObj): void {
    onTop(h.obj)
    // the rims under their handles
    h.obj.traverse((c) => {
      if (this.rims.some((r) => (c as Mesh).material === r.mat)) c.renderOrder = 999
    })
    h.obj.userData.handle = h
    h.pick.userData.handle = h
    this.handles.push(h)
    this.root.add(h.obj)
  }

  /** Re-read handle colors after a theme change. */
  applyTheme(): void {
    for (const h of this.handles) {
      const k = h.spec.kind
      h.base.set(
        k === 'corner' || k === 'height'
          ? THEME.handleCorner
          : k === 'side'
            ? THEME.handleSide
            : k === 'lift'
              ? THEME.lift
              : THEME.rotate
      )
      h.hot.set(k === 'rotate' ? THEME.rotateHot : THEME.handleHot)
    }
    this.outlineMats.forEach((m) => m.color.set(THEME.handleOutline))
    for (const r of this.rims) r.mat.color.set(rimFor(r.of()))
    this.recolor()
  }

  setTarget(t: GizmoTarget | null, showScale: boolean): void {
    this.target = t
    this.showScale = showScale
    this.root.visible = !!t
  }

  get visible(): boolean {
    return this.root.visible
  }

  setVisible(v: boolean): void {
    this.root.visible = v && !!this.target
  }

  setHover(spec: HandleSpec | null): boolean {
    const h = spec ? (this.handles.find((x) => x.spec === spec) ?? null) : null
    if (h === this.hovered) return false
    this.hovered = h
    this.recolor()
    return true
  }

  setActive(spec: HandleSpec | null): void {
    this.active = spec ? (this.handles.find((x) => x.spec === spec) ?? null) : null
    this.recolor()
  }

  private recolor(): void {
    for (const h of this.handles) {
      const hot = h === this.hovered || h === this.active
      h.mats.forEach((m) => m.color.copy(hot ? h.hot : h.base))
    }
  }

  /**
   * Where the handles are on screen (points along their outlines and their middles), for the
   * size labels to keep clear of them. `project`: world point → screen, or null behind the camera.
   */
  screenPoints(project: (p: Vector3) => { x: number; y: number } | null): [number, number][] {
    const out: [number, number][] = []
    if (!this.root.visible) return out
    this.root.updateMatrixWorld(true)
    const v = new Vector3()
    const add = (p: Vector3) => {
      const s = project(p)
      if (s) out.push([s.x, s.y])
    }
    for (const h of this.handles) {
      if (!h.obj.visible) continue
      add(h.obj.getWorldPosition(v))
      h.obj.traverse((c) => {
        const m = c as Mesh
        if (!m.isMesh || (m.material as MeshBasicMaterial).visible === false) return
        const pos = m.geometry.getAttribute('position')
        if (!pos) return
        const step = Math.max(1, Math.floor(pos.count / 24))
        for (let i = 0; i < pos.count; i += step) add(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld))
      })
    }
    return out
  }

  pick(ray: Raycaster): HandleSpec | null {
    if (!this.root.visible) return null
    const picks = this.handles.filter((h) => h.obj.visible).map((h) => h.pick)
    const hit = ray.intersectObjects(picks, false)[0]
    return hit ? (hit.object.userData.handle as HandleObj).spec : null
  }

  // ------------------------------------------------------------------ protractor

  /**
   * Show a protractor around the rotation axis: a ring, ticks every 15° (long ones every 45°)
   * starting at the grab angle, and a filled sector for the angle swept so far.
   * `k` is world units per screen pixel at the center.
   */
  showProtractor(
    axis: 0 | 1 | 2,
    center: Vector3,
    radius: number,
    startDeg: number,
    k: number,
    planeQ: Quaternion = new Quaternion()
  ): void {
    this.hideProtractor()
    const group = new Group()
    const lineMat = new LineBasicMaterial({ color: THEME.protractor, opacity: 0.85 })
    const ring: Vector2[] = []
    for (let i = 0; i < 128; i++) {
      const a = (i / 128) * Math.PI * 2
      ring.push(new Vector2(Math.cos(a) * radius, Math.sin(a) * radius))
    }
    group.add(new LineLoop(loopGeometry(ring), lineMat))

    const ticks: number[] = []
    const s0 = (startDeg * Math.PI) / 180
    for (let d = 0; d < 360; d += 15) {
      const a = s0 + (d * Math.PI) / 180
      const len = (d % 45 === 0 ? 14 : 7) * k
      const c = Math.cos(a)
      const s = Math.sin(a)
      ticks.push(c * radius, s * radius, 0, c * (radius - len), s * (radius - len), 0)
    }
    const tickGeo = new BufferGeometry()
    tickGeo.setAttribute('position', new Float32BufferAttribute(ticks, 3))
    group.add(new LineSegments(tickGeo, lineMat))

    const sector = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({ color: THEME.sweep, opacity: 0.28, side: DoubleSide })
    )
    const edge = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: THEME.sweep }))
    group.add(sector, edge)

    group.quaternion.copy(planeQ).multiply(axisBasis(axis))
    group.position.copy(center)
    onTop(group)
    this.root.add(group)
    this.protractor = { group, sector, edge, radius, start: s0 }
    this.setSweep(0)
  }

  /** Update the swept sector (degrees, signed). */
  setSweep(deg: number): void {
    const p = this.protractor
    if (!p) return
    const a0 = p.start
    const a1 = p.start + (deg * Math.PI) / 180
    const r = p.radius
    const pts = [new Vector2(0, 0)]
    const n = Math.max(2, Math.ceil(Math.abs(deg) / 4))
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      pts.push(new Vector2(Math.cos(a) * r, Math.sin(a) * r))
    }
    p.sector.geometry.dispose()
    p.sector.geometry = Math.abs(deg) > 0.01 ? shapeGeometry(pts) : new BufferGeometry()
    const e = new BufferGeometry()
    e.setAttribute(
      'position',
      new Float32BufferAttribute(
        [0, 0, 0, Math.cos(a0) * r, Math.sin(a0) * r, 0, 0, 0, 0, Math.cos(a1) * r, Math.sin(a1) * r, 0],
        3
      )
    )
    p.edge.geometry.dispose()
    p.edge.geometry = e
  }

  hideProtractor(): void {
    if (!this.protractor) return
    this.root.remove(this.protractor.group)
    this.protractor.group.traverse((o) => (o as Mesh).geometry?.dispose())
    this.protractor = null
  }

  // ------------------------------------------------------------------ layout

  /** Reposition and rescale handles for the current camera. */
  update(camera: Camera, viewportHeight: number): void {
    const t = this.target
    if (!t || !this.root.visible) return
    const rotating = this.protractor !== null
    // lift and rotation handles are laid out in workplane coordinates, then mapped to world
    const P = t.plane
    const planeQ = new Quaternion().setFromRotationMatrix(P)
    const toWorld = (p: Vector3) => p.clone().applyMatrix4(P)
    const px = (p: Vector3) => worldPerPixel(camera, p, viewportHeight)
    const pxLocal = (p: Vector3) => px(toWorld(p))
    const wb = t.planeBox
    const wc = new Vector3(
      (wb.min[0] + wb.max[0]) / 2,
      (wb.min[1] + wb.max[1]) / 2,
      (wb.min[2] + wb.max[2]) / 2
    )
    const camPos = camera.getWorldPosition(new Vector3()).applyMatrix4(P.clone().invert())
    const camQ = camera.getWorldQuaternion(new Quaternion())

    for (const h of this.handles) {
      const s = h.spec
      h.obj.visible = !rotating
      if (rotating) continue
      if (t.flat && (s.kind !== 'rotate' || s.axis !== 2)) {
        h.obj.visible = false
        continue
      }
      if (s.kind === 'corner' || s.kind === 'side' || s.kind === 'height') {
        if (!t.scaledBox || !this.showScale) {
          h.obj.visible = false
          continue
        }
        const b = t.scaledBox
        const cx = (b.min[0] + b.max[0]) / 2
        const cy = (b.min[1] + b.max[1]) / 2
        let p: Vector3
        if (s.kind === 'corner') {
          p = new Vector3(s.sx < 0 ? b.min[0] : b.max[0], s.sy < 0 ? b.min[1] : b.max[1], b.min[2])
        } else if (s.kind === 'side') {
          p =
            s.axis === 0
              ? new Vector3(s.s < 0 ? b.min[0] : b.max[0], cy, b.min[2])
              : new Vector3(cx, s.s < 0 ? b.min[1] : b.max[1], b.min[2])
        } else {
          p = new Vector3(cx, cy, b.max[2])
        }
        p.applyMatrix4(t.frame)
        h.obj.position.copy(p)
        h.obj.quaternion.copy(camQ) // squares always face the viewer
        h.obj.scale.setScalar(px(p))
      } else if (s.kind === 'lift') {
        const top = new Vector3(wc.x, wc.y, wb.max[2])
        const k = pxLocal(top)
        top.z += 26 * k
        h.obj.position.copy(toWorld(top))
        h.obj.quaternion.copy(planeQ)
        h.obj.scale.setScalar(k)
      } else {
        this.layoutArrow(h, s.axis, wb, wc, camPos, pxLocal, P, planeQ)
      }
    }
  }

  /** Place a curved rotation arrow just outside the object, on the side facing the camera. */
  private layoutArrow(
    h: HandleObj,
    axis: 0 | 1 | 2,
    wb: Box,
    wc: Vector3,
    camPos: Vector3,
    px: (p: Vector3) => number,
    P: Matrix4,
    planeQ: Quaternion
  ): void {
    // an arrow seen edge-on is just a line and can't be dragged sensibly: hide it
    const view = wc.clone().sub(camPos).normalize()
    if (Math.abs(view.getComponent(axis)) < 0.25) {
      h.obj.visible = false
      return
    }
    const k = px(wc)
    const a = (axis + 1) % 3
    const b = (axis + 2) % 3
    const ha = (wb.max[a] - wb.min[a]) / 2
    const hb = (wb.max[b] - wb.min[b]) / 2
    const radius = Math.hypot(ha, hb) + 26 * k
    const center = wc.clone()
    if (axis === 2) center.z = wb.min[2]
    // aim at the box corner nearest to the camera, in the rotation plane
    const toCam = camPos.clone().sub(center)
    const u = Math.sign(toCam.getComponent(a)) || 1
    const v = Math.sign(toCam.getComponent(b)) || 1
    const theta = Math.atan2(v * (hb + 1e-6), u * (ha + 1e-6))

    const span = Math.min((120 * k) / radius, 1.3)
    const outline = arrowOutline(radius, span, 2.6 * k, 12 * k, 7.5 * k)
    const pickOutline = arrowOutline(radius, span, 9 * k, 12 * k, 12 * k)
    // the rim: the same arrow 2 px fatter all round (its tips 2 px further out)
    const e = 2 * k
    const rimOutline = arrowOutline(radius, span + (2 * e) / radius, 2.6 * k + e, 12 * k + e, 7.5 * k + e * 1.6)
    const [fill, line, pick, rim] = h.obj.children as [Mesh, LineLoop, Mesh, Mesh]
    fill.geometry.dispose()
    line.geometry.dispose()
    pick.geometry.dispose()
    rim.geometry.dispose()
    fill.geometry = shapeGeometry(outline)
    line.geometry = loopGeometry(outline)
    pick.geometry = shapeGeometry(pickOutline)
    rim.geometry = shapeGeometry(rimOutline)
    const spin = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), theta)
    h.obj.position.copy(center.applyMatrix4(P))
    h.obj.quaternion.copy(planeQ).multiply(axisBasis(axis)).multiply(spin)
    h.obj.scale.setScalar(1)
  }
}

/**
 * Rotation mapping the XY plane (normal Z) onto the plane perpendicular to `axis`,
 * such that local X -> world axis (axis+1)%3 and local Y -> world axis (axis+2)%3.
 */
export function axisBasis(axis: 0 | 1 | 2): Quaternion {
  const e = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
  const x = e[(axis + 1) % 3]
  const y = e[(axis + 2) % 3]
  const z = e[axis]
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))
}

export function worldPerPixel(camera: Camera, p: Vector3, viewportHeight: number): number {
  if ((camera as PerspectiveCamera).isPerspectiveCamera) {
    const c = camera as PerspectiveCamera
    const dist = c.getWorldPosition(new Vector3()).distanceTo(p)
    return (2 * dist * Math.tan(((c.fov * Math.PI) / 180) / 2)) / viewportHeight
  }
  const o = camera as unknown as { top: number; bottom: number; zoom: number }
  return (o.top - o.bottom) / o.zoom / viewportHeight
}
