/**
 * Bridge between the sketch model and PlaneGCS (FreeCAD's 2D constraint solver, WebAssembly
 * build from @salusoft89/planegcs, LGPL). Runs synchronously on the calling thread so each
 * mouse move while dragging is solved immediately.
 *
 * Each sketch entity keeps its id in the solver; a constraint that expands into several solver
 * constraints gets ids `${id}#0`, `${id}#1`, … Anything with a `#` is internal.
 */
import { Algorithm, GcsWrapper, SolveStatus, make_gcs_wrapper } from '@salusoft89/planegcs'
import type { SketchPrimitive } from '@salusoft89/planegcs'
import {
  AXIS_X,
  AXIS_Y,
  ORIGIN,
  type SkConstraint,
  type SkCurve,
  type Sketch,
  kindOf,
  pointPos
} from './types'
import { endpointTangency } from './geometry'

export type SolveState =
  /** solved; `dof` tells how much is still free */
  | 'ok'
  /** solved, but some constraints repeat what others already say */
  | 'redundant'
  /** constraints contradict each other; the sketch was left unchanged */
  | 'conflict'
  /** the solver did not converge; the sketch was left unchanged */
  | 'failed'

export interface SolveResult {
  sketch: Sketch
  state: SolveState
  /** remaining degrees of freedom (0 = fully constrained) */
  dof: number
  conflicting: string[]
  redundant: string[]
}

/** Drag target: a point goes to (x, y); a circle/arc gets the radius that passes through (x, y). */
export interface DragTarget {
  id: string
  x: number
  y: number
}

const DEG = Math.PI / 180
const round = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6
  return Object.is(r, -0) ? 0 : r
}

