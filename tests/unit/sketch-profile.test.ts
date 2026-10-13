import { describe, expect, it } from 'vitest'
import { addArc, addCircle, addLine, addPolyline, addRect } from '@/core/sketch/ops'
import { buildProfile, signedArea } from '@/core/sketch/profile'
import { emptySketch } from '@/core/sketch/types'

const area = (loops: [number, number][][]) => loops.reduce((a, l) => a + Math.abs(signedArea(l)), 0)

describe('sketch profile', () => {
  it('a rectangle is one counter-clockwise loop', () => {
    const r = addRect(emptySketch(), [0, 0], [30, 20])
    const p = buildProfile(r.sketch)
    expect(p.loops).toHaveLength(1)
    expect(signedArea(p.loops[0])).toBeCloseTo(600)
    expect(p.open).toEqual([])
    expect(p.crossing).toEqual([])
  })

  it('a clockwise-drawn outline still comes out counter-clockwise', () => {
    const r = addPolyline(emptySketch(), [[0, 0], [0, 10], [10, 10], [10, 0]], true)
    const p = buildProfile(r.sketch)
    expect(p.loops).toHaveLength(1)
    expect(signedArea(p.loops[0])).toBeCloseTo(100)
  })

  it('a circle inside a rectangle: two loops (even-odd makes the hole)', () => {
    const r = addRect(emptySketch(), [0, 0], [40, 30])
    const c = addCircle(r.sketch, [20, 15], 5)
    const p = buildProfile(c.sketch, 128)
    expect(p.loops).toHaveLength(2)
    expect(area(p.loops) - Math.PI * 25).toBeCloseTo(1200, 0) // rectangle and circle listed separately
  })

  it('a rectangle and a triangle sharing a corner give two regions', () => {
    const r = addRect(emptySketch(), [0, 0], [10, 10])
    const t = addPolyline(r.sketch, [r.points[2], [20, 10], [15, 20]], true)
    const p = buildProfile(t.sketch)
    expect(p.loops).toHaveLength(2)
    const areas = p.loops.map((l) => signedArea(l)).sort((a, b) => a - b)
    expect(areas[0]).toBeCloseTo(50)
    expect(areas[1]).toBeCloseTo(100)
  })

  it('a line splitting a rectangle gives two neighbouring regions', () => {
    const r = addRect(emptySketch(), [0, 0], [20, 10])
    // split corner-to-corner along the diagonal
    const d = addLine(r.sketch, r.points[0], r.points[2])
    const p = buildProfile(d.sketch)
    expect(p.loops).toHaveLength(2)
    expect(p.loops.every((l) => Math.abs(signedArea(l) - 100) < 1e-6)).toBe(true)
  })

  it('loose lines are reported as open and ignored', () => {
    const r = addRect(emptySketch(), [0, 0], [10, 10])
    const tail = addLine(r.sketch, r.points[1], [20, -5])
    const p = buildProfile(tail.sketch)
    expect(p.loops).toHaveLength(1)
    expect(p.open).toEqual([tail.id])
  })

  it('a D shape from a line and an arc', () => {
    let s = emptySketch()
    const a = addArc(s, [0, 0], [0, -10], [0, 10]) // right half circle, CCW from bottom to top
    s = a.sketch
    s = addLine(s, a.end, a.start).sketch
    const p = buildProfile(s, 256)
    expect(p.loops).toHaveLength(1)
    expect(signedArea(p.loops[0])).toBeCloseTo((Math.PI * 100) / 2, 0)
  })

  it('crossing lines without a shared point are reported; construction lines are ignored', () => {
    let s = addRect(emptySketch(), [0, 0], [10, 10]).sketch
    const x = addLine(s, [-5, 5], [15, 5])
    s = x.sketch
    const p = buildProfile(s)
    expect(p.crossing).toContain(x.id)
    const c = addLine(addRect(emptySketch(), [0, 0], [10, 10]).sketch, [-5, 5], [15, 5], true)
    expect(buildProfile(c.sketch).crossing).toEqual([])
  })
})
