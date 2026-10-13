import { describe, expect, it } from 'vitest'
import { boreOutline, clampGear, GEAR_DEFAULTS, gearOutline, outerDiameter, pitchDiameter } from '@/core/doc/gear'
import { createShape } from '@/core/doc/shapes'
import { emptyDoc } from '@/core/doc/model'
import { parseDoc, serializeDoc } from '@/core/io/formats'
import { getEngine } from './helpers'

const radii = (pts: [number, number][]) => pts.map(([x, y]) => Math.hypot(x, y))

describe('gear outline', () => {
  it('has the standard diameters and one tip per tooth', () => {
    const g = { teeth: 20, module: 2, thickness: 5, bore: 0 }
    expect(pitchDiameter(g)).toBe(40)
    expect(outerDiameter(g)).toBe(44)
    const r = radii(gearOutline(g))
    expect(Math.max(...r)).toBeCloseTo(22, 6)
    expect(Math.min(...r)).toBeCloseTo(20 - 2.5, 6)
    // count the tips: points on the outer circle, grouped by tooth
    const tips = gearOutline(g, 8).filter(([x, y]) => Math.hypot(x, y) > 21.99)
    const angles = new Set(tips.map(([x, y]) => Math.round(((Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI)) / ((2 * Math.PI) / 20)) % 20))
    expect(angles.size).toBe(20)
  })

  it('the tooth is as thick as the gap on the pitch circle', () => {
    const g = { teeth: 24, module: 1.5, thickness: 3, bore: 0 }
    const pts = gearOutline(g, 40)
    const rp = pitchDiameter(g) / 2
    // the flank points nearest to the pitch circle on both sides of tooth 0
    const near = pts.filter(([x, y]) => Math.abs(Math.hypot(x, y) - rp) < 0.05 && Math.abs(Math.atan2(y, x)) < Math.PI / 24)
    const a = near.map(([x, y]) => Math.atan2(y, x))
    const width = (Math.max(...a) - Math.min(...a)) * rp
    expect(width).toBeCloseTo((Math.PI * g.module) / 2, 1)
  })

  it('keeps the numbers sensible', () => {
    expect(clampGear({ teeth: 3.6, module: -1, thickness: 0, bore: 1000 })).toEqual({
      teeth: 6,
      module: 0.3,
      thickness: 0.5,
      bore: expect.any(Number)
    })
    const c = clampGear({ teeth: 10, module: 1, thickness: 5, bore: 1000 })
    expect(c.bore).toBeLessThan(10 - 2.5)
    expect(boreOutline({ ...GEAR_DEFAULTS, bore: 6 }).every(([x, y]) => Math.abs(Math.hypot(x, y) - 3) < 1e-9)).toBe(true)
  })
})

describe('gear solid', () => {
  it('is a closed solid of the right size with a hole, and survives a file round trip', async () => {
    const e = await getEngine()
    const n = createShape('gear', 'g', [0, 0, 0])
    const r = e.evaluate(n)
    expect(r.error).toBeUndefined()
    const b = r.box!
    expect(b.max[0] - b.min[0]).toBeCloseTo(outerDiameter(GEAR_DEFAULTS), 0)
    expect(b.max[2] - b.min[2]).toBeCloseTo(GEAR_DEFAULTS.thickness, 3)
    const noHole = e.evaluate({ ...n, id: 'x', params: { gear: { ...GEAR_DEFAULTS, bore: 0 } } })
    const holeArea = (Math.PI * (GEAR_DEFAULTS.bore / 2) ** 2) * GEAR_DEFAULTS.thickness
    expect(noHole.volume - r.volume).toBeCloseTo(holeArea, -1)
    const back = parseDoc(serializeDoc({ ...emptyDoc(), nodes: [{ ...n, material: 'glow' }] }))
    const bn = back.nodes[0]
    expect(bn.kind === 'prim' && bn.params.gear).toEqual(GEAR_DEFAULTS)
    expect(bn.material).toBe('glow')
  })
})
