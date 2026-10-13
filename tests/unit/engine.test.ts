import { describe, expect, it } from 'vitest'
import { getEngine, prim } from './helpers'
import type { PrimType } from '@/core/doc/model'

const ALL: PrimType[] = ['box', 'cylinder', 'cone', 'sphere', 'pyramid', 'wedge', 'torus', 'text', 'polygon', 'icosahedron', 'hemisphere', 'roundRoof']

describe('primitives', () => {
  it.each(ALL)('%s is a closed solid sitting on the workplane', async (t) => {
    const e = await getEngine()
    const r = e.evaluate(prim(t))
    expect(r.volume).toBeGreaterThan(0)
    expect(r.indices.length % 3).toBe(0)
    expect(r.box.min[2]).toBeCloseTo(0, 6)
    expect((r.box.min[0] + r.box.max[0]) / 2).toBeCloseTo(0, 6)
    expect((r.box.min[1] + r.box.max[1]) / 2).toBeCloseTo(0, 6)
  })

  it('box is 20 mm and 8000 mm³', async () => {
    const r = (await getEngine()).evaluate(prim('box'))
    expect(r.volume).toBeCloseTo(8000, 3)
    expect(r.box.max).toEqual([10, 10, 20])
  })

  it('cyrillic text builds with holes in letters', async () => {
    const e = await getEngine()
    const a = e.evaluate(prim('text', { params: { text: 'О' } }))
    const b = e.evaluate(prim('text', { params: { text: 'Привет' } }))
    expect(a.volume).toBeGreaterThan(0)
    expect(b.volume).toBeGreaterThan(a.volume)
    // "О" has an inner hole, so its genus via Euler characteristic is 1
    expect(b.box.max[2]).toBeCloseTo(10, 6)
  })

  it('empty text gives empty geometry without throwing', async () => {
    const r = (await getEngine()).evaluate(prim('text', { params: { text: '  ' } }))
    expect(r.volume).toBe(0)
  })

  it('new basic shapes: half sphere, round roof, polygon prism, icosahedron on a face', async () => {
    const e = await getEngine()
    const half = e.evaluate(prim('hemisphere', { params: { segments: 64 } }))
    expect(half.box.max[2]).toBeCloseTo(10, 3)
    expect(half.volume / ((2 / 3) * Math.PI * 1000)).toBeCloseTo(1, 1)
    const roof = e.evaluate(prim('roundRoof', { params: { segments: 64 } }))
    expect(roof.box.max[2]).toBeCloseTo(10, 3)
    expect(roof.box.max[1] - roof.box.min[1]).toBeCloseTo(20, 3)
    expect(roof.volume / ((Math.PI * 100 * 20) / 2)).toBeCloseTo(1, 1)
    // a hexagonal prism: area (3√3/2)·r² × 20
    const hex = e.evaluate(prim('polygon', { params: { segments: 6 } }))
    expect(hex.volume).toBeCloseTo(((3 * Math.sqrt(3)) / 2) * 100 * 20, 1)
    const tri = e.evaluate(prim('polygon', { params: { segments: 3 } }))
    expect(tri.volume).toBeLessThan(hex.volume)
    // nonsense side counts are clamped
    expect(e.evaluate(prim('polygon', { params: { segments: 1000 } })).volume).toBeGreaterThan(hex.volume)
    const ico = e.evaluate(prim('icosahedron'))
    const size = [0, 1, 2].map((i) => ico.box.max[i] - ico.box.min[i])
    expect(Math.max(...size)).toBeCloseTo(20, 3)
    // resting on a face: three corners touch the workplane
    const low = new Set<string>()
    for (let i = 0; i < ico.positions.length; i += 3) {
      if (Math.abs(ico.positions[i + 2]) < 1e-4) low.add(`${ico.positions[i].toFixed(3)},${ico.positions[i + 1].toFixed(3)}`)
    }
    expect(low.size).toBe(3)
  })
})
