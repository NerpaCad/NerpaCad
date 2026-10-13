import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addRect } from '@/core/sketch/ops'
import { filletCorner } from '@/core/sketch/modify'
import { type SketchSolver, createSolver } from '@/core/sketch/solver'
import { emptySketch, pointPos } from '@/core/sketch/types'
import { releasedBy } from '@/core/sketch/session'

let solver: SketchSolver
beforeAll(async () => {
  solver = await createSolver()
})
afterAll(() => solver.dispose())

const radiusOf = (s: ReturnType<typeof emptySketch>, arc: string) => {
  const a = s.curves.find((c) => c.id === arc)!
  if (a.kind !== 'arc') throw new Error('not an arc')
  const c = pointPos(s, a.c)!
  const p = pointPos(s, a.start)!
  return Math.hypot(p[0] - c[0], p[1] - c[1])
}

describe('dragging a fillet', () => {
  it('its radius dimension lets go when the centre, an end or the arc is pulled', () => {
    const r = addRect(emptySketch(), [0, 0], [40, 30])
    const f = filletCorner(r.sketch, r.points[2], 5)!
    const arc = f.sketch.curves.find((c) => c.id === f.arc)!
    if (arc.kind !== 'arc') throw new Error()
    const dim = f.sketch.constraints.find((k) => k.type === 'radius')!
    for (const id of [arc.c, arc.start, arc.end, arc.id]) expect([...releasedBy(f.sketch, [id])]).toEqual([dim.id])
    expect(releasedBy(f.sketch, [r.points[0]]).size).toBe(0)
  })

  it('pulling the centre toward the inside of the corner makes the fillet bigger; the rest stays tangent', () => {
    const r = addRect(emptySketch(), [0, 0], [40, 30])
    const f = filletCorner(r.sketch, r.points[2], 5)!
    const arc = f.sketch.curves.find((c) => c.id === f.arc)!
    if (arc.kind !== 'arc') throw new Error()
    const rel = releasedBy(f.sketch, [arc.c])
    const free = { ...f.sketch, constraints: f.sketch.constraints.filter((k) => !rel.has(k.id)) }
    const c = pointPos(f.sketch, arc.c)!
    const res = solver.solve(free, [{ id: arc.c, x: c[0] - 5, y: c[1] - 5 }])
    expect(['ok', 'redundant']).toContain(res.state)
    expect(radiusOf(res.sketch, f.arc)).toBeGreaterThan(8)
    // with the dimension kept, the same pull changes nothing
    const locked = solver.solve(f.sketch, [{ id: arc.c, x: c[0] - 5, y: c[1] - 5 }])
    expect(radiusOf(locked.sketch, f.arc)).toBeCloseTo(5, 3)
  })
})
