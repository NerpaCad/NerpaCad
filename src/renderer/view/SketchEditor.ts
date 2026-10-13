/**
 * Sketch mode in the 3D view: draws the sketch on its plane and turns mouse input into
 * sketch edits (drawing tools with automatic constraints, selection, dragging).
 * Everything is computed in sketch-plane coordinates (mm).
 */
import { shortcutKey } from '../keys'
import { effect, signal, untracked } from '@preact/signals'
import { sketchSolver } from '../core/sketch/client'
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  type PerspectiveCamera,
  Plane,
  Points,
  PointsMaterial,
  type Ray,
  type Scene,
  Vector2,
  Vector3
} from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { gridStep } from '../core/doc/store'
import { type Frame, frameMatrix } from '../core/doc/workplane'
import {
  type XY,
  allPoints,
  arcPoints,
  catmullRom,
  circleThrough,
  curveDistance,
  inSweep,
  tessellate
} from '../core/sketch/geometry'
import {
  type PointRef,
  addArc,
  addCircle,
  addConstraint,
  addLine,
  addPoint,
  addPolygon,
  addRect,
  addSpline,
  deleteEntities,
  mergePoints,
  setDimension,
  toggleConstruction
} from '../core/sketch/ops'
import { type ConstraintCmd, applyCommand } from '../core/sketch/rules'
import { filletCorner, trimAt } from '../core/sketch/modify'
import {
  beginDrag,
  cancelDrag as cancelSketchDrag,
  dragTo,
  edit,
  endDrag,
  filletRadius,
  notice,
  isDragging,
  polygonSides,
  previewPlace,
  skConstruction,
  skNotice,
  skSelection,
  skTool,
  sketch,
  solveInfo
} from '../core/sketch/session'
import type { DragTarget } from '../core/sketch/solver'
import {
  AXIS_X,
  AXIS_Y,
  DIMENSIONS,
  ORIGIN,
  RESERVED,
  type SkConstraint,
  type Sketch,
  curvePoints,
  kindOf,
  pointPos
} from '../core/sketch/types'
import { arcAngles, segmentProject } from '../core/sketch/geometry'
import { type Box, badgeGroups, placeBadges } from '../core/sketch/badges'
import { t } from '../i18n'
import { themeId } from '../themes'
import { THEME } from './theme'
import { type SkBadge, type SkDim, type SkOverlay, dimText, sameOverlay, skEditDim, skFlash, skOverlay, skProblems } from './sketchOverlay'

export interface SketchHost {
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly canvas: HTMLCanvasElement
  invalidate(): void
  ray(clientX: number, clientY: number): Ray
  worldPerPixelAt(p: Vector3): number
  showLabel(e: { clientX: number; clientY: number }, text: string): void
  hideLabel(): void
  showBox(x0: number, y0: number, x1: number, y1: number): void
  hideBox(): void
  /** world point → client (page) coordinates */
  toClient(p: Vector3): { x: number; y: number } | null
  /** world point → pixels inside the 3D view */
  toView(p: Vector3): { x: number; y: number } | null
}

/** A clicked position after snapping. */
interface Pick {
  x: number
  y: number
  /** snapped onto this existing point */
  pointId?: string
  /** snapped onto this curve (or axis) */
  onCurve?: string
  /** line from the previous point is horizontal / vertical */
  hv?: 'h' | 'v'
  /** closes the current polyline */
  close?: boolean
}

/** Filled in when a queued edit runs: ids that later clicks refer to. */
interface Ref {
  v: string | null
}

type Press = { x: number; y: number; raw: XY; ent: string | null; shift: boolean }
type Drag =
  | { kind: 'entity'; targets: (raw: XY) => DragTarget[] }
  | { kind: 'box'; x0: number; y0: number; shift: boolean }

const HOVER_PX = 9
const HV_TOL = Math.tan((4 * Math.PI) / 180)
const AXIS_LEN = 400
const Z = 0

let dotTexture: CanvasTexture | null = null
function dot(): CanvasTexture {
  if (dotTexture) return dotTexture
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#000000'
  g.beginPath()
  g.arc(32, 32, 30, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.arc(32, 32, 21, 0, Math.PI * 2)
  g.fill()
  dotTexture = new CanvasTexture(c)
  return dotTexture
}

const rgb = (hex: string): [number, number, number] => {
  const c = new Color(hex)
  return [c.r, c.g, c.b]
}

const has = (s: Sketch, id: string | null | undefined): id is string =>
  !!id && (id === ORIGIN || s.points.some((p) => p.id === id))

const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1])

const fmt = (v: number) => String(Math.round(v * 100) / 100)

export class SketchEditor {
  readonly root = new Group()
  private m: Matrix4
  private inv: Matrix4
  private plane: Plane

  private axes: LineSegments
  private solid: LineSegments2
  private constr: LineSegments2
  private preview: LineSegments2
  private matSolid = new LineMaterial({ linewidth: 2.6, vertexColors: true, depthTest: false, transparent: true })
  private matConstr = new LineMaterial({
    linewidth: 1.6,
    vertexColors: true,
    depthTest: false,
    transparent: true,
    dashed: true,
    dashSize: 2,
    gapSize: 1.5
  })
  private matPreview = new LineMaterial({
    linewidth: 2,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
    dashed: true,
    dashSize: 1.6,
    gapSize: 1
  })
  private pts: Points
  private cursorPt: Points

  private hoverId: string | null = null
  private cursor: Pick | null = null
  private picks: Pick[] = []
  private chain: { first: Pick; firstId: Ref; prev: Pick; prevId: Ref; count: number } | null = null
  private sweep = 0
  private lastAng: number | null = null
  private press: Press | null = null
  private drag: Drag | null = null
  private rightDown: { x: number; y: number } | null = null
  private lastMove: PointerEvent | null = null
  private disposers: (() => void)[] = []
  /** the points and curves that can still move, for one state of the sketch */
  private free = signal<{ sketch: Sketch; ids: Set<string> } | null>(null)
  private freeTimer = 0