/** Translate one sketch constraint to solver primitives. Unknown shapes produce nothing. */
export function toGcs(s: Sketch, c: SkConstraint): SketchPrimitive[] {
  const k = (i: number) => `${c.id}#${i}`
  const r = c.refs
  const kinds = r.map((id) => kindOf(s, id))
  const isRound = (i: number) => kinds[i] === 'circle' || kinds[i] === 'arc'
  const line = (id: string) => lineOf(s, id)
  const v = c.value ?? 0
  const out: Record<string, unknown>[] = []
  const pp = kinds.length === 2 && kinds[0] === 'point' && kinds[1] === 'point'
  const oneLine = kinds.length === 1 && kinds[0] === 'line'

  switch (c.type) {
    case 'coincident':
      if (pp) out.push({ id: k(0), type: 'p2p_coincident', p1_id: r[0], p2_id: r[1] })
      break
    case 'horizontal':
    case 'vertical': {
      const h = c.type === 'horizontal'
      if (oneLine) out.push({ id: k(0), type: h ? 'horizontal_l' : 'vertical_l', l_id: r[0] })
      else if (pp) out.push({ id: k(0), type: h ? 'horizontal_pp' : 'vertical_pp', p1_id: r[0], p2_id: r[1] })
      break
    }
    case 'parallel':
      if (kinds[0] === 'line' && kinds[1] === 'line') out.push({ id: k(0), type: 'parallel', l1_id: r[0], l2_id: r[1] })
      break
    case 'perpendicular':
      if (kinds[0] === 'line' && kinds[1] === 'line')
        out.push({ id: k(0), type: 'perpendicular_ll', l1_id: r[0], l2_id: r[1] })
      break
    case 'equal':
      if (kinds[0] === 'line' && kinds[1] === 'line') out.push({ id: k(0), type: 'equal_length', l1_id: r[0], l2_id: r[1] })
      else if (isRound(0) && isRound(1)) {
        const [a, b] = kinds[0] === 'circle' ? [0, 1] : [1, 0]
        const ka = kinds[a]
        const kb = kinds[b]
        if (ka === 'circle' && kb === 'circle') out.push({ id: k(0), type: 'equal_radius_cc', c1_id: r[a], c2_id: r[b] })
        else if (ka === 'circle') out.push({ id: k(0), type: 'equal_radius_ca', c1_id: r[a], a2_id: r[b] })
        else out.push({ id: k(0), type: 'equal_radius_aa', a1_id: r[a], a2_id: r[b] })
      }
      break
    case 'tangent': {
      // meeting at a shared end point: tangent right there (angle between directions 0° or 180°)
      const at = kinds.length === 2 ? endpointTangency(s, r[0], r[1]) : null
      if (at) {
        const angle = (c.value2 ?? at.angle) * DEG
        out.push({ id: k(0), type: 'angle_via_point', crv1_id: r[0], crv2_id: r[1], p_id: at.p, angle })
        break
      }
      if (kinds[0] === 'line' && isRound(1))
        out.push(
          kinds[1] === 'circle'
            ? { id: k(0), type: 'tangent_lc', l_id: r[0], c_id: r[1] }
            : { id: k(0), type: 'tangent_la', l_id: r[0], a_id: r[1] }
        )
      else if (isRound(0) && kinds[1] === 'line')
        out.push(
          kinds[0] === 'circle'
            ? { id: k(0), type: 'tangent_lc', l_id: r[1], c_id: r[0] }
            : { id: k(0), type: 'tangent_la', l_id: r[1], a_id: r[0] }
        )
      else if (isRound(0) && isRound(1)) {
        if (kinds[0] === 'circle' && kinds[1] === 'circle') out.push({ id: k(0), type: 'tangent_cc', c1_id: r[0], c2_id: r[1] })
        else if (kinds[0] === 'arc' && kinds[1] === 'arc') out.push({ id: k(0), type: 'tangent_aa', a1_id: r[0], a2_id: r[1] })
        else {
          const [ci, ai] = kinds[0] === 'circle' ? [0, 1] : [1, 0]
          out.push({ id: k(0), type: 'tangent_ca', c_id: r[ci], a_id: r[ai] })
        }
      }
      break
    }
    case 'pointOn':
      if (kinds[0] !== 'point') break
      if (kinds[1] === 'line') out.push({ id: k(0), type: 'point_on_line_pl', p_id: r[0], l_id: r[1] })
      else if (kinds[1] === 'circle') out.push({ id: k(0), type: 'point_on_circle', p_id: r[0], c_id: r[1] })
      else if (kinds[1] === 'arc') out.push({ id: k(0), type: 'point_on_arc', p_id: r[0], a_id: r[1] })
      break
    case 'midpoint': {
      const l = kinds[0] === 'point' && kinds[1] === 'line' ? line(r[1]) : null
      if (l) out.push({ id: k(0), type: 'p2p_symmetric_ppp', p1_id: l[0], p2_id: l[1], p_id: r[0] })
      break
    }
    case 'symmetric':
      if (kinds[0] !== 'point' || kinds[1] !== 'point') break
      if (kinds[2] === 'line') out.push({ id: k(0), type: 'p2p_symmetric_ppl', p1_id: r[0], p2_id: r[1], l_id: r[2] })
      else if (kinds[2] === 'point') out.push({ id: k(0), type: 'p2p_symmetric_ppp', p1_id: r[0], p2_id: r[1], p_id: r[2] })
      break
    case 'lock':
      if (kinds[0] === 'point') {
        out.push({ id: k(0), type: 'coordinate_x', p_id: r[0], x: v })
        out.push({ id: k(1), type: 'coordinate_y', p_id: r[0], y: c.value2 ?? 0 })
      }
      break
    case 'distance': {
      if (oneLine) {
        const l = line(r[0])
        if (l) out.push({ id: k(0), type: 'p2p_distance', p1_id: l[0], p2_id: l[1], distance: v })
      } else if (pp) out.push({ id: k(0), type: 'p2p_distance', p1_id: r[0], p2_id: r[1], distance: v })
      else if (kinds[0] === 'point' && kinds[1] === 'line')
        out.push({ id: k(0), type: 'p2l_distance', p_id: r[0], l_id: r[1], distance: v })
      break
    }
    case 'distanceX':
    case 'distanceY': {
      const pts = oneLine ? line(r[0]) : pp ? [r[0], r[1]] : null
      const prop = c.type === 'distanceX' ? 'x' : 'y'
      if (pts)
        out.push({
          id: k(0),
          type: 'difference',
          param1: { o_id: pts[0], prop },
          param2: { o_id: pts[1], prop },
          difference: v
        })
      break
    }
    case 'radius':
    case 'diameter': {
      const d = c.type === 'diameter'
      if (kinds[0] === 'circle')
        out.push(d ? { id: k(0), type: 'circle_diameter', c_id: r[0], diameter: v } : { id: k(0), type: 'circle_radius', c_id: r[0], radius: v })
      else if (kinds[0] === 'arc')
        out.push(d ? { id: k(0), type: 'arc_diameter', a_id: r[0], diameter: v } : { id: k(0), type: 'arc_radius', a_id: r[0], radius: v })
      break
    }
    case 'angle':
      if (kinds[0] === 'line' && kinds[1] === 'line')
        out.push({ id: k(0), type: 'l2l_angle_ll', l1_id: r[0], l2_id: r[1], angle: v * DEG })
      break
  }
  return out as unknown as SketchPrimitive[]
}

