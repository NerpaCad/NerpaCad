import { describe, expect, it } from 'vitest'
import { getEngine, prim } from './helpers'
import { addLine, addSpline, mergePoints } from '@/core/sketch/ops'
import { catmullRom, curveDistance, splinePoints } from '@/core/sketch/geometry'
import { buildProfile, signedArea } from '@/core/sketch/profile'
import { toDxf, toSvg } from '@/core/sketch/export'
import { validateSketch } from '@/core/sketch/validate'
import { applyCommand } from '@/core/sketch/rules'
import { trimAt } from '@/core/sketch/modify'
import { emptySketch } from '@/core/sketch/types'

/** An arch: a spline from (0,0) up over (20,15) down to (40,0), closed by a straight line. */
function arch() {
  const s = addSpline(emptySketch(), [[0, 0], [10, 12], [20, 15], [30, 12], [40, 0]], false)!
  const l = addLine(s.sketch, s.pts[4], s.pts[0])
  return { sketch: l.sketch, spline: s.id, pts: s.pts }
}

describe('splines', () => {
  it('pass through every point, and a closed one comes back to the start', () => {
    const P: [number, number][] = [[0, 0], [10, 5], [20, -3], [30, 8]]
    const open = catmullRom(P, false, 10)
    for (const p of P) expect(open.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9)).toBe(true)
    expect(open[0]).toEqual(P[0])
    expect(open[open.length - 1]).toEqual(P[3])
    const closed = catmullRom(P, true, 10)
    expect(closed[closed.length - 1]).toEqual(P[0])
    expect(closed.length).toBe(4 * 10 + 1)
  })

  it('close a region with a line and extrude it', async () => {
    const { sketch } = arch()
    const prof = buildProfile(sketch)
    expect(prof.open).toEqual([])
    expect(prof.loops).toHaveLength(1)
    // a bit less than the 40 × 15 box, more than the triangle-ish polygon through the points
    const area = signedArea(prof.loops[0])
    expect(area).toBeGreaterThan(390) // the polygon through the points has 390
    expect(area).toBeLessThan(600)
    const e = await getEngine()
    const r = e.evaluate(prim('sketch', { params: { sketch, depth: 5, extrude: 'up' } }))
    expect(r.volume).toBeCloseTo(area * 5, -1)
  })

  it('a closed spline is a region by itself', () => {
    const s = addSpline(emptySketch(), [[0, 0], [20, 0], [20, 20], [0, 20]], true)!
    const prof = buildProfile(s.sketch)
    expect(prof.loops).toHaveLength(1)
    expect(signedArea(prof.loops[0])).toBeGreaterThan(300)
  })

  it('merging its ends closes an open spline; the file keeps it', () => {
    const s = addSpline(emptySketch(), [[0, 0], [10, 10], [20, 0], [10, -10]], false)!
    const m = mergePoints(s.sketch, s.pts[0], s.pts[3])
    const c = m.curves[0]
    expect(c.kind === 'spline' && c.closed).toBe(true)
    expect(c.kind === 'spline' && c.pts).toHaveLength(3)
    const back = validateSketch(JSON.parse(JSON.stringify(m)))
    expect(back?.curves[0]).toEqual(c)
    expect(validateSketch({ ...m, curves: [{ id: 'x1', kind: 'spline', pts: ['nope', s.pts[1]] }] })).toBeNull()
  })

  it('export as short lines (DXF) and a polyline (SVG); distance and trim work', () => {
    const { sketch, spline } = arch()
    expect(toDxf(sketch).split('LINE').length - 1).toBeGreaterThan(20)
    expect(toSvg(sketch)).toContain('<polyline')
    const d = curveDistance(sketch, spline, [20, 17])!
    expect(d.d).toBeLessThan(2.5)
    const poly = splinePoints(sketch, sketch.curves.find((c) => c.id === spline) as never)
    expect(poly[0]).toEqual([0, 0])
    // trimming a spline takes the whole curve away
    const t = trimAt(sketch, spline, [20, 15])!
    expect(t.curves.some((c) => c.id === spline)).toBe(false)
  })

  it('shape constraints do not apply to the curve itself, only to its points', () => {
    const { sketch, spline, pts } = arch()
    expect(applyCommand(sketch, [spline], 'horizontal')).toBeNull()
    expect(applyCommand(sketch, [pts[0], pts[4]], 'horizontal')).not.toBeNull()
  })
})