  constructor(
    private host: SketchHost,
    frame: Frame
  ) {
    current = this
    this.m = frameMatrix(frame).multiply(new Matrix4().makeTranslation(0, 0, 0.05))
    this.inv = this.m.clone().invert()
    const n = new Vector3(0, 0, 1).transformDirection(this.m)
    this.plane = new Plane().setFromNormalAndCoplanarPoint(n, new Vector3().setFromMatrixPosition(this.m))

    this.root.matrixAutoUpdate = false
    this.root.matrix.copy(this.m)
    this.root.renderOrder = 1000

    this.axes = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.75 })
    )
    this.axes.renderOrder = 1000
    this.solid = new LineSegments2(new LineSegmentsGeometry(), this.matSolid)
    this.constr = new LineSegments2(new LineSegmentsGeometry(), this.matConstr)
    this.preview = new LineSegments2(new LineSegmentsGeometry(), this.matPreview)
    const pm = () =>
      new PointsMaterial({
        size: 10,
        sizeAttenuation: false,
        vertexColors: true,
        map: dot(),
        alphaTest: 0.5,
        depthTest: false,
        transparent: true
      })
    this.pts = new Points(new BufferGeometry(), pm())
    this.cursorPt = new Points(new BufferGeometry(), pm())
    for (const [o, order] of [
      [this.solid, 1001],
      [this.constr, 1001],
      [this.preview, 1002],
      [this.pts, 1003],
      [this.cursorPt, 1004]
    ] as const) {
      o.renderOrder = order
      o.frustumCulled = false
      this.root.add(o)
    }
    this.root.add(this.axes)
    host.scene.add(this.root)

    this.disposers.push(
      effect(() => {
        void sketch.value
        void skSelection.value
        void solveInfo.value
        void themeId.value
        void skProblems.value
        void this.free.value
        untracked(() => this.rebuild())
      }),
      // what is still free (drawn in the plain colour; the rest in the «defined» colour)
      effect(() => {
        const s = sketch.value
        const info = solveInfo.value
        untracked(() => {
          clearTimeout(this.freeTimer)
          if (!info || info.dof === 0 || isDragging()) return
          this.freeTimer = window.setTimeout(() => {
            void sketchSolver.free(s).then((ids) => {
              if (sketch.peek() === s) this.free.value = ids ? { sketch: s, ids: new Set(ids) } : null
            })
          }, 120)
        })
      }),
      effect(() => {
        void skTool.value
        untracked(() => {
          this.cancelDrag()
          this.cancelOp()
        })
      }),
      effect(() => {
        const n = skNotice.value
        if (n) untracked(() => this.flash(n.ids))
      })
    )
    this.setSize(host.canvas.clientWidth, host.canvas.clientHeight)
  }

  dispose(): void {
    if (current === this) current = null
    clearTimeout(this.flashTimer)
    clearTimeout(this.freeTimer)
    skOverlay.value = { dims: [], badges: [] }
    skFlash.value = new Set()
    skEditDim.value = null
    this.disposers.forEach((d) => d())
    this.host.scene.remove(this.root)
    this.root.traverse((o) => {
      const g = (o as { geometry?: BufferGeometry }).geometry
      g?.dispose()
    })
    this.matSolid.dispose()
    this.matConstr.dispose()
    this.matPreview.dispose()
    this.host.hideLabel()
    this.host.hideBox()
  }

  setSize(w: number, h: number): void {
    const r = new Vector2(Math.max(1, w), Math.max(1, h))
    this.matSolid.resolution = r
    this.matConstr.resolution = r
    this.matPreview.resolution = r
  }

  // ---------------------------------------------------------------- coordinates

  private toSketch(clientX: number, clientY: number): XY | null {
    const p = this.host.ray(clientX, clientY).intersectPlane(this.plane, new Vector3())
    if (!p) return null
    p.applyMatrix4(this.inv)
    return [p.x, p.y]
  }

  private toWorld(p: XY): Vector3 {
    return new Vector3(p[0], p[1], 0).applyMatrix4(this.m)
  }

  /** Size of `px` screen pixels in sketch millimetres near `p`. */
  private px(p: XY, px: number): number {
    return this.host.worldPerPixelAt(this.toWorld(p)) * px
  }

  // ---------------------------------------------------------------- hit testing

  private nearestPoint(s: Sketch, p: XY, tol: number): string | null {
    let best = tol
    let id: string | null = null
    for (const q of allPoints(s)) {
      const d = dist(q.p, p)
      if (d < best) {
        best = d
        id = q.id
      }
    }
    return id
  }

  private nearestCurve(s: Sketch, p: XY, tol: number, axes = true): { id: string; q: XY } | null {
    let best = tol
    let out: { id: string; q: XY } | null = null
    const ids = [...s.curves.map((c) => c.id), ...(axes ? [AXIS_X, AXIS_Y] : [])]
    for (const id of ids) {
      const h = curveDistance(s, id, p)
      // axes are a little harder to grab than real geometry
      const d = h ? h.d * (RESERVED.has(id) ? 1.4 : 1) : Infinity
      if (h && d < best) {
        best = d
        out = { id, q: h.q }
      }
    }
    return out
  }

  private hitEntity(p: XY): string | null {
    const s = sketch.value
    const tol = this.px(p, HOVER_PX)
    return this.nearestPoint(s, p, tol) ?? this.nearestCurve(s, p, tol * 0.8)?.id ?? null
  }

  /** Snap a raw position for the drawing tools. */
  private snapPick(raw: XY, alt: boolean, from: Pick | null): Pick {
    const s = sketch.value
    const tol = this.px(raw, HOVER_PX)
    const step = gridStep.value
    const g = (v: number) => (step ? Math.round(v / step) * step : Math.round(v * 1000) / 1000)
    if (!alt) {
      const c = this.chain
      if (c && c.count >= 2 && dist(raw, [c.first.x, c.first.y]) < tol) return { x: c.first.x, y: c.first.y, close: true }
      const sp = skTool.value === 'spline' ? this.picks : null
      if (sp && sp.length >= 3 && dist(raw, [sp[0].x, sp[0].y]) < tol) return { x: sp[0].x, y: sp[0].y, close: true }
      const pid = this.nearestPoint(s, raw, tol)
      if (pid) {
        const q = pointPos(s, pid)!
        return { x: q[0], y: q[1], pointId: pid }
      }
      const cur = this.nearestCurve(s, raw, tol * 0.8)
      // on an axis the position along it still follows the grid
      if (cur?.id === AXIS_X) return { x: g(cur.q[0]), y: 0, onCurve: cur.id }
      if (cur?.id === AXIS_Y) return { x: 0, y: g(cur.q[1]), onCurve: cur.id }
      if (cur) return { x: cur.q[0], y: cur.q[1], onCurve: cur.id }
    }
    const pick: Pick = { x: g(raw[0]), y: g(raw[1]) }
    if (from && !alt) {
      const dx = pick.x - from.x
      const dy = pick.y - from.y
      if (Math.abs(dx) > tol && Math.abs(raw[1] - from.y) <= Math.abs(dx) * HV_TOL) {
        pick.y = from.y
        pick.hv = 'h'
      } else if (Math.abs(dy) > tol && Math.abs(raw[0] - from.x) <= Math.abs(dy) * HV_TOL) {
        pick.x = from.x
        pick.hv = 'v'
      }
    }
    return pick
  }

  // ---------------------------------------------------------------- drawing

  private rebuild(): void {
    const s = sketch.value
    const sel = new Set(skSelection.value)
    const info = solveInfo.value
    const solved = !!info && (info.state === 'ok' || info.state === 'redundant')
    const allDone = solved && info.dof === 0
    // with some freedom left, what is already pinned down shows in the «defined» colour too
    const fr = this.free.peek()
    const known = solved && fr && fr.sketch === s ? fr.ids : null
    const isDone = (id: string, pts: string[] = []) => allDone || (!!known && !known.has(id) && pts.every((p) => !known.has(p)))
    const prob = skProblems.value
    const problems = prob && prob.sketch === s ? prob.ids : null
    const colorOf = (id: string, base: string) =>
      this.flashIds.has(id) || problems?.has(id)
        ? THEME.sketchConflict
        : id === this.hoverId
          ? THEME.sketchHover
          : sel.has(id)
            ? THEME.sketchSelect
            : base

    const solid: number[] = []
    const solidC: number[] = []
    const cons: number[] = []
    const consC: number[] = []
    for (const c of s.curves) {
      const pts = tessellate(s, c)
      const col = rgb(colorOf(c.id, c.construction ? THEME.sketchConstruction : isDone(c.id, curvePoints(c)) ? THEME.sketchDone : THEME.sketchLine))
      const P = c.construction ? cons : solid
      const C = c.construction ? consC : solidC
      for (let i = 0; i + 1 < pts.length; i++) {
        P.push(pts[i][0], pts[i][1], Z, pts[i + 1][0], pts[i + 1][1], Z)
        C.push(...col, ...col)
      }
    }
    setSegments(this.solid, solid, solidC)
    setSegments(this.constr, cons, consC)

    const pp: number[] = []
    const pc: number[] = []
    for (const q of allPoints(s)) {
      pp.push(q.p[0], q.p[1], Z)
      pc.push(...rgb(colorOf(q.id, q.id === ORIGIN ? THEME.workBorder : isDone(q.id) ? THEME.sketchDone : THEME.sketchPoint)))
    }
    const pg = new BufferGeometry()
    pg.setAttribute('position', new Float32BufferAttribute(pp, 3))
    pg.setAttribute('color', new Float32BufferAttribute(pc, 3))
    this.pts.geometry.dispose()
    this.pts.geometry = pg

    const ax = rgb(colorOf(AXIS_X, THEME.workBorder))
    const ay = rgb(colorOf(AXIS_Y, THEME.workBorder))
    const ag = new BufferGeometry()
    ag.setAttribute(
      'position',
      new Float32BufferAttribute([-AXIS_LEN, 0, Z, AXIS_LEN, 0, Z, 0, -AXIS_LEN, Z, 0, AXIS_LEN, Z], 3)
    )
    ag.setAttribute('color', new Float32BufferAttribute([...ax, ...ax, ...ay, ...ay], 3))
    this.axes.geometry.dispose()
    this.axes.geometry = ag

    this.matPreview.color.set(THEME.sketchPreview)
    this.rebuildPreview()
    this.host.invalidate()
  }

  private flashIds = new Set<string>()
  private flashTimer = 0
  /** Briefly show the given entities (and what constraints refer to) in the error color. */
  private flash(constraintIds: string[]): void {
    const s = sketch.value
    const ids = new Set<string>()
    for (const c of s.constraints) if (constraintIds.includes(c.id)) c.refs.forEach((r) => ids.add(r))
    this.flashIds = ids
    skFlash.value = new Set(constraintIds)
    this.rebuild()
    clearTimeout(this.flashTimer)
    this.flashTimer = window.setTimeout(() => {
      this.flashIds = new Set()
      skFlash.value = new Set()
      this.rebuild()
    }, 1200)
  }

  private rebuildPreview(): void {
    const seg: number[] = []
    const add = (pts: XY[], closed = false) => {
      for (let i = 0; i + 1 < pts.length; i++) seg.push(pts[i][0], pts[i][1], Z, pts[i + 1][0], pts[i + 1][1], Z)
      if (closed && pts.length > 2) {
        const a = pts[pts.length - 1]
        seg.push(a[0], a[1], Z, pts[0][0], pts[0][1], Z)
      }
    }
    const cur = this.cursor
    const tool = skTool.value
    const P = this.picks
    if (cur) {
      const c: XY = [cur.x, cur.y]
      if (tool === 'line' && this.chain) add([[this.chain.prev.x, this.chain.prev.y], c])
      if (tool === 'spline' && P.length >= 1) {
        const pts: XY[] = P.map((p) => [p.x, p.y] as XY)
        if (cur.close) add(catmullRom(pts, true, 12))
        else add(catmullRom([...pts, c], false, 12))
      }
      if ((tool === 'rect' || tool === 'rectCenter') && P.length === 1) add(rectCorners(P[0], cur, tool === 'rectCenter'), true)
      if (tool === 'circle' && P.length === 1) add(arcPoints([P[0].x, P[0].y], dist([P[0].x, P[0].y], c), 0, Math.PI * 2))
      if (tool === 'polygon' && P.length === 1) add(polygonCorners(P[0], cur, polygonSides.value), true)
      if (tool === 'arc' && P.length === 1) add([[P[0].x, P[0].y], c])
      if (tool === 'arc' && P.length === 2) {
        const a = this.arcFromCenter(cur)
        if (a) add(arcPoints(a.c, a.r, a.sa, a.ea))
        add([[P[0].x, P[0].y], [P[1].x, P[1].y]])
      }
      if (tool === 'arc3' && P.length === 1) add([[P[0].x, P[0].y], c])
      if (tool === 'arc3' && P.length === 2) {
        const a = arcThrough([P[0].x, P[0].y], [P[1].x, P[1].y], c)
        if (a) add(arcPoints(a.c, a.r, a.sa, a.ea))
        else add([[P[0].x, P[0].y], [P[1].x, P[1].y]])
      }
    }
    setSegments(this.preview, seg, null)

    const cg = new BufferGeometry()
    const show = cur && tool !== 'select'
    cg.setAttribute('position', new Float32BufferAttribute(show ? [cur.x, cur.y, Z] : [], 3))
    cg.setAttribute('color', new Float32BufferAttribute(show ? rgb(THEME.sketchPreview) : [], 3))
    this.cursorPt.geometry.dispose()
    this.cursorPt.geometry = cg
    this.host.invalidate()
  }

  // ---------------------------------------------------------------- overlay (dimensions, badges)

  /** Recompute the screen positions of dimensions and constraint badges (after each render). */
  updateOverlay(): void {
    const s = sketch.value
    const V = (p: XY) => this.host.toView(this.toWorld(p))
    const out: SkOverlay = { dims: [], badges: [] }

    // screen center of the sketch, to put dimensions on the outside
    let cx = 0
    let cy = 0
    let n = 0
    for (const p of s.points) {
      const q = V([p.x, p.y])
      if (q) {
        cx += q.x
        cy += q.y
        n++
      }
    }
    const center = n ? { x: cx / n, y: cy / n } : { x: 0, y: 0 }

    // each badge asks for a spot (beside its line, point or curve); then they are spread out so
    // none covers another, a dimension's number or a point
    type Want = { b: Omit<SkBadge, 'x' | 'y'>; x: number; y: number; dx?: number; dy?: number }
    const wants: Want[] = []
    const want = (b: Omit<SkBadge, 'x' | 'y'>, x: number, y: number, dx = 0, dy = 0) => wants.push({ b, x, y, dx, dy })
    const lineMid = (id: string): { m: XY; a: XY; b: XY } | null => {
      const c = s.curves.find((k) => k.id === id)
      if (!c || c.kind !== 'line') return null
      const a = pointPos(s, c.p1)
      const b = pointPos(s, c.p2)
      if (!a || !b) return null
      return { m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], a, b }
    }
    /** badge beside a line's middle, on the side toward the sketch's center */
    const onLine = (id: string, b: Omit<SkBadge, 'x' | 'y'>) => {
      const l = lineMid(id)
      if (!l) return
      const A = V(l.a)
      const B = V(l.b)
      const M = V(l.m)
      if (!A || !B || !M) return
      let dx = B.x - A.x
      let dy = B.y - A.y
      const len = Math.hypot(dx, dy) || 1
      dx /= len
      dy /= len
      let nx = -dy
      let ny = dx
      if (nx * (center.x - M.x) + ny * (center.y - M.y) < 0) {
        nx = -nx
        ny = -ny
      }
      want(b, M.x + nx * 15, M.y + ny * 15, dx, dy)
    }
    const onPoint = (id: string, b: Omit<SkBadge, 'x' | 'y'>) => {
      const p = pointPos(s, id)
      const P = p && V(p)
      if (P) want(b, P.x + 14, P.y - 14)
    }
    const onRound = (id: string, b: Omit<SkBadge, 'x' | 'y'>) => {
      const k = s.curves.find((x) => x.id === id)
      if (!k || k.kind === 'line' || k.kind === 'spline') return
      const ctr = pointPos(s, k.c)
      if (!ctr) return
      let ang = Math.PI / 4
      if (k.kind === 'arc') {
        const g = arcAngles(s, k)
        if (g) ang = (g.sa + g.ea) / 2
      }
      const P = V([ctr[0] + k.r * Math.cos(ang), ctr[1] + k.r * Math.sin(ang)])
      const C = V(ctr)
      if (!P || !C) return
      const d = Math.hypot(P.x - C.x, P.y - C.y) || 1
      const ux = (P.x - C.x) / d
      const uy = (P.y - C.y) / d
      // slides along the curve (across the radius) when taken
      want(b, P.x + ux * 14, P.y + uy * 14, -uy, ux)
    }
    /** a tangent where two curves meet: just outside the round one, at the meeting point */
    const onTouch = (at: string, refs: string[], b: Omit<SkBadge, 'x' | 'y'>) => {
      const p = pointPos(s, at)
      const round = refs.map((id) => s.curves.find((k) => k.id === id)).find((k) => k && (k.kind === 'arc' || k.kind === 'circle'))
      const ctr = round && (round.kind === 'arc' || round.kind === 'circle') ? pointPos(s, round.c) : null
      const P = p && V(p)
      const C = ctr && V(ctr)
      if (!P) return
      if (!C) return onPoint(at, b)
      const d = Math.hypot(P.x - C.x, P.y - C.y) || 1
      const ux = (P.x - C.x) / d
      const uy = (P.y - C.y) / d
      want(b, P.x + ux * 16, P.y + uy * 16, -uy, ux)
    }
    const onEither = (id: string, b: Omit<SkBadge, 'x' | 'y'>) => (kindOfId(id) === 'line' ? onLine(id, b) : onRound(id, b))
    const kindOfId = (id: string) =>
      id === ORIGIN || s.points.some((p) => p.id === id) ? 'point' : s.curves.find((c) => c.id === id)?.kind

    const groups = badgeGroups(s)
    for (const g of groups.polygons) onRound(g.circle, { id: g.ids[0], ids: g.ids, type: 'regular' })
    for (const m of groups.equal) onEither(m.entity, { id: m.constraint, type: 'equal', ...(m.group ? { n: m.group } : {}) })

    for (const c of s.constraints) {
      if (DIMENSIONS.has(c.type)) {
        const d = this.dimGraphics(s, c, V, center)
        if (d) out.dims.push(d)
        continue
      }
      if (groups.grouped.has(c.id)) continue
      const r = c.refs
      const b = { id: c.id, type: c.type }
      switch (c.type) {
        case 'horizontal':
        case 'vertical':
          if (r.length === 1) onLine(r[0], b)
          else onPoint(r[1], b)
          break
        case 'parallel':
        case 'perpendicular':
          for (const id of r) onEither(id, b)
          break
        case 'tangent': {
          const at = groups.tangentAt.get(c.id)
          if (at) onTouch(at, r, b)
          else for (const id of r) onEither(id, b)
          break
        }
        case 'pointOn':
        case 'midpoint':
        case 'lock':
        case 'coincident':
          onPoint(r[0], b)
          break
        case 'symmetric':
          if (kindOfId(r[2]) === 'line') onLine(r[2], b)
          else onPoint(r[2], b)
          break
      }
    }
    // what badges must not cover: dimension numbers and the points
    const taken: Box[] = out.dims.map((d) => ({ x: d.x, y: d.y, hw: Math.max(34, 14 + 7.3 * dimText(d).length) / 2, hh: 10.5 }))
    for (const p of s.points) {
      const q = V([p.x, p.y])
      if (q) taken.push({ x: q.x, y: q.y, hw: 4, hh: 4 })
    }
    const spots = placeBadges(wants, taken)
    out.badges = wants.map((w, i) => ({ ...w.b, x: r1(spots[i].x), y: r1(spots[i].y) }))
    if (!sameOverlay(out, skOverlay.peek())) skOverlay.value = out
  }

  private dimGraphics(
    s: Sketch,
    c: SkConstraint,
    V: (p: XY) => { x: number; y: number } | null,
    center: { x: number; y: number }
  ): SkDim | null {
    const g = dimGeometry(s, c)
    if (!g) return null
    const value = c.value ?? 0
    const base = { id: c.id, type: c.type, shown: Math.abs(value) }
    const pl = c.place
    type S = { x: number; y: number }
    const P = (q: S): [number, number] => [r1(q.x), r1(q.y)]
    const unit = (a: S, b: S): S => {
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
      return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
    }
    const ang = (from: S, to: S) => Math.atan2(to.y - from.y, to.x - from.x)
    /** extension line from a measured point A to the dimension line at A2 (a small gap at A, a little past A2) */
    const ext = (A: S, A2: S): [number, number][] | null => {
      if (Math.hypot(A2.x - A.x, A2.y - A.y) < 3) return null
      const u = unit(A, A2)
      return [P({ x: A.x + u.x * 4, y: A.y + u.y * 4 }), P({ x: A2.x + u.x * 5, y: A2.y + u.y * 5 })]
    }
    /** the dimension line A2–B2 with its arrows; the number at LAB (a leader to it when it is outside) */
    const between = (A: S, B: S, A2: S, B2: S, LAB: S, t: number): SkDim => {
      const lines: [number, number][][] = []
      for (const e of [ext(A, A2), ext(B, B2)]) if (e) lines.push(e)
      const exts = lines.length
      lines.push([P(A2), P(B2)])
      if (t < 0) lines.push([P(LAB), P(A2)])
      if (t > 1) lines.push([P(B2), P(LAB)])
      return { ...base, x: r1(LAB.x), y: r1(LAB.y), lines, exts, arrows: [[...P(A2), ang(B2, A2)], [...P(B2), ang(A2, B2)]] }
    }

    switch (g.kind) {
      case 'linear': {
        const [a, b] = g.ends
        const A = V(a)
        const B = V(b)
        if (!A || !B) return null
        if (pl) {
          const L = dist(a, b) || 1e-9
          const u: XY = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
          const n: XY = [-u[1], u[0]]
          const [off, t = 0.5] = pl
          const A2 = V([a[0] + n[0] * off, a[1] + n[1] * off])
          const B2 = V([b[0] + n[0] * off, b[1] + n[1] * off])
          const LAB = V([a[0] + u[0] * t * L + n[0] * off, a[1] + u[1] * t * L + n[1] * off])
          return A2 && B2 && LAB ? between(A, B, A2, B2, LAB, t) : null
        }
        // default: 26 px to the side, away from the sketch center
        const u = unit(A, B)
        let nx = -u.y
        let ny = u.x
        if (nx * ((A.x + B.x) / 2 - center.x) + ny * ((A.y + B.y) / 2 - center.y) < 0) {
          nx = -nx
          ny = -ny
        }
        const A2 = { x: A.x + nx * 26, y: A.y + ny * 26 }
        const B2 = { x: B.x + nx * 26, y: B.y + ny * 26 }
        return between(A, B, A2, B2, { x: (A2.x + B2.x) / 2, y: (A2.y + B2.y) / 2 }, 0.5)
      }
      case 'axis': {
        const [a, b] = g.ends
        const X = g.x
        const [off, t = 0.5] = pl ?? [X ? Math.min(a[1], b[1]) - a[1] - this.px(a, 26) : Math.max(a[0], b[0]) - a[0] + this.px(a, 26)]
        const lo = X ? a[1] + off : a[0] + off
        const a2: XY = X ? [a[0], lo] : [lo, a[1]]
        const b2: XY = X ? [b[0], lo] : [lo, b[1]]
        const A = V(a)
        const B = V(b)
        const A2 = V(a2)
        const B2 = V(b2)
        const LAB = V([a2[0] + (b2[0] - a2[0]) * t, a2[1] + (b2[1] - a2[1]) * t])
        return A && B && A2 && B2 && LAB ? between(A, B, A2, B2, LAB, t) : null
      }
      case 'pointLine': {
        const A = V(g.p)
        const B = V(g.foot)
        if (!A || !B) return null
        const lines: [number, number][][] = [[P(A), P(B)]]
        const arrows: [number, number, number][] = [
          [...P(A), ang(B, A)],
          [...P(B), ang(A, B)]
        ]
        if (!pl) return { ...base, x: r1((A.x + B.x) / 2 + 16), y: r1((A.y + B.y) / 2 - 10), lines, arrows }
        const [t, off = 0] = pl
        const L = dist(g.p, g.foot) || 1e-9
        const u: XY = [(g.foot[0] - g.p[0]) / L, (g.foot[1] - g.p[1]) / L]
        const m: XY = [g.p[0] + u[0] * t * L, g.p[1] + u[1] * t * L]
        const M = V(m)
        const LAB = V([m[0] - u[1] * off, m[1] + u[0] * off])
        if (!M || !LAB) return null
        // past either end: carry the line on to the number
        if (t < 0) lines.push([P(M), P(A)])
        if (t > 1) lines.push([P(B), P(M)])
        if (Math.hypot(LAB.x - M.x, LAB.y - M.y) > 12) lines.push([P(M), P(LAB)])
        return { ...base, x: r1(LAB.x), y: r1(LAB.y), lines, arrows }
      }
      case 'round': {
        const { ctr, r } = g
        if (c.type === 'diameter') {
          // like a length: two extension lines touching the circle and the dimension line beyond
          // it, above the circle unless moved (it never crosses the centre point)
          const a = pl ? pl[0] : Math.PI / 2
          const d = pl ? pl[1] : this.px(ctr, 26)
          const u: XY = [Math.cos(a), Math.sin(a)]
          const v: XY = [Math.sin(a), -Math.cos(a)]
          const at = (k: number, s2: number): XY => [ctr[0] + v[0] * r * k + u[0] * s2, ctr[1] + v[1] * r * k + u[1] * s2]
          const A = V(at(-1, 0))
          const B = V(at(1, 0))
          const A2 = V(at(-1, r + d))
          const B2 = V(at(1, r + d))
          const LAB = V(at(0, r + d))
          return A && B && A2 && B2 && LAB ? between(A, B, A2, B2, LAB, 0.5) : null
        }
        const a = pl ? pl[0] : g.mid
        const u: XY = [Math.cos(a), Math.sin(a)]
        const P2 = V([ctr[0] + u[0] * r, ctr[1] + u[1] * r])
        const P1 = V(ctr)
        if (!P1 || !P2) return null
        const d = unit(P1, P2)
        const arrows: [number, number, number][] = [[...P(P2), Math.atan2(d.y, d.x)]]
        let LAB: S | null
        let end: S
        if (pl) {
          LAB = V([ctr[0] + u[0] * (r + pl[1]), ctr[1] + u[1] * (r + pl[1])])
          if (!LAB) return null
          const beyond = (LAB.x - P2.x) * d.x + (LAB.y - P2.y) * d.y
          end = beyond > 14 ? { x: LAB.x - d.x * 14, y: LAB.y - d.y * 14 } : P2
        } else {
          LAB = { x: P2.x + d.x * 26, y: P2.y + d.y * 26 }
          end = { x: P2.x + d.x * 12, y: P2.y + d.y * 12 }
        }
        // the radius line starts a little away from the centre, so the centre point stays easy to grab
        const span = Math.hypot(end.x - P1.x, end.y - P1.y)
        const gap = Math.min(12, span * 0.3)
        const from = { x: P1.x + d.x * gap, y: P1.y + d.y * gap }
        return { ...base, x: r1(LAB.x), y: r1(LAB.y), lines: [[P(from), P(end)]], arrows }
      }
      case 'angle': {
        const { I, d1, d2 } = g
        const Is = V(I)
        const r1s = V([I[0] + d1[0], I[1] + d1[1]])
        const r2s = V([I[0] + d2[0], I[1] + d2[1]])
        if (!Is || !r1s || !r2s) return null
        const a1 = ang(Is, r1s)
        let a2 = ang(Is, r2s)
        let sweep = a2 - a1
        while (sweep > Math.PI) sweep -= Math.PI * 2
        while (sweep < -Math.PI) sweep += Math.PI * 2
        a2 = a1 + sweep
        const R = pl ? Math.max(12, pl[0] / this.px(I, 1)) : 40
        const pts: [number, number][] = []
        for (let i = 0; i <= 16; i++) {
          const q = a1 + (sweep * i) / 16
          pts.push([r1(Is.x + R * Math.cos(q)), r1(Is.y + R * Math.sin(q))])
        }
        const am = a1 + sweep / 2
        const sg = Math.sign(sweep) || 1
        return {
          ...base,
          x: r1(Is.x + (R + 18) * Math.cos(am)),
          y: r1(Is.y + (R + 18) * Math.sin(am)),
          lines: [pts],
          arrows: [
            [pts[0][0], pts[0][1], a1 - (sg * Math.PI) / 2],
            [pts[16][0], pts[16][1], a2 + (sg * Math.PI) / 2]
          ]
        }
      }
    }
  }

  /** Move dimension `id` so that its number is at this screen point (while dragging it). */
  placeDim(id: string, clientX: number, clientY: number): void {
    const raw = this.toSketch(clientX, clientY)
    const s = sketch.value
    const c = s.constraints.find((k) => k.id === id)
    if (!raw || !c) return
    const g = dimGeometry(s, c)
    if (!g) return
    let place: number[]
    switch (g.kind) {
      case 'linear': {
        const [a, b] = g.ends
        const L = dist(a, b) || 1e-9
        const u: XY = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
        const v: XY = [raw[0] - a[0], raw[1] - a[1]]
        place = [v[1] * u[0] - v[0] * u[1], (v[0] * u[0] + v[1] * u[1]) / L]
        break
      }
      case 'axis': {
        const [a, b] = g.ends
        const i = g.x ? 0 : 1
        const span = b[i] - a[i]
        place = [g.x ? raw[1] - a[1] : raw[0] - a[0], Math.abs(span) > 1e-9 ? (raw[i] - a[i]) / span : 0.5]
        break
      }
      case 'pointLine': {
        const L = dist(g.p, g.foot) || 1e-9
        const u: XY = [(g.foot[0] - g.p[0]) / L, (g.foot[1] - g.p[1]) / L]
        const v: XY = [raw[0] - g.p[0], raw[1] - g.p[1]]
        place = [(v[0] * u[0] + v[1] * u[1]) / L, v[1] * u[0] - v[0] * u[1]]
        break
      }
      case 'round':
        place = [Math.atan2(raw[1] - g.ctr[1], raw[0] - g.ctr[0]), dist(raw, g.ctr) - g.r]
        break
      case 'angle':
        place = [Math.max(this.px(g.I, 12), dist(raw, g.I) - this.px(g.I, 18))]
        break
    }
    previewPlace(id, place.map((x) => Math.round(x * 1e4) / 1e4))
  }

  // ---------------------------------------------------------------- tools

  /** Drop the half-finished shape of the current tool. Returns whether anything was dropped. */
  cancelOp(): boolean {
    const busy = this.picks.length > 0 || this.chain !== null
    this.picks = []
    this.chain = null
    this.sweep = 0
    this.lastAng = null
    this.host.hideLabel()
    this.rebuildPreview()
    return busy
  }

  private click(pick: Pick): void {
    const tool = skTool.value
    const constr = skConstruction.value
    const P = this.picks
    switch (tool) {
      case 'line':
        return this.lineClick(pick, constr)
      case 'spline':
        return this.splineClick(pick)
      case 'point': {
        if (pick.pointId) return
        void edit(
          (s) => {
            const r = addPoint(s, [pick.x, pick.y])
            return pick.onCurve ? addConstraint(r.sketch, 'pointOn', [r.id, pick.onCurve]).sketch : r.sketch
          },
          { fallback: (s) => addPoint(s, [pick.x, pick.y]).sketch }
        )
        return
      }
      case 'rect':
      case 'rectCenter': {
        if (P.length === 0) return void (this.picks = [pick])
        const a = P[0]
        this.picks = []
        if (Math.abs(pick.x - a.x) < 1e-6 || Math.abs(pick.y - a.y) < 1e-6) return
        const center = tool === 'rectCenter'
        const build = (s: Sketch, auto: boolean) => {
          const r = addRect(s, [a.x, a.y], [pick.x, pick.y], center, constr)
          let out = r.sketch
          if (!auto) return out
          const corner = (p: Pick) =>
            r.points.reduce((best, id) => (dist(pointPos(out, id)!, [p.x, p.y]) < dist(pointPos(out, best)!, [p.x, p.y]) ? id : best))
          const pairs: [Pick, string][] = center ? [[a, r.center!]] : [[a, corner(a)]]
          pairs.push([pick, corner(pick)])
          for (const [p, id] of pairs) {
            if (has(out, p.pointId)) out = mergePoints(out, p.pointId, id)
            else if (p.onCurve) out = addConstraint(out, 'pointOn', [id, p.onCurve]).sketch
          }
          return out
        }
        void edit((s) => build(s, true), { fallback: (s) => build(s, false) })
        return
      }
      case 'circle': {
        if (P.length === 0) return void (this.picks = [pick])
        const c = P[0]
        this.picks = []
        const r = dist([c.x, c.y], [pick.x, pick.y])
        if (r < 1e-6) return
        const build = (s: Sketch, auto: boolean) => {
          const res = addCircle(s, auto && has(s, c.pointId) ? c.pointId : [c.x, c.y], r, constr)
          let out = res.sketch
          if (auto && !c.pointId && c.onCurve) out = addConstraint(out, 'pointOn', [res.c, c.onCurve]).sketch
          if (auto && has(out, pick.pointId)) out = addConstraint(out, 'pointOn', [pick.pointId, res.id]).sketch
          return out
        }
        void edit((s) => build(s, true), { fallback: (s) => build(s, false) })
        return
      }
      case 'polygon': {
        if (P.length === 0) return void (this.picks = [pick])
        const c = P[0]
        this.picks = []
        if (dist([c.x, c.y], [pick.x, pick.y]) < 1e-6) return
        const n = polygonSides.value
        const build = (s: Sketch, auto: boolean) =>
          addPolygon(s, auto && has(s, c.pointId) ? c.pointId : [c.x, c.y], [pick.x, pick.y], n, constr).sketch
        void edit((s) => build(s, true), { fallback: (s) => build(s, false) })
        return
      }
      case 'arc': {
        if (P.length === 0) return void (this.picks = [pick])
        if (P.length === 1) {
          if (dist([P[0].x, P[0].y], [pick.x, pick.y]) < 1e-6) return
          this.picks = [P[0], pick]
          this.sweep = 0
          this.lastAng = Math.atan2(pick.y - P[0].y, pick.x - P[0].x)
          return
        }
        const [c, st] = P
        this.updateSweep(pick)
        const g = this.arcFromCenter(pick)
        this.picks = []
        this.lastAng = null
        if (!g) return
        const endProj: XY = [g.c[0] + g.r * Math.cos(this.sweep >= 0 ? g.ea : g.sa), g.c[1] + g.r * Math.sin(this.sweep >= 0 ? g.ea : g.sa)]
        const ccw = this.sweep >= 0
        const build = (s: Sketch, auto: boolean) => {
          const cRef: PointRef = auto && has(s, c.pointId) ? c.pointId : [c.x, c.y]
          const stRef: PointRef = auto && has(s, st.pointId) ? st.pointId : [st.x, st.y]
          const enRef: PointRef = auto && has(s, pick.pointId) ? pick.pointId : endProj
          const res = ccw ? addArc(s, cRef, stRef, enRef, constr) : addArc(s, cRef, enRef, stRef, constr)
          return res.sketch
        }
        void edit((s) => build(s, true), { fallback: (s) => build(s, false) })
        return
      }
      case 'arc3': {
        if (P.length < 2) {
          if (P.length === 1 && dist([P[0].x, P[0].y], [pick.x, pick.y]) < 1e-6) return
          return void (this.picks = [...P, pick])
        }
        const [a, b] = P
        this.picks = []
        const g = arcThrough([a.x, a.y], [b.x, b.y], [pick.x, pick.y])
        if (!g) return
        const build = (s: Sketch, auto: boolean) => {
          const aRef: PointRef = auto && has(s, a.pointId) ? a.pointId : [a.x, a.y]
          const bRef: PointRef = auto && has(s, b.pointId) ? b.pointId : [b.x, b.y]
          const res = g.forward ? addArc(s, g.c, aRef, bRef, constr) : addArc(s, g.c, bRef, aRef, constr)
          return res.sketch
        }
        void edit((s) => build(s, true), { fallback: (s) => build(s, false) })
        return
      }
    }
  }

  private lineClick(pick: Pick, constr: boolean): void {
    const c = this.chain
    if (!c) {
      const id = { v: pick.pointId ?? null }
      this.chain = { first: pick, firstId: { v: id.v }, prev: pick, prevId: id, count: 0 }
      return
    }
    const prev = c.prev
    if (!pick.close && dist([prev.x, prev.y], [pick.x, pick.y]) < 1e-6) return
    const prevId = c.prevId
    const firstId = c.firstId
    // the start is whatever the previous (queued) segment ended on, read once when this edit runs;
    // the refs move on only when the segment is really added
    let start: string | null | undefined
    let made: { p1: string; p2: string } | null = null
    const build = (s: Sketch, auto: boolean): Sketch => {
      if (start === undefined) start = prevId.v
      const a: PointRef = has(s, start) ? start : [prev.x, prev.y]
      const bId = pick.close ? firstId.v : pick.pointId
      const b: PointRef = has(s, bId) ? bId : [pick.x, pick.y]
      if (typeof a === 'string' && a === b) return s
      const r = addLine(s, a, b, constr)
      let out = r.sketch
      // without `auto` (the fallback) the line still joins the points, just with no extra constraints
      if (auto) {
        if (typeof a !== 'string' && prev.onCurve) out = addConstraint(out, 'pointOn', [r.p1, prev.onCurve]).sketch
        if (typeof b !== 'string' && pick.onCurve) out = addConstraint(out, 'pointOn', [r.p2, pick.onCurve]).sketch
        if (pick.hv) out = addConstraint(out, pick.hv === 'h' ? 'horizontal' : 'vertical', [r.id]).sketch
      }
      made = { p1: r.p1, p2: r.p2 }
      return out
    }
    void edit((s) => build(s, true), {
      fallback: (s) => build(s, false),
      after: () => {
        if (!made) return
        prevId.v = made.p2
        if (!firstId.v) firstId.v = made.p1
      }
    })
    if (pick.close) {
      this.chain = null
    } else {
      c.prev = pick
      c.count++
    }
  }

  /** Spline: every click adds a point; a click on the first point closes it. */
  private splineClick(pick: Pick): void {
    const P = this.picks
    const last = P[P.length - 1]
    if (pick.close) return this.commitSpline(true)
    if (last && dist([last.x, last.y], [pick.x, pick.y]) < 1e-6) return
    P.push(pick)
    this.rebuildPreview()
  }

  /** Make the spline from the clicked points (Enter, double click, right click or closing it). */
  private commitSpline(closed: boolean): void {
    const P = [...this.picks]
    this.picks = []
    this.rebuildPreview()
    if (P.length < (closed ? 3 : 2)) return
    const constr = skConstruction.value
    const build = (s: Sketch, auto: boolean): Sketch | null => {
      const used = new Set<string>()
      const refs: PointRef[] = P.map((p) => {
        const id = auto && has(s, p.pointId) && !used.has(p.pointId!) ? p.pointId! : null
        if (id) used.add(id)
        return id ?? [p.x, p.y]
      })
      const r = addSpline(s, refs, closed, constr)
      if (!r) return null
      let out = r.sketch
      if (auto && !closed) {
        const ends: [Pick, string][] = [
          [P[0], r.pts[0]],
          [P[P.length - 1], r.pts[r.pts.length - 1]]
        ]
        for (const [p, id] of ends) if (!p.pointId && p.onCurve) out = addConstraint(out, 'pointOn', [id, p.onCurve]).sketch
      }
      return out
    }
    void edit((s) => build(s, true), { fallback: (s) => build(s, false) })
  }

  /** End a polyline or a spline (Enter, double click, right click). */
  finishChain(): boolean {
    if (skTool.value === 'spline' && this.picks.length > 0) {
      this.commitSpline(false)
      return true
    }
    if (!this.chain) return false
    this.chain = null
    this.rebuildPreview()
    return true
  }

  private updateSweep(cur: Pick): void {
    if (skTool.value !== 'arc' || this.picks.length !== 2 || this.lastAng === null) return
    const c = this.picks[0]
    const ang = Math.atan2(cur.y - c.y, cur.x - c.x)
    let d = ang - this.lastAng
    while (d > Math.PI) d -= Math.PI * 2
    while (d <= -Math.PI) d += Math.PI * 2
    this.sweep += d
    this.lastAng = ang
  }

  /** Arc for the center tool: from the start pick, sweeping as the mouse went (CCW when positive). */
  private arcFromCenter(cur: Pick): { c: XY; r: number; sa: number; ea: number } | null {
    const [c, st] = this.picks
    if (!c || !st) return null
    const r = dist([c.x, c.y], [st.x, st.y])
    if (r < 1e-9) return null
    const a0 = Math.atan2(st.y - c.y, st.x - c.x)
    let sw = this.sweep
    const ang = Math.atan2(cur.y - c.y, cur.x - c.x)
    // keep the sweep consistent with where the cursor actually is
    let d = ang - a0 - sw
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2
    sw += d
    // gone round more than once: only the last turn counts
    if (Math.abs(sw) >= Math.PI * 2) sw = Math.sign(sw) * (Math.abs(sw) % (Math.PI * 2))
    if (Math.abs(sw) < 1e-6) return null
    return sw >= 0 ? { c: [c.x, c.y], r, sa: a0, ea: a0 + sw } : { c: [c.x, c.y], r, sa: a0 + sw, ea: a0 }
  }

  // ---------------------------------------------------------------- pointer input

  onDown(e: PointerEvent): void {
    if (e.button === 2) {
      this.rightDown = { x: e.clientX, y: e.clientY }
      return
    }
    if (e.button !== 0) return
    const raw = this.toSketch(e.clientX, e.clientY)
    if (!raw) return
    this.host.canvas.setPointerCapture(e.pointerId)
    if (skTool.value === 'select') {
      const ent = this.hitEntity(raw)
      if (ent) {
        const sel = skSelection.value
        if (e.shiftKey) skSelection.value = sel.includes(ent) ? sel.filter((x) => x !== ent) : [...sel, ent]
        else if (!sel.includes(ent)) skSelection.value = [ent]
      }
      this.press = { x: e.clientX, y: e.clientY, raw, ent, shift: e.shiftKey }
      return
    }
    if (skTool.value === 'trim' || skTool.value === 'fillet') return this.modifyClick(raw)
    const pick = this.snapPick(raw, e.altKey, this.fromPick())
    this.press = { x: e.clientX, y: e.clientY, raw, ent: null, shift: false }
    this.click(pick)
    this.cursor = pick
    this.rebuildPreview()
  }

  onMove(e: PointerEvent): void {
    this.lastMove = e
    const raw = this.toSketch(e.clientX, e.clientY)
    if (!raw) return
    if (skTool.value === 'select') return this.selectMove(e, raw)
    if (skTool.value === 'trim' || skTool.value === 'fillet') {
      const id = this.modifyTarget(raw)
      if (id !== this.hoverId) {
        this.hoverId = id
        this.rebuild()
      }
      this.cursor = null
      this.host.canvas.style.cursor = id ? 'pointer' : ''
      return
    }

    const pick = this.snapPick(raw, e.altKey, this.fromPick())
    this.updateSweep(pick)
    this.cursor = pick
    const hover = pick.pointId ?? pick.onCurve ?? null
    if (hover !== this.hoverId) {
      this.hoverId = hover
      this.rebuild()
    } else this.rebuildPreview()
    this.host.canvas.style.cursor = 'crosshair'
    const text = this.cursorText(pick)
    if (text) this.host.showLabel(e, text)
    else this.host.hideLabel()
  }

  onUp(e: PointerEvent): void {
    const el = this.host.canvas
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (e.button === 2) return
    const press = this.press
    this.press = null
    const d = this.drag
    this.drag = null
    if (d?.kind === 'entity') {
      void endDrag()
      this.host.hideLabel()
      return
    }
    if (skTool.value === 'select') {
      if (d?.kind === 'box') this.finishBox(d, e)
      else if (press && !press.ent && !press.shift) skSelection.value = []
      this.host.hideLabel()
      return
    }
    // press–drag–release draws too: the release point counts as the next click
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) {
      const raw = this.toSketch(e.clientX, e.clientY)
      if (raw) this.click(this.snapPick(raw, e.altKey, this.fromPick()))
    }
    this.rebuildPreview()
  }

  onDblClick(): void {
    if (skTool.value === 'line' || skTool.value === 'spline') this.finishChain()
  }

  /**
   * Right click without dragging: first it ends the polyline or curve / drops the half-drawn
   * shape; with nothing under way it goes back to the Select tool.
   */
  onContextMenu(e: MouseEvent): void {
    const r = this.rightDown
    this.rightDown = null
    if (!r || Math.hypot(e.clientX - r.x, e.clientY - r.y) >= 5) return
    if (this.finishChain() || this.cancelOp()) return
    if (skTool.value !== 'select') {
      skTool.value = 'select'
      this.cursor = null
      this.host.hideLabel()
      this.rebuildPreview()
    }
  }

  onLeave(): void {
    this.cursor = null
    if (this.hoverId) {
      this.hoverId = null
      this.rebuild()
    } else this.rebuildPreview()
    this.host.hideLabel()
  }

  /** What the trim tool (a curve) or the fillet tool (a corner point) would act on here. */
  private modifyTarget(raw: XY): string | null {
    const s = sketch.value
    const tol = this.px(raw, HOVER_PX)
    if (skTool.value === 'fillet') {
      const id = this.nearestPoint(s, raw, tol * 1.5)
      return id && id !== ORIGIN ? id : null
    }
    return this.nearestCurve(s, raw, tol, false)?.id ?? null
  }

  private modifyClick(raw: XY): void {
    const id = this.modifyTarget(raw)
    if (!id) return
    if (skTool.value === 'trim') {
      void edit((s) => trimAt(s, id, raw), { sel: () => [] })
      return
    }
    const r = filletRadius.value
    if (!filletCorner(sketch.value, id, r)) return notice('sk.filletNo')
    void edit((s) => filletCorner(s, id, r)?.sketch ?? null, { sel: () => [] })
  }

  private fromPick(): Pick | null {
    if (skTool.value === 'line' && this.chain) return this.chain.prev
    return null
  }

  private cursorText(p: Pick): string {
    const tool = skTool.value
    const P = this.picks
    const mark = p.close ? '◉ ' : p.pointId ? '● ' : p.onCurve ? '⌒ ' : p.hv === 'h' ? '— ' : p.hv === 'v' ? '| ' : ''
    const c: XY = [p.x, p.y]
    if (tool === 'line' && this.chain) return `${mark}${fmt(dist([this.chain.prev.x, this.chain.prev.y], c))} ${t('unit.mm')}`
    if ((tool === 'rect' || tool === 'rectCenter') && P.length === 1) {
      const k = tool === 'rectCenter' ? 2 : 1
      return `${mark}${fmt(Math.abs(p.x - P[0].x) * k)} × ${fmt(Math.abs(p.y - P[0].y) * k)}`
    }
    if ((tool === 'circle' || tool === 'polygon') && P.length === 1) return `${mark}R ${fmt(dist([P[0].x, P[0].y], c))}`
    if (tool === 'arc' && P.length >= 1) {
      const r = dist([P[0].x, P[0].y], P.length === 2 ? [P[1].x, P[1].y] : c)
      if (P.length === 1) return `${mark}R ${fmt(r)}`
      const g = this.arcFromCenter(p)
      return `${mark}R ${fmt(r)}   ${g ? fmt(((g.ea - g.sa) * 180) / Math.PI) : 0}°`
    }
    return mark ? `${mark}${fmt(p.x)}, ${fmt(p.y)}` : ''
  }

  private selectMove(e: PointerEvent, raw: XY): void {
    const press = this.press
    if (press && !this.drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) {
      if (press.ent && !RESERVED.has(press.ent)) this.startEntityDrag(press.ent, press.raw)
      else if (!press.ent) this.drag = { kind: 'box', x0: press.x, y0: press.y, shift: press.shift }
    }
    const d = this.drag
    if (d?.kind === 'entity') {
      dragTo(d.targets(raw))
      this.host.canvas.style.cursor = 'grabbing'
      return
    }
    if (d?.kind === 'box') {
      this.host.showBox(d.x0, d.y0, e.clientX, e.clientY)
      return
    }
    if (press) return
    const ent = this.hitEntity(raw)
    if (ent !== this.hoverId) {
      this.hoverId = ent
      this.rebuild()
    }
    this.host.canvas.style.cursor = ent ? (RESERVED.has(ent) ? 'pointer' : 'move') : ''
  }

  private startEntityDrag(id: string, start: XY): void {
    const s = sketch.value
    const shift = (p: XY, raw: XY): [number, number] => [p[0] + raw[0] - start[0], p[1] + raw[1] - start[1]]
    let targets: ((raw: XY) => DragTarget[]) | null = null
    const pt = pointPos(s, id)
    if (pt) targets = (raw) => [{ id, x: shift(pt, raw)[0], y: shift(pt, raw)[1] }]
    const c = s.curves.find((k) => k.id === id)
    if (c?.kind === 'line') {
      const a = pointPos(s, c.p1)!
      const b = pointPos(s, c.p2)!
      targets = (raw) => [
        { id: c.p1, x: shift(a, raw)[0], y: shift(a, raw)[1] },
        { id: c.p2, x: shift(b, raw)[0], y: shift(b, raw)[1] }
      ]
    } else if (c?.kind === 'spline') {
      // the whole curve moves: its points by the same amount. Points held by constraints of
      // their own (on an axis, locked…) are left to the solver: pulling them would conflict
      const held = new Set(s.constraints.flatMap((k) => k.refs))
      const all = c.pts.map((p) => [p, pointPos(s, p)!] as const).filter(([, q]) => !!q)
      const free = all.filter(([p]) => !held.has(p))
      const at = free.length ? free : all
      targets = (raw) => at.map(([p, q]) => ({ id: p, x: shift(q, raw)[0], y: shift(q, raw)[1] }))
    } else if (c) {
      targets = (raw) => [{ id, x: raw[0], y: raw[1] }]
    }
    if (!targets) return
    beginDrag()
    this.drag = { kind: 'entity', targets }
  }

  private finishBox(d: Extract<Drag, { kind: 'box' }>, e: PointerEvent): void {
    this.host.hideBox()
    const x0 = Math.min(d.x0, e.clientX)
    const x1 = Math.max(d.x0, e.clientX)
    const y0 = Math.min(d.y0, e.clientY)
    const y1 = Math.max(d.y0, e.clientY)
    const inside = (p: XY) => {
      const q = this.host.toClient(this.toWorld(p))
      return !!q && q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1
    }
    const s = sketch.value
    const ids: string[] = []
    for (const p of s.points) if (inside([p.x, p.y])) ids.push(p.id)
    for (const c of s.curves) if (tessellate(s, c, 24).every(inside)) ids.push(c.id)
    const base = d.shift ? skSelection.value : []
    skSelection.value = [...new Set([...base, ...ids])]
  }

  cancelDrag(): boolean {
    const d = this.drag
    this.drag = null
    this.press = null
    if (d?.kind === 'entity') cancelSketchDrag()
    if (d?.kind === 'box') this.host.hideBox()
    return !!d
  }

  get dragging(): boolean {
    return this.drag !== null
  }

  // ---------------------------------------------------------------- keyboard

  /** Keys while sketching. Returns true when handled. */
  key(e: KeyboardEvent): boolean {
    const k = shortcutKey(e)
    if (this.drag) {
      // while dragging, only Esc (cancel) does anything
      if (e.key === 'Escape') this.cancelDrag()
      return true
    }
    if (e.key === 'Escape') {
      if (this.cancelOp()) return true
      if (skTool.value !== 'select') {
        skTool.value = 'select'
        return true
      }
      skSelection.value = []
      return true
    }
    if (e.key === 'Enter') return this.finishChain()
    if (e.ctrlKey || e.metaKey || e.altKey) return false
    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteSelected()
      return true
    }
    if (k === 'g') {
      toggleConstructionOrMode()
      return true
    }
    const cmds: Record<string, ConstraintCmd> = {
      c: 'coincident',
      h: 'horizontal',
      v: 'vertical',
      p: 'parallel',
      k: 'perpendicular',
      e: 'equal',
      t: 'tangent',
      m: 'midpoint',
      d: 'dimension'
    }
    if (cmds[k]) {
      runConstraint(cmds[k])
      return true
    }
    const tools: Record<string, typeof skTool.value> = {
      l: 'line',
      s: 'spline',
      r: 'rect',
      o: 'circle',
      a: 'arc',
      n: 'polygon',
      q: 'select'
    }
    if (tools[k]) {
      skTool.value = tools[k]
      return true
    }
    return false
  }

  /** Re-run the hover/preview for the last mouse position (e.g. after a key changed the tool). */
  refresh(): void {
    if (this.lastMove) this.onMove(this.lastMove)
  }
}

