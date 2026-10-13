import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addArc, addCircle, addLine, addRect, pos } from '@/core/sketch/ops'
import { applyCommand } from '@/core/sketch/rules'
import { type SketchSolver, createSolver } from '@/core/sketch/solver'
import { AXIS_X, ORIGIN, emptySketch } from '@/core/sketch/types'

let solver: SketchSolver
beforeAll(async () => {
  solver = await createSolver()
})
afterAll(() => solver.dispose())

describe('constraint commands', () => {
  it('are only available for fitting selections', () => {
    const r = addRect(emptySketch(), [0, 0], [30, 20])
    const s = r.sketch
    expect(applyCommand(s, [r.lines[0]], 'perpendicular')).toBeNull()
    expect(applyCommand(s, [r.lines[0], r.lines[1]], 'perpendicular')).not.toBeNull()
    expect(applyCommand(s, [r.points[0], r.points[1]], 'coincident')).toBeNull() // same line
    expect(applyCommand(s, [r.lines[0]], 'tangent')).toBeNull()
    expect(applyCommand(s, [], 'dimension')).toBeNull()
    expect(applyCommand(s, [AXIS_X], 'horizontal')).toBeNull()
  })

  it('smart dimension picks length, diameter, angle and point–line distance', () => {
    let s = emptySketch()
    const l = addLine(s, [0, 0], [30, 40])
    s = l.sketch
    const c = addCircle(s, [60, 0], 7)
    s = c.sketch
    const m = addLine(s, [0, 10], [20, 10])
    s = m.sketch
    const d1 = applyCommand(s, [l.id], 'dimension')!
    expect(d1.sketch.constraints.at(-1)).toMatchObject({ type: 'distance', value: 50 })
    const d2 = applyCommand(s, [c.id], 'dimension')!
    expect(d2.sketch.constraints.at(-1)).toMatchObject({ type: 'diameter', value: 14 })
    const d3 = applyCommand(s, [m.id, l.id], 'dimension')!
    expect(d3.sketch.constraints.at(-1)!.type).toBe('angle')
    const d4 = applyCommand(s, [m.id, c.c], 'dimension')!
    expect(d4.sketch.constraints.at(-1)).toMatchObject({ type: 'distance', refs: [c.c, m.id], value: 10 })
    const d5 = applyCommand(s, [c.c], 'distanceX')!
    expect(d5.sketch.constraints.at(-1)).toMatchObject({ type: 'distanceX', refs: [ORIGIN, c.c], value: 60 })
  })

  it('coincident merges two points into one; point + line becomes point-on-line', () => {
    let s = emptySketch()
    const a = addLine(s, [0, 0], [10, 0])
    s = a.sketch
    const b = addLine(s, [10.4, 0.3], [10, 10])
    s = b.sketch
    const merged = applyCommand(s, [a.p2, b.p1], 'coincident')!
    expect(merged.sketch.points).toHaveLength(3)
    const res = solver.solve(merged.sketch)
    expect(res.state).toBe('ok')
    const on = applyCommand(s, [b.p2, a.id], 'coincident')!
    expect(on.sketch.constraints.at(-1)).toMatchObject({ type: 'pointOn', refs: [b.p2, a.id] })
  })

  it('perpendicular and equal solve as expected; horizontal on a rectangle side is redundant', () => {
    let s = emptySketch()
    const a = addLine(s, [0, 0], [10, 1])
    s = a.sketch
    const b = addLine(s, a.p2, [12, 9])
    s = b.sketch
    s = applyCommand(s, [a.id, b.id], 'perpendicular')!.sketch
    s = applyCommand(s, [a.id, b.id], 'equal')!.sketch
    const res = solver.solve(s)
    expect(res.state).toBe('ok')
    const [p, q, r] = [pos(res.sketch, a.p1), pos(res.sketch, a.p2), pos(res.sketch, b.p2)]
    const u = [q[0] - p[0], q[1] - p[1]]
    const v = [r[0] - q[0], r[1] - q[1]]
    expect(Math.abs(u[0] * v[0] + u[1] * v[1])).toBeLessThan(1e-4)
    expect(Math.hypot(u[0], u[1])).toBeCloseTo(Math.hypot(v[0], v[1]), 4)

    const rect = addRect(emptySketch(), [0, 0], [30, 20])
    const again = applyCommand(rect.sketch, [rect.lines[0]], 'horizontal')!
    expect(solver.solve(again.sketch).state).toBe('redundant')
  })

  it('lock pins points where they are', () => {
    const l = addLine(emptySketch(), [3, 4], [10, 4])
    const r = applyCommand(l.sketch, [l.p1, l.p2], 'lock')!
    expect(r.added).toHaveLength(2)
    const res = solver.solve(r.sketch)
    expect(res.dof).toBe(0)
  })
})

describe('review fixes', () => {
  it('an arc centred on the origin keeps its shape when solved', () => {
    const a = addArc(emptySketch(), ORIGIN, [-10, 1], [-1, -10])
    const res = solver.solve(a.sketch)
    expect(res.state).toBe('ok')
    const arc = res.sketch.curves[0]
    expect(arc.kind === 'arc' && arc.r).toBeCloseTo(Math.hypot(10, 1), 4)
    expect(pos(res.sketch, a.start)).toEqual([-10, 1])
  })

  it('dragging the rim of a circle centred on the origin changes its radius', () => {
    const c = addCircle(emptySketch(), ORIGIN, 5)
    const res = solver.solve(c.sketch, [{ id: c.id, x: 9, y: 0 }])
    const k = res.sketch.curves[0]
    expect(k.kind === 'circle' && k.r).toBeCloseTo(9, 3)
  })

  it('equal with an axis is not offered', () => {
    const l = addLine(emptySketch(), [0, 0], [10, 3])
    expect(applyCommand(l.sketch, [l.id, AXIS_X], 'equal')).toBeNull()
    expect(applyCommand(l.sketch, [l.id, AXIS_X], 'parallel')).not.toBeNull()
  })

  it('the solver reports a failure instead of throwing on clashing ids', () => {
    const l = addLine(emptySketch(), [0, 0], [10, 3])
    const bad = { ...l.sketch, points: [...l.sketch.points, { id: 'O#x', x: 1, y: 1 }] }
    expect(solver.solve(bad).state).toBe('failed')
  })
})
