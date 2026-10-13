import { describe, expect, it } from 'vitest'
import { arcAngles, circleThrough, curveDistance, inSweep, tessellate } from '@/core/sketch/geometry'
import { addArc, addCircle, addLine } from '@/core/sketch/ops'
import { AXIS_X, AXIS_Y, emptySketch } from '@/core/sketch/types'

describe('sketch geometry', () => {
  it('circle through three points', () => {
    const g = circleThrough([10, 0], [0, 10], [-10, 0])!
    expect(g.c[0]).toBeCloseTo(0)
    expect(g.c[1]).toBeCloseTo(0)
    expect(g.r).toBeCloseTo(10)
    expect(circleThrough([0, 0], [1, 1], [2, 2])).toBeNull()
  })

  it('arc sweep tests wrap around ±180°', () => {
    expect(inSweep(Math.PI, Math.PI * 0.9, Math.PI * 1.1)).toBe(true)
    expect(inSweep(-Math.PI * 0.95, Math.PI * 0.9, Math.PI * 1.1)).toBe(true)
    expect(inSweep(0, Math.PI * 0.9, Math.PI * 1.1)).toBe(false)
  })

  it('distances to lines, circles, arcs and axes', () => {
    let s = emptySketch()
    const l = addLine(s, [0, 0], [10, 0])
    s = l.sketch
    const c = addCircle(s, [0, 20], 5)
    s = c.sketch
    const a = addArc(s, [30, 0], [35, 0], [30, 5]) // quarter arc, first quadrant
    s = a.sketch
    expect(curveDistance(s, l.id, [5, 3])!.d).toBeCloseTo(3)
    expect(curveDistance(s, l.id, [13, 4])!.d).toBeCloseTo(5) // beyond the end
    expect(curveDistance(s, c.id, [0, 28])!.d).toBeCloseTo(3)
    expect(curveDistance(s, a.id, [34, 4])!.d).toBeCloseTo(Math.hypot(4, 4) - 5)
    // below the arc (outside its sweep): distance to the nearest end
    expect(curveDistance(s, a.id, [35, -3])!.d).toBeCloseTo(3)
    expect(curveDistance(s, AXIS_X, [4, -7])!.d).toBeCloseTo(7)
    expect(curveDistance(s, AXIS_Y, [4, -7])!.q).toEqual([0, -7])
  })

  it('arcs are counter-clockwise from start to end', () => {
    const a = addArc(emptySketch(), [0, 0], [0, 10], [10, 0]) // from 90° round to 360°
    const g = arcAngles(a.sketch, a.sketch.curves[0] as never)!
    expect(((g.ea - g.sa) * 180) / Math.PI).toBeCloseTo(270)
    const pts = tessellate(a.sketch, a.sketch.curves[0])
    expect(pts[0][0]).toBeCloseTo(0)
    expect(pts[pts.length - 1][0]).toBeCloseTo(10)
    // passes through (-10, 0)
    expect(pts.some(([x, y]) => Math.abs(x + 10) < 0.2 && Math.abs(y) < 0.5)).toBe(true)
  })
})
