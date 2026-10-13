import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type SketchSolver, createSolver } from '@/core/sketch/solver'
import { AXIS_X, ORIGIN, type Sketch, emptySketch } from '@/core/sketch/types'
import {
  addArc,
  addCircle,
  addConstraint,
  addLine,
  addPolygon,
  addRect,
  deleteEntities,
  measure,
  mergePoints,
  pos,
  setDimension,
  toggleConstruction
} from '@/core/sketch/ops'

let solver: SketchSolver
beforeAll(async () => {
  solver = await createSolver()
})
afterAll(() => solver.dispose())

const near = (a: number, b: number, eps = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(eps)

/** A slightly skewed rectangle-ish quad with H/V constraints: 4 points × 2 − 4 = 4 DOF. */
function rect(): { sketch: Sketch; lines: string[]; points: string[] } {
  return addRect(emptySketch(), [1, 1], [31, 21])
}

function fullyConstrained() {
  const r = rect()
  let s = r.sketch
  s = addConstraint(s, 'distance', [r.lines[0]], 40).sketch
  s = addConstraint(s, 'distance', [r.lines[1]], 25).sketch
  s = addConstraint(s, 'coincident', [r.points[0], ORIGIN]).sketch
  return { ...r, sketch: s }
}

describe('sketch solver', () => {
  it('free rectangle with H/V constraints has 4 DOF', () => {
    const res = solver.solve(rect().sketch)
    expect(res.state).toBe('ok')
    expect(res.dof).toBe(4)
  })

  it('rectangle with two dimensions and anchored corner is fully constrained', () => {
    const r = fullyConstrained()
    const res = solver.solve(r.sketch)
    expect(res.state).toBe('ok')
    expect(res.dof).toBe(0)
    const p = r.points.map((id) => pos(res.sketch, id))
    near(p[0][0], 0)
    near(p[0][1], 0)
    near(p[2][0], 40)
    near(p[2][1], 25)
  })

  it('an extra, contradicting dimension is reported as a conflict and nothing moves', () => {
    const r = fullyConstrained()
    const extra = addConstraint(r.sketch, 'distance', [r.lines[2]], 55)
    const res = solver.solve(extra.sketch)
    expect(res.state).toBe('conflict')
    expect(res.conflicting).toContain(extra.id)
    expect(res.sketch).toBe(extra.sketch)
  })

  it('a repeated, consistent constraint is reported as redundant', () => {
    const r = rect()
    const extra = addConstraint(r.sketch, 'parallel', [r.lines[0], r.lines[2]])
    const res = solver.solve(extra.sketch)
    expect(res.state).toBe('redundant')
    expect(res.redundant.length).toBeGreaterThan(0)
  })

  it('line–arc tangency converges', () => {
    let s = emptySketch()
    const arc = addArc(s, [0, 0], [10, 0], [0, 10])
    s = arc.sketch
    const line = addLine(s, arc.end, [-12, 12])
    s = line.sketch
    s = addConstraint(s, 'tangent', [line.id, arc.id]).sketch
    s = addConstraint(s, 'radius', [arc.id], 8).sketch
    s = addConstraint(s, 'coincident', [arc.c, ORIGIN]).sketch
    const res = solver.solve(s)
    expect(['ok', 'redundant']).toContain(res.state)
    // the line direction is perpendicular to the radius at the shared point
    const c = pos(res.sketch, arc.c)
    const e = pos(res.sketch, arc.end)
    const q = pos(res.sketch, line.p2)
    const radial = [e[0] - c[0], e[1] - c[1]]
    const dir = [q[0] - e[0], q[1] - e[1]]
    near(Math.hypot(radial[0], radial[1]), 8)
    near((radial[0] * dir[0] + radial[1] * dir[1]) / Math.hypot(dir[0], dir[1]), 0, 1e-3)
  })

  it('dragging moves the free points only', () => {
    // bottom-left corner locked, width fixed: dragging the top-right corner changes only the height
    const r = rect()
    let s = addConstraint(r.sketch, 'lock', [r.points[0]], 1, 1).sketch
    s = addConstraint(s, 'distance', [r.lines[0]], 30).sketch
    const res = solver.solve(s, [{ id: r.points[2], x: 50, y: 40 }])
    expect(res.state).toBe('ok')
    const p0 = pos(res.sketch, r.points[0])
    const p2 = pos(res.sketch, r.points[2])
    near(p0[0], 1)
    near(p0[1], 1)
    near(p2[0], 31, 1e-3) // width kept
    near(p2[1], 40, 1e-3) // height followed the mouse
    expect(res.dof).toBe(1) // temporary drag constraints do not count
  })

  it('dragging a circle edge changes its radius', () => {
    const c = addCircle(emptySketch(), [0, 0], 5)
    const res = solver.solve(c.sketch, [{ id: c.id, x: 12, y: 0 }])
    const circle = res.sketch.curves.find((k) => k.id === c.id)!
    expect(circle.kind === 'circle' && Math.abs(circle.r - 12) < 1e-3).toBe(true)
  })

  it('horizontal/vertical distances, angle, diameter and point-on-axis solve to the asked values', () => {
    let s = emptySketch()
    const a = addLine(s, [2, 3], [9, 5])
    s = a.sketch
    const b = addLine(s, a.p1, [4, 12])
    s = b.sketch
    s = addConstraint(s, 'coincident', [a.p1, ORIGIN]).sketch
    s = addConstraint(s, 'distanceX', [a.id], 20).sketch
    s = addConstraint(s, 'distanceY', [a.id], 0).sketch
    s = addConstraint(s, 'angle', [a.id, b.id], 60).sketch
    s = addConstraint(s, 'distance', [b.id], 10).sketch
    const circ = addCircle(s, [30, 2], 4)
    s = circ.sketch
    s = addConstraint(s, 'pointOn', [circ.c, AXIS_X]).sketch
    s = addConstraint(s, 'diameter', [circ.id], 6).sketch
    const res = solver.solve(s)
    expect(res.state).toBe('ok')
    const q = pos(res.sketch, a.p2)
    near(q[0], 20)
    near(q[1], 0)
    const t = pos(res.sketch, b.p2)
    near(t[0], 5, 1e-3)
    near(t[1], 10 * Math.sin(Math.PI / 3), 1e-3)
    near(measure(res.sketch, 'angle', [a.id, b.id])!, 60, 1e-3)
    near(pos(res.sketch, circ.c)[1], 0)
    near(measure(res.sketch, 'radius', [circ.id])!, 3)
  })

  it('regular polygon keeps equal sides when its size changes', () => {
    const poly = addPolygon(emptySketch(), [0, 0], [10, 0], 6)
    let s = addConstraint(poly.sketch, 'radius', [poly.circle], 20).sketch
    const circle = s.curves.find((c) => c.id === poly.circle)
    if (circle?.kind !== 'circle') throw new Error('no construction circle')
    s = addConstraint(s, 'coincident', [circle.c, ORIGIN]).sketch
    const res = solver.solve(s)
    expect(['ok', 'redundant']).toContain(res.state)
    const lens = poly.lines.map((l) => measure(res.sketch, 'distance', [l])!)
    for (const l of lens) near(l, 20, 1e-3)
  })

  it('centered rectangle stays centered', () => {
    const r = addRect(emptySketch(), [5, 5], [15, 10], true)
    let s = addConstraint(r.sketch, 'coincident', [r.center!, ORIGIN]).sketch
    s = addConstraint(s, 'distance', [r.lines[0]], 8).sketch
    s = addConstraint(s, 'distance', [r.lines[1]], 6).sketch
    const res = solver.solve(s)
    expect(res.state).toBe('ok')
    expect(res.dof).toBe(0)
    const p = pos(res.sketch, r.points[0])
    near(p[0], -4)
    near(p[1], -3)
  })
})

describe('sketch ops', () => {
  it('delete a line keeps shared points, removes orphans and dangling constraints', () => {
    const r = rect()
    const s = deleteEntities(r.sketch, [r.lines[0]])
    expect(s.curves).toHaveLength(3)
    expect(s.points).toHaveLength(4) // every point is still used by a neighbour line
    expect(s.constraints.some((c) => c.refs.includes(r.lines[0]))).toBe(false)
    const s2 = deleteEntities(s, [r.lines[1], r.lines[2]])
    expect(s2.points.map((p) => p.id).sort()).toEqual([r.points[0], r.points[3]].sort())
  })

  it('deleting a point removes the curves using it', () => {
    const r = rect()
    const s = deleteEntities(r.sketch, [r.points[0]])
    expect(s.curves).toHaveLength(2)
    expect(s.points).toHaveLength(3)
  })

  it('origin and axes cannot be deleted', () => {
    const s = deleteEntities(rect().sketch, [ORIGIN, AXIS_X])
    expect(s.curves).toHaveLength(4)
  })

  it('merge points closes a polyline and drops degenerate curves', () => {
    let s = emptySketch()
    const a = addLine(s, [0, 0], [10, 0])
    const b = addLine(a.sketch, a.p2, [10, 10])
    const c = addLine(b.sketch, b.p2, [0.2, 0.1])
    s = mergePoints(c.sketch, a.p1, c.p2)
    expect(s.points).toHaveLength(3)
    expect(s.curves.find((k) => k.id === c.id)).toMatchObject({ p2: a.p1 })
    const d = mergePoints(s, a.p1, a.p2) // line a collapses
    expect(d.curves.some((k) => k.id === a.id)).toBe(false)
  })

  it('construction toggle and dimension edits', () => {
    const r = fullyConstrained()
    let s = toggleConstruction(r.sketch, [r.lines[0]])
    expect(s.curves[0].construction).toBe(true)
    s = toggleConstruction(s, [r.lines[0]])
    expect(s.curves[0].construction).toBeUndefined()
    const dim = s.constraints.find((c) => c.type === 'distance')!
    expect(setDimension(s, dim.id, -3)).toBe(s)
    const s2 = setDimension(s, dim.id, 50)
    const res = solver.solve(s2)
    near(pos(res.sketch, r.points[1])[0], 50)
  })

  it('measure gives the current values for new dimensions', () => {
    const r = rect()
    expect(measure(r.sketch, 'distance', [r.lines[0]])).toBe(30)
    expect(measure(r.sketch, 'distanceY', [r.points[0], r.points[3]])).toBe(20)
    expect(measure(r.sketch, 'angle', [r.lines[0], r.lines[1]])).toBe(90)
  })
})

describe('what is still free', () => {
  it('a fixed, fully dimensioned rectangle is all pinned down; a loose circle beside it is free', async () => {
    const { createSolver } = await import('@/core/sketch/solver')
    const { addRect, addCircle, addConstraint } = await import('@/core/sketch/ops')
    const { emptySketch } = await import('@/core/sketch/types')
    const solver = await createSolver()
    const r = addRect(emptySketch(), [0, 0], [40, 20])
    let s = r.sketch
    s = addConstraint(s, 'lock', [r.points[0]], 0, 0).sketch
    s = addConstraint(s, 'distanceX', [r.points[0], r.points[1]], 40).sketch
    s = addConstraint(s, 'distanceY', [r.points[1], r.points[2]], 20).sketch
    expect(solver.free(s)).toEqual([])
    const c = addCircle(s, [80, 10], 10)
    s = addConstraint(c.sketch, 'diameter', [c.id], 20).sketch
    const free = new Set(solver.free(s))
    expect(free.has(c.id)).toBe(true)
    expect(free.has(c.c)).toBe(true)
    expect(r.lines.some((l) => free.has(l))).toBe(false)
    // without the lock the rectangle can slide: all of it is free
    const loose = { ...s, constraints: s.constraints.filter((k) => k.type !== 'lock') }
    const f2 = new Set(solver.free(loose))
    expect(r.lines.every((l) => f2.has(l))).toBe(true)
    solver.dispose()
  })
})
