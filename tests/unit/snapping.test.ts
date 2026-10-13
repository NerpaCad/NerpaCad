import { describe, expect, it } from 'vitest'
import { snapToGuides } from '@/core/doc/snapping'

const box = (x0: number, y0: number, x1: number, y1: number) => ({ min: [x0, y0] as [number, number], max: [x1, y1] as [number, number] })

describe('smart guides', () => {
  it('snaps a left edge to a nearby left edge and draws a guide', () => {
    const r = snapToGuides(box(0, 0, 10, 10), [box(20.6, 30, 50, 40)], [20, 0], 1)
    expect(r.delta[0]).toBeCloseTo(20.6, 9)
    expect(r.snapped).toEqual([true, false])
    expect(r.guides[0]).toMatchObject({ axis: 0, value: 20.6, from: 0, to: 40 })
  })

  it('snaps centers too, and picks the closest candidate', () => {
    // moving center at 5+12=17, other center at 17.4; right edges 22 vs 25 -> center wins
    const r = snapToGuides(box(0, 0, 10, 10), [box(9.8, 50, 25, 60)], [12, 0], 2)
    expect(r.delta[0]).toBeCloseTo(12.4, 9)
  })

  it('falls back to grid snapping when nothing is close', () => {
    const r = snapToGuides(box(0, 0, 10, 10), [box(100, 100, 110, 110)], [3.4, 7.6], 1, Math.round)
    expect(r.delta).toEqual([3, 8])
    expect(r.guides).toEqual([])
  })

  it('works independently per axis', () => {
    const r = snapToGuides(box(0, 0, 10, 10), [box(30, 20.5, 40, 30)], [5.2, 10], 1, Math.round)
    expect(r.delta[0]).toBe(5)
    expect(r.delta[1]).toBeCloseTo(10.5, 9)
    expect(r.snapped).toEqual([false, true])
  })
})