function lineOf(s: Sketch, id: string): [string, string] | null {
  if (id === AXIS_X) return [ORIGIN, `${ORIGIN}#x`]
  if (id === AXIS_Y) return [ORIGIN, `${ORIGIN}#y`]
  const c = s.curves.find((c) => c.id === id)
  return c && c.kind === 'line' ? [c.p1, c.p2] : null
}

/** Geometry (origin, axes, points, curves) as solver primitives. */
function geometry(s: Sketch): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [
    { id: ORIGIN, type: 'point', x: 0, y: 0, fixed: true },
    { id: `${ORIGIN}#x`, type: 'point', x: 1, y: 0, fixed: true },
    { id: `${ORIGIN}#y`, type: 'point', x: 0, y: 1, fixed: true },
    { id: AXIS_X, type: 'line', p1_id: ORIGIN, p2_id: `${ORIGIN}#x` },
    { id: AXIS_Y, type: 'line', p1_id: ORIGIN, p2_id: `${ORIGIN}#y` }
  ]
  for (const p of s.points) out.push({ id: p.id, type: 'point', x: p.x, y: p.y, fixed: false })
  for (const c of s.curves) out.push(...curveGcs(s, c))
  return out
}

function curveGcs(s: Sketch, c: SkCurve): Record<string, unknown>[] {
  if (c.kind === 'line') return [{ id: c.id, type: 'line', p1_id: c.p1, p2_id: c.p2 }]
  if (c.kind === 'circle') return [{ id: c.id, type: 'circle', c_id: c.c, radius: c.r }]
  // a spline is only its points: they are already in the solver, and nothing ties them together
  if (c.kind === 'spline') return []
  // pointPos knows the origin too: arcs may be centred on it or start there
  const ctr = pointPos(s, c.c)
  const a = pointPos(s, c.start)
  const b = pointPos(s, c.end)
  let sa = 0
  let ea = Math.PI / 2
  if (ctr && a && b) {
    sa = Math.atan2(a[1] - ctr[1], a[0] - ctr[0])
    ea = Math.atan2(b[1] - ctr[1], b[0] - ctr[0])
    if (ea <= sa) ea += 2 * Math.PI
  }
  return [
    { id: c.id, type: 'arc', c_id: c.c, radius: c.r, start_angle: sa, end_angle: ea, start_id: c.start, end_id: c.end },
    { id: `${c.id}#rules`, type: 'arc_rules', a_id: c.id }
  ]
}

export class SketchSolver {
  constructor(private w: GcsWrapper) {}

  /**
   * Solve the sketch. With `drag`, the given points (or circle/arc radii) are pulled toward the
   * targets as softly as the other constraints allow.
   */
  solve(s: Sketch, drag: DragTarget[] = []): SolveResult {
    try {
      return this.run(s, drag)
    } catch (e) {
      // e.g. a damaged file with clashing ids: report a failed solve instead of throwing
      console.error('sketch solve failed', e)
      return { sketch: s, state: 'failed', dof: 0, conflicting: [], redundant: [] }
    }
  }

  private run(s: Sketch, drag: DragTarget[]): SolveResult {
    const w = this.w
    w.clear_data()
    const ids = new Set(s.constraints.map((c) => c.id))
    const prims: Record<string, unknown>[] = geometry(s)
    for (const c of s.constraints) prims.push(...(toGcs(s, c) as unknown as Record<string, unknown>[]))
    drag.forEach((d, i) => prims.push(...dragGcs(s, d, i)))
    w.push_primitives_and_params(prims as unknown as SketchPrimitive[])

    const status = w.solve(Algorithm.DogLeg)
    const user = (list: string[]) => [...new Set(list.map((id) => id.split('#')[0]))].filter((id) => ids.has(id))
    const conflicting = user(w.get_gcs_conflicting_constraints())
    const redundant = user(w.get_gcs_redundant_constraints())
    const dof = w.gcs.dof()

    const failed = status === SolveStatus.Failed || status === SolveStatus.SuccessfulSolutionInvalid
    if (failed || conflicting.length) {
      return { sketch: s, state: conflicting.length ? 'conflict' : 'failed', dof, conflicting, redundant }
    }
    w.apply_solution()
    return { sketch: readBack(s, w), state: redundant.length ? 'redundant' : 'ok', dof, conflicting, redundant }
  }