/** the sketch editor that is open (one at a time) */
let current: SketchEditor | null = null

/** While a dimension is dragged: put its number at this screen point. */
export function placeDimension(id: string, clientX: number, clientY: number): void {
  current?.placeDim(id, clientX, clientY)
}

/** Apply a constraint command to the selection (with a hint when the selection does not fit). */
export function runConstraint(cmd: ConstraintCmd): void {
  const sel = skSelection.value
  if (!applyCommand(sketch.value, sel, cmd)) {
    notice(`sk.need.${cmd}`)
    return
  }
  let added: string[] = []
  void edit(
    (s) => {
      const r = applyCommand(s, sel, cmd)
      if (!r) return null
      added = r.added
      return r.sketch
    },
    {
      strict: true,
      sel: () => [],
      after: (s) => {
        // a new dimension opens for typing right away
        const d = s.constraints.find((c) => added.includes(c.id) && DIMENSIONS.has(c.type))
        if (d) skEditDim.value = d.id
      }
    }
  )
}

/** Type a new value into a dimension. Signed dimensions keep their direction. */
export function setDimensionValue(id: string, typed: number): void {
  const c = sketch.value.constraints.find((k) => k.id === id)
  if (!c || !Number.isFinite(typed)) return
  const signed = c.type === 'distanceX' || c.type === 'distanceY' || c.type === 'angle'
  if (!signed && typed <= 0) return notice('sk.positive')
  const v = signed ? (Math.sign(c.value ?? 1) || 1) * Math.abs(typed) : typed
  void edit((s) => setDimension(s, id, v))
}

