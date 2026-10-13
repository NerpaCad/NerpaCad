import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addCircle, addConstraint, addLine, addRect, pos } from '@/core/sketch/ops'
import { filletCorner, trimAt } from '@/core/sketch/modify'
import { buildProfile, signedArea } from '@/core/sketch/profile'
import { type SketchSolver, createSolver } from '@/core/sketch/solver'
import { ORIGIN, emptySketch } from '@/core/sketch/types'

let solver: SketchSolver
beforeAll(async () => {
  solver = await createSolver()
})
afterAll(() => solver.dispose())

describe('trim', () => {
  it('cuts the middle of a line between two crossing lines', () => {
    let s = emptySketch()
    const h = addLine(s, [0, 0], [30, 0])
    s = h.sketch
    s = addLine(s, [10, -5], [10, 5]).sketch
    s = addLine(s, [20, -5], [20, 5]).sketch
    const r = trimAt(s, h.id, [15, 0])!
    const lines = r.curves.filter((c) => c.kind === 'line')
    expect(lines).toHaveLength(4)
    const res = solver.solve(r)
    expect(res.state).toBe('ok')
    const first = res.sketch.curves.find((c) => c.id === h.id)!
    expect(first.kind === 'line' && pos(res.sketch, first.p2)[0]).toBeCloseTo(10, 6)
  })

  it('the two pieces of a horizontal line stay horizontal', () => {
    let s = emptySketch()
    const h = addLine(s, [0, 0], [30, 0])
    s = addConstraint(h.sketch, 'horizontal', [h.id]).sketch
    s = addLine(s, [10, -5], [10, 5]).sketch
    s = addLine(s, [20, -5], [20, 5]).sketch
    const r = trimAt(s, h.id, [15, 0])!
    const piece = r.curves[r.curves.length - 1]
    expect(r.constraints.some((k) => k.type === 'horizontal' && k.refs[0] === piece.id)).toBe(true)
    expect(solver.solve(r).state).toBe('ok')
  })

  it('shortens a line that sticks out past a crossing', () => {
    let s = emptySketch()
    const h = addLine(s, [0, 0], [30, 0])
    s = h.sketch
    s = addLine(s, [10, -5], [10, 5]).sketch
    s = addConstraint(s, 'distance', [h.id], 30).sketch
    const r = trimAt(s, h.id, [3, 0])!
    const l = r.curves.find((c) => c.id === h.id)!
    expect(l.kind === 'line' && pos(r, l.p1)).toEqual([10, 0])
    expect(r.constraints.some((k) => k.type === 'distance')).toBe(false) // the old length no longer applies
    expect(r.points.some((p) => p.x === 0 && p.y === 0)).toBe(false) // the loose end is gone
  })

  it('a line that crosses nothing is deleted', () => {
    const l = addLine(emptySketch(), [0, 0], [5, 5])
    expect(trimAt(l.sketch, l.id, [2, 2])!.curves).toHaveLength(0)
  })

  it('a circle cut by a rectangle edge becomes an arc', () => {
    const r = addRect(emptySketch(), [0, 0], [20, 20])
    const c = addCircle(r.sketch, [20, 10], 5)
    const t = trimAt(c.sketch, c.id, [25, 10])! // the half outside the rectangle
    const arc = t.curves.find((k) => k.id === c.id)!
    expect(arc.kind).toBe('arc')
    const res = solver.solve(t)
    expect(['ok', 'redundant']).toContain(res.state)
    // the arc's ends sit on the right edge x = 20
    if (arc.kind === 'arc') {
      expect(pos(res.sketch, arc.start)[0]).toBeCloseTo(20, 5)
      expect(pos(res.sketch, arc.end)[0]).toBeCloseTo(20, 5)
    }
  })
})

describe('fillet', () => {
  it('rounds a rectangle corner and keeps it fully constrained', () => {
    const r = addRect(emptySketch(), [0, 0], [40, 30])
    let s = addConstraint(r.sketch, 'distance', [r.lines[0]], 40).sketch
    s = addConstraint(s, 'distance', [r.lines[1]], 30).sketch
    s = addConstraint(s, 'coincident', [r.points[0], ORIGIN]).sketch
    expect(solver.solve(s).dof).toBe(0)
    const f = filletCorner(s, r.points[2], 5)!
    const res = solver.solve(f.sketch)
    expect(res.state).toBe('ok')
    expect(res.dof).toBe(0)
    const prof = buildProfile(res.sketch, 256)
    expect(prof.loops).toHaveLength(1)
    // area = rectangle − (r² − πr²/4)
    expect(signedArea(prof.loops[0])).toBeCloseTo(1200 - (25 - (Math.PI * 25) / 4), 1)
    // the corner stays where it was, as a helper point
    expect(pos(res.sketch, r.points[2])).toEqual([40, 30])
  })

  it('refuses corners that are not two lines, or radii that do not fit', () => {
    const r = addRect(emptySketch(), [0, 0], [10, 10])
    expect(filletCorner(r.sketch, r.points[0], 20)).toBeNull()
    const l = addLine(r.sketch, r.points[0], [-5, -5])
    expect(filletCorner(l.sketch, r.points[0], 1)).toBeNull()
  })
})
