/** Size labels never cover each other: later ones move away along their own direction. */
import { describe, expect, it } from 'vitest'
import { type DimLabel, dimSize, separateDims } from '@/view/dims'

const label = (id: string, x: number, y: number, push: [number, number], value = 20): DimLabel => ({ id, kind: 'size', axis: 0, value, x, y, push })
const overlap = (a: DimLabel, b: DimLabel) => {
  const sa = dimSize(a)
  const sb = dimSize(b)
  return Math.abs(a.x - b.x) < (sa.w + sb.w) / 2 && Math.abs(a.y - b.y) < (sa.h + sb.h) / 2
}

describe('size labels', () => {
  it('three labels of a small far shape all at one spot come apart, each along its own way', () => {
    const out = separateDims([label('size0', 100, 100, [-1, 0.3]), label('size1', 104, 102, [1, 0.3]), label('size2', 98, 96, [1, 0])])
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(overlap(out[i], out[j]), `${i} ${j}`).toBe(false)
    // the first stays where it was; the others moved along their push direction
    expect(out[0]).toMatchObject({ x: 100, y: 100 })
    expect(out[1].x).toBeGreaterThan(104)
    expect(out[2].y).toBe(96)
  })

  it('labels that do not touch stay put; a longer number makes a wider label', () => {
    const list = [label('a', 0, 0, [1, 0]), label('b', 200, 0, [1, 0])]
    expect(separateDims(list)).toEqual(list)
    expect(dimSize(label('a', 0, 0, [1, 0], 123.45)).w).toBeGreaterThan(dimSize(label('a', 0, 0, [1, 0], 5)).w)
  })

  it('a label on a handle moves off it; the pins of static shapes stay put', () => {
    const handles: [number, number][] = [[100, 100], [104, 100]]
    const [d] = separateDims([label('size0', 100, 100, [0, 1])], 4, handles)
    expect(Math.abs(d.y - 100)).toBeGreaterThanOrEqual(dimSize(d).h / 2 + 6)
    expect(d.x).toBe(100)
    const pin: DimLabel = { id: 'pin-a', kind: 'pin', axis: 2, value: 0, x: 100, y: 100 }
    const out = separateDims([pin, label('size0', 102, 100, [1, 0])], 4, handles)
    expect(out[0]).toMatchObject({ x: 100, y: 100 })
    expect(overlap(out[0], out[1])).toBe(false)
  })
})