export function deleteSelected(): void {
  const ids = skSelection.value
  if (!ids.length) return
  void edit((s) => deleteEntities(s, ids), { sel: () => [] })
}

/** G: selected curves switch between normal and helper geometry; with nothing selected, new geometry does. */
export function toggleConstructionOrMode(): void {
  const s = sketch.value
  const ids = skSelection.value.filter((id) => s.curves.some((c) => c.id === id))
  if (ids.length) void edit((sk) => toggleConstruction(sk, ids))
  else skConstruction.value = !skConstruction.value
}

const r1 = (v: number) => Math.round(v * 10) / 10

/** What a dimension measures, in sketch coordinates (shared by drawing it and moving it). */
type DimGeometry =
  | { kind: 'linear'; ends: [XY, XY] }
  | { kind: 'axis'; ends: [XY, XY]; x: boolean }
  | { kind: 'pointLine'; p: XY; foot: XY }
  | { kind: 'round'; ctr: XY; r: number; mid: number }
  | { kind: 'angle'; I: XY; d1: XY; d2: XY }

function dimGeometry(s: Sketch, c: SkConstraint): DimGeometry | null {
  const r = c.refs
  const endsOf = (): [XY, XY] | null => {
    if (r.length === 1) return lineEnds(s, r[0])
    const a = pointPos(s, r[0])
    const b = pointPos(s, r[1])
    return a && b ? [a, b] : null
  }
  switch (c.type) {
    case 'distance': {
      if (r.length === 2 && kindOf(s, r[1]) === 'line') {
        const p = pointPos(s, r[0])
        const L = lineEnds(s, r[1])
        return p && L ? { kind: 'pointLine', p, foot: segmentProject(p, L[0], L[1], true).q } : null
      }
      const e = endsOf()
      return e ? { kind: 'linear', ends: e } : null
    }
    case 'distanceX':
    case 'distanceY': {
      const e = endsOf()
      return e ? { kind: 'axis', ends: e, x: c.type === 'distanceX' } : null
    }
    case 'radius':
    case 'diameter': {
      const k = s.curves.find((x) => x.id === r[0])
      if (!k || k.kind === 'line' || k.kind === 'spline') return null
      const ctr = pointPos(s, k.c)
      if (!ctr) return null
      let mid = Math.PI / 4
      if (k.kind === 'arc') {
        const g = arcAngles(s, k)
        if (g) mid = (g.sa + g.ea) / 2
      }
      return { kind: 'round', ctr, r: k.r, mid }
    }
    case 'angle': {
      const A = lineEnds(s, r[0])
      const B = lineEnds(s, r[1])
      if (!A || !B) return null
      const d1: XY = [A[1][0] - A[0][0], A[1][1] - A[0][1]]
      const d2: XY = [B[1][0] - B[0][0], B[1][1] - B[0][1]]
      const den = d1[0] * d2[1] - d1[1] * d2[0]
      let I: XY
      if (Math.abs(den) < 1e-9) I = [(A[0][0] + B[0][0]) / 2, (A[0][1] + B[0][1]) / 2]
      else {
        const t = ((B[0][0] - A[0][0]) * d2[1] - (B[0][1] - A[0][1]) * d2[0]) / den
        I = [A[0][0] + t * d1[0], A[0][1] + t * d1[1]]
      }
      // rays from the corner toward each line's middle
      const toward = (L: [XY, XY], d: XY): XY => {
        const v: XY = [(L[0][0] + L[1][0]) / 2 - I[0], (L[0][1] + L[1][1]) / 2 - I[1]]
        return Math.hypot(v[0], v[1]) > 1e-6 ? v : d
      }
      return { kind: 'angle', I, d1: toward(A, d1), d2: toward(B, d2) }
    }
  }
  return null
}

