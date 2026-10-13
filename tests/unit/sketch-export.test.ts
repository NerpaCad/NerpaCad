import { describe, expect, it } from 'vitest'
import { toDxf, toSvg } from '@/core/sketch/export'
import { addArc, addCircle, addLine, addRect } from '@/core/sketch/ops'
import { emptySketch } from '@/core/sketch/types'

function sample() {
  let s = addRect(emptySketch(), [0, 0], [40, 20]).sketch
  s = addCircle(s, [10, 10], 4).sketch
  s = addArc(s, [30, 10], [34, 10], [30, 14]).sketch
  s = addLine(s, [0, 0], [40, 20], true).sketch // construction: not exported
  return s
}

describe('sketch export', () => {
  it('DXF has one entity per curve, construction left out', () => {
    const d = toDxf(sample())
    const count = (name: string) => d.split('\n').filter((l, i, a) => l === name && a[i - 1] === '0').length
    expect(count('LINE')).toBe(4)
    expect(count('CIRCLE')).toBe(1)
    expect(count('ARC')).toBe(1)
    expect(d).toContain('AC1009')
    expect(d.trim().endsWith('EOF')).toBe(true)
    // the arc goes 0° → 90°
    const lines = d.split('\n')
    const arc = lines.indexOf('ARC')
    const at = (code: string) => lines[lines.indexOf(code, arc) + 1]
    expect(at('50')).toBe('0')
    expect(at('51')).toBe('90')
  })

  it('SVG is sized in millimetres with Y flipped', () => {
    const svg = toSvg(sample())
    expect(svg).toContain('width="44mm"')
    expect(svg).toContain('height="24mm"')
    expect((svg.match(/<line /g) ?? []).length).toBe(4)
    expect(svg).toContain('<circle cx="10" cy="-10" r="4"/>')
    expect(svg).toContain('A 4 4 0 0 0 30 -14')
  })
})