  /**
   * Which points and curves can still move (the rest is fully defined). Each point is nudged a
   * little along X and along Y, each circle and arc made a little bigger, as softly as a mouse
   * drag: whatever follows is free. Empty when nothing is free; null when the sketch is too big to
   * check this way or does not solve.
   */
  free(s: Sketch, maxPoints = 120): string[] | null {
    try {
      const base = this.run(s, [])
      if (base.state === 'conflict' || base.state === 'failed') return null
      if (base.dof === 0) return []
      if (base.sketch.points.length > maxPoints) return null
      const sk = base.sketch
      const freePts = new Set<string>()
      const freeRadius = new Set<string>()
      const span = Math.max(1, ...sk.points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))))
      const eps = Math.max(0.05, span * 1e-3)
      const held = new Set(sk.constraints.filter((c) => c.type === 'lock').map((c) => c.refs[0]))
      const moved = (r: SolveResult, id: string, x: number, y: number) => {
        const p = r.sketch.points.find((q) => q.id === id)
        return !!p && Math.hypot(p.x - x, p.y - y) > eps * 0.2
      }
      for (const p of sk.points) {
        if (held.has(p.id)) continue
        for (const [dx, dy] of [
          [eps, 0],
          [0, eps]
        ]) {
          const r = this.run(sk, [{ id: p.id, x: p.x + dx, y: p.y + dy }])
          if (r.state !== 'conflict' && r.state !== 'failed' && moved(r, p.id, p.x, p.y)) {
            freePts.add(p.id)
            break
          }
        }
      }
      for (const c of sk.curves) {
        if (c.kind !== 'circle' && c.kind !== 'arc') continue
        const ctr = pointPos(sk, c.c)
        if (!ctr) continue
        const r = this.run(sk, [{ id: c.id, x: ctr[0] + c.r + eps, y: ctr[1] }])
        const after = r.sketch.curves.find((k) => k.id === c.id)
        if (r.state !== 'conflict' && r.state !== 'failed' && after && 'r' in after && Math.abs(after.r - c.r) > eps * 0.2) freeRadius.add(c.id)
      }
      const out = new Set<string>(freePts)
      for (const c of sk.curves) {
        const pts = c.kind === 'line' ? [c.p1, c.p2] : c.kind === 'spline' ? c.pts : c.kind === 'circle' ? [c.c] : [c.c, c.start, c.end]
        if (freeRadius.has(c.id) || pts.some((p) => freePts.has(p))) out.add(c.id)
      }
      return [...out]
    } catch (e) {
      console.error('sketch free check failed', e)
      return null
    }
  }

  dispose() {
    this.w.destroy_gcs_module()
  }
}

function dragGcs(s: Sketch, d: DragTarget, i: number): Record<string, unknown>[] {
  const kind = kindOf(s, d.id)
  const id = `drag${i}#`
  if (kind === 'point')
    return [
      { id: id + 'x', type: 'coordinate_x', p_id: d.id, x: d.x, temporary: true },
      { id: id + 'y', type: 'coordinate_y', p_id: d.id, y: d.y, temporary: true }
    ]
  const c = s.curves.find((c) => c.id === d.id)
  if (c && (c.kind === 'circle' || c.kind === 'arc')) {
    const ctr = pointPos(s, c.c)
    if (!ctr) return []
    const r = Math.hypot(d.x - ctr[0], d.y - ctr[1])
    return [
      c.kind === 'circle'
        ? { id: id + 'r', type: 'circle_radius', c_id: c.id, radius: r, temporary: true }
        : { id: id + 'r', type: 'arc_radius', a_id: c.id, radius: r, temporary: true }
    ]
  }
  return []
}

function readBack(s: Sketch, w: GcsWrapper): Sketch {
  const got = new Map<string, Record<string, unknown>>()
  for (const p of w.sketch_index.get_primitives()) got.set(p.id as string, p as unknown as Record<string, unknown>)
  return {
    ...s,
    points: s.points.map((p) => {
      const g = got.get(p.id)
      return g ? { ...p, x: round(g.x as number), y: round(g.y as number) } : p
    }),
    curves: s.curves.map((c) => {
      if (c.kind === 'line') return c
      const g = got.get(c.id)
      return g ? { ...c, r: round(Math.abs(g.radius as number)) } : c
    })
  }
}

/** Create a solver. `wasmPath` is where the planegcs.wasm file is served from (needed under Vite). */
export async function createSolver(wasmPath?: string): Promise<SketchSolver> {
  return new SketchSolver(await make_gcs_wrapper(wasmPath))
}