/** End points of a line or axis. */
function lineEnds(s: Sketch, id: string): [XY, XY] | null {
  if (id === AXIS_X) return [[0, 0], [1, 0]]
  if (id === AXIS_Y) return [[0, 0], [0, 1]]
  const l = s.curves.find((k) => k.id === id)
  if (!l || l.kind !== 'line') return null
  const a = pointPos(s, l.p1)
  const b = pointPos(s, l.p2)
  return a && b ? [a, b] : null
}

function setSegments(obj: LineSegments2, pos: number[], colors: number[] | null): void {
  const g = new LineSegmentsGeometry()
  if (pos.length) {
    g.setPositions(pos)
    if (colors) g.setColors(colors)
  }
  obj.geometry.dispose()
  obj.geometry = g
  obj.visible = pos.length > 0
  if (pos.length) obj.computeLineDistances()
}

function rectCorners(a: Pick, b: Pick, center: boolean): XY[] {
  if (center) {
    const dx = Math.abs(b.x - a.x)
    const dy = Math.abs(b.y - a.y)
    return [
      [a.x - dx, a.y - dy],
      [a.x + dx, a.y - dy],
      [a.x + dx, a.y + dy],
      [a.x - dx, a.y + dy]
    ]
  }
  return [
    [a.x, a.y],
    [b.x, a.y],
    [b.x, b.y],
    [a.x, b.y]
  ]
}

