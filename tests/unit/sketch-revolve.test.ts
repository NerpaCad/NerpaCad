import { describe, expect, it } from 'vitest'
import { getEngine, prim } from './helpers'
import { addLine, addRect } from '@/core/sketch/ops'
import { buildProfile } from '@/core/sketch/profile'
import { revolveSetup } from '@/core/sketch/revolve'
import { AXIS_X, AXIS_Y, emptySketch } from '@/core/sketch/types'
import { emptyDoc } from '@/core/doc/model'
import { parseDoc, serializeDoc } from '@/core/io/formats'

const n96 = (r: number) => 0.5 * 96 * r * r * Math.sin((2 * Math.PI) / 96) // area of the 96-gon

describe('revolved sketches', () => {
  it('a rectangle next to the Y axis becomes a cylinder standing along Y', async () => {
    const s = addRect(emptySketch(), [0, 0], [10, 20]).sketch
    const r = (await getEngine()).evaluate(prim('sketch', { params: { sketch: s, depth: 10, op: 'revolve', axis: AXIS_Y } }))
    expect(r.volume).toBeCloseTo(n96(10) * 20, 0)
    expect(r.box.min.map((v) => Math.round(v * 1e3) / 1e3)).toEqual([-10, 0, -10])
    expect(r.box.max.map((v) => Math.round(v * 1e3) / 1e3)).toEqual([10, 20, 10])
  })

  it('a quarter turn rises out of the sketch plane (+Z)', async () => {
    const s = addRect(emptySketch(), [5, 0], [10, 20]).sketch
    const r = (await getEngine()).evaluate(
      prim('sketch', { params: { sketch: s, depth: 10, op: 'revolve', axis: AXIS_Y, angle: 90 } })
    )
    expect(r.box.min[2]).toBeCloseTo(0, 6)
    expect(r.box.max[2]).toBeCloseTo(10, 3)
    expect(r.box.min[0]).toBeCloseTo(0, 3)
    expect(r.volume).toBeCloseTo((Math.PI / 4) * (100 - 25) * 20, -1)
  })

  it('a profile on the negative side and around a sketch line', async () => {
    let s = addRect(emptySketch(), [-30, 5], [-20, 15]).sketch // left of a vertical line at x = -30
    const axis = addLine(s, [-30, 0], [-30, 30], true)
    s = axis.sketch
    const r = (await getEngine()).evaluate(prim('sketch', { params: { sketch: s, depth: 10, op: 'revolve', axis: axis.id } }))
    expect(r.volume).toBeCloseTo(n96(10) * 10, 0)
    expect(r.box.min[0]).toBeCloseTo(-40, 3)
    expect(r.box.max[0]).toBeCloseTo(-20, 3)
  })

  it('around the X axis: a ring when the profile does not touch the axis', async () => {
    const s = addRect(emptySketch(), [0, 10], [4, 12]).sketch
    const r = (await getEngine()).evaluate(prim('sketch', { params: { sketch: s, depth: 10, op: 'revolve', axis: AXIS_X } }))
    expect(r.volume).toBeCloseTo((n96(12) - n96(10)) * 4, 0)
    expect(r.box.max[1]).toBeCloseTo(12, 3)
  })

  it('reports a profile that crosses the axis', () => {
    const s = addRect(emptySketch(), [-5, 0], [10, 10]).sketch
    const rv = revolveSetup(s, buildProfile(s).loops, AXIS_Y)!
    expect(rv.crosses).toBe(true)
    const ok = addRect(emptySketch(), [0, 0], [10, 10]).sketch
    expect(revolveSetup(ok, buildProfile(ok).loops, AXIS_Y)!.crosses).toBe(false)
  })

  it('round-trips through the file format', () => {
    const s = addRect(emptySketch(), [0, 0], [10, 20]).sketch
    const d = { ...emptyDoc(), nodes: [prim('sketch', { params: { sketch: s, depth: 10, op: 'revolve', axis: AXIS_Y, angle: 180 } })] }
    const n = parseDoc(serializeDoc(d)).nodes[0]
    expect(n.kind === 'prim' && [n.params.op, n.params.axis, n.params.angle]).toEqual(['revolve', AXIS_Y, 180])
    const bad = { ...emptyDoc(), nodes: [prim('sketch', { params: { sketch: s, depth: 10, op: 'revolve', angle: 400 } })] }
    expect(() => parseDoc(serializeDoc(bad))).toThrow()
  })
})
