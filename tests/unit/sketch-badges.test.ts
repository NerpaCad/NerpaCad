import { describe, expect, it } from 'vitest'
import { addConstraint, addLine, addPolygon, addRect } from '@/core/sketch/ops'
import { filletCorner } from '@/core/sketch/modify'
import { BADGE, badgeGroups, placeBadges } from '@/core/sketch/badges'
import { emptySketch } from '@/core/sketch/types'
import { validateSketch } from '@/core/sketch/validate'

describe('constraint badges of a busy sketch', () => {
  it('a regular polygon shows one badge for all its constraints', () => {
    const p = addPolygon(emptySketch(), [0, 0], [30, 0], 40)
    const g = badgeGroups(p.sketch)
    expect(g.polygons).toHaveLength(1)
    expect(g.polygons[0].circle).toBe(p.circle)
    // 40 corners on the circle + 39 equal sides
    expect(g.polygons[0].ids).toHaveLength(79)
    expect(g.equal).toHaveLength(0)
    expect(p.sketch.constraints.every((c) => g.grouped.has(c.id))).toBe(true)
  })

  it('a polygon whose side lost its equal constraint is not shown as regular', () => {
    const p = addPolygon(emptySketch(), [0, 0], [30, 0], 6)
    const eq = p.sketch.constraints.filter((c) => c.type === 'equal')
    const broken = { ...p.sketch, constraints: p.sketch.constraints.filter((c) => c.id !== eq[2].id) }
    const g = badgeGroups(broken)
    expect(g.polygons).toHaveLength(0)
    // the equal sides left show one "=" each, not a pile on the first side
    expect(g.equal.length).toBeGreaterThan(0)
    expect(new Set(g.equal.map((m) => m.entity)).size).toBe(g.equal.length)
  })

  it('equal lines: one badge per line, numbered by group when there are several groups', () => {
    let s = emptySketch()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const l = addLine(s, [i * 10, 0], [i * 10 + 5, 5])
      s = l.sketch
      ids.push(l.id)
    }
    s = addConstraint(s, 'equal', [ids[0], ids[1]]).sketch
    s = addConstraint(s, 'equal', [ids[0], ids[2]]).sketch
    let g = badgeGroups(s)
    expect(g.equal.map((m) => m.entity).sort()).toEqual([ids[0], ids[1], ids[2]].sort())
    expect(g.equal.every((m) => m.group === 0)).toBe(true)
    s = addConstraint(s, 'equal', [ids[3], ids[4]]).sketch
    g = badgeGroups(s)
    expect(g.equal).toHaveLength(5)
    const groupOf = (id: string) => g.equal.find((m) => m.entity === id)!.group
    expect(groupOf(ids[1])).toBe(groupOf(ids[2]))
    expect(groupOf(ids[3])).toBe(groupOf(ids[4]))
    expect(groupOf(ids[3])).not.toBe(groupOf(ids[0]))
    expect(groupOf(ids[3])).toBeGreaterThan(0)
  })

  it('a fillet’s tangents sit where the arc meets each line', () => {
    const r = addRect(emptySketch(), [0, 0], [40, 30])
    const f = filletCorner(r.sketch, r.points[2], 8)!
    const g = badgeGroups(f.sketch)
    const tangents = f.sketch.constraints.filter((c) => c.type === 'tangent')
    expect(tangents).toHaveLength(2)
    const at = tangents.map((c) => g.tangentAt.get(c.id))
    expect(at.every(Boolean)).toBe(true)
    expect(at[0]).not.toBe(at[1])
  })

  it('placed badges never cover each other or what is already there', () => {
    const want = Array.from({ length: 30 }, (_, i) => ({ x: 100 + (i % 3), y: 100, dx: 1, dy: 0 }))
    const taken = [{ x: 100, y: 100, hw: 25, hh: 10 }]
    const spots = placeBadges(want, taken)
    const boxes = [...spots.map((p) => ({ ...p, hw: BADGE / 2, hh: BADGE / 2 })), ...taken]
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const overlap = Math.abs(a.x - b.x) < a.hw + b.hw && Math.abs(a.y - b.y) < a.hh + b.hh
        expect(overlap, `${i} / ${j}`).toBe(false)
      }
    // a badge with room keeps its spot
    expect(placeBadges([{ x: 5, y: 5 }], [])).toEqual([{ x: 5, y: 5 }])
  })

  it('a moved dimension keeps its place in the file; junk places are dropped', () => {
    const l = addLine(emptySketch(), [0, 0], [10, 0])
    const d = addConstraint(l.sketch, 'distance', [l.id], 10)
    const s = { ...d.sketch, constraints: d.sketch.constraints.map((c) => ({ ...c, place: [6.5, 0.3] })) }
    expect(validateSketch(JSON.parse(JSON.stringify(s)))!.constraints[0].place).toEqual([6.5, 0.3])
    const bad = { ...s, constraints: s.constraints.map((c) => ({ ...c, place: ['x', 1] })) }
    const back = validateSketch(JSON.parse(JSON.stringify(bad)))!
    expect(back).not.toBeNull()
    expect(back.constraints[0].place).toBeUndefined()
  })
})