function polygonCorners(c: Pick, corner: Pick, n: number): XY[] {
  const r = dist([c.x, c.y], [corner.x, corner.y])
  const a0 = Math.atan2(corner.y - c.y, corner.x - c.x)
  const out: XY[] = []
  for (let i = 0; i < n; i++) out.push([c.x + r * Math.cos(a0 + (i * 2 * Math.PI) / n), c.y + r * Math.sin(a0 + (i * 2 * Math.PI) / n)])
  return out
}

/** Arc from `a` to `b` through `m`: its circle and CCW angles; `forward` when it runs a → b CCW. */
function arcThrough(a: XY, b: XY, m: XY): { c: XY; r: number; sa: number; ea: number; forward: boolean } | null {
  const g = circleThrough(a, b, m)
  if (!g) return null
  const ang = (p: XY) => Math.atan2(p[1] - g.c[1], p[0] - g.c[0])
  const aa = ang(a)
  let ab = ang(b)
  if (ab <= aa) ab += Math.PI * 2
  const forward = inSweep(ang(m), aa, ab)
  if (forward) return { c: g.c, r: g.r, sa: aa, ea: ab, forward }
  let ea = aa
  const sa = ang(b)
  if (ea <= sa) ea += Math.PI * 2
  return { c: g.c, r: g.r, sa, ea, forward }
}
