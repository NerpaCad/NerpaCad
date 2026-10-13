import { describe, expect, it } from 'vitest'
import { getEngine, prim } from './helpers'
import { addCircle, addRect } from '@/core/sketch/ops'
import { emptySketch } from '@/core/sketch/types'
import { parseDoc, serializeDoc, FileFormatError } from '@/core/io/formats'
import { emptyDoc } from '@/core/doc/model'

const rectWithHole = () => {
  const r = addRect(emptySketch(), [0, 0], [40, 30])
  return addCircle(r.sketch, [20, 15], 5).sketch
}

describe('extruded sketches', () => {
  it('volume = area × depth, with the inner circle as a hole', async () => {
    const e = await getEngine()
    const n = prim('sketch', { params: { sketch: rectWithHole(), depth: 10, extrude: 'up' } })
    const r = e.evaluate(n)
    const circle = 64 * 0.5 * 25 * Math.sin((2 * Math.PI) / 64) // 64-gon of radius 5
    expect(r.volume).toBeCloseTo((1200 - circle) * 10, 1)
    // stays in the sketch frame: not re-centered
    expect(r.box.min).toEqual([0, 0, 0])
    expect(r.box.max).toEqual([40, 30, 10])
  })

  it('extrudes down or both ways', async () => {
    const e = await getEngine()
    const s = addRect(emptySketch(), [0, 0], [10, 10]).sketch
    const down = e.evaluate(prim('sketch', { params: { sketch: s, depth: 6, extrude: 'down' } }))
    expect(down.box.min[2]).toBeCloseTo(-6)
    expect(down.box.max[2]).toBeCloseTo(0)
    const both = e.evaluate(prim('sketch', { params: { sketch: s, depth: 6, extrude: 'both' } }))
    expect(both.box.min[2]).toBeCloseTo(-3)
    expect(both.volume).toBeCloseTo(600, 4)
  })

  it('a sketch without closed outlines gives empty geometry', async () => {
    const e = await getEngine()
    const r = e.evaluate(prim('sketch', { params: { sketch: emptySketch(), depth: 5 } }))
    expect(r.volume).toBe(0)
  })
})

describe('.tcad version 2', () => {
  it('round-trips a sketch shape', () => {
    const d = { ...emptyDoc(), nodes: [prim('sketch', { params: { sketch: rectWithHole(), depth: 4, extrude: 'both' } })] }
    const back = parseDoc(serializeDoc(d))
    expect(back.version).toBe(5)
    const n = back.nodes[0]
    expect(n.kind === 'prim' && n.params.sketch?.curves.length).toBe(5)
    expect(n.kind === 'prim' && n.params.extrude).toBe('both')
  })

  it('opens version 1 files', () => {
    const v1 = JSON.stringify({ format: 'cad-system-project', version: 1, app: 'Cad System', doc: { version: 1, nodes: [prim('box')], meshes: {} } })
    const d = parseDoc(v1)
    expect(d.version).toBe(5)
    expect(d.nodes).toHaveLength(1)
  })

  it('rejects broken sketches and future versions', () => {
    const bad = prim('sketch', { params: { sketch: rectWithHole(), depth: 4 } })
    ;(bad.params.sketch!.curves[0] as { p1: string }).p1 = 'nope'
    const f = serializeDoc({ ...emptyDoc(), nodes: [bad] })
    expect(() => parseDoc(f)).toThrow(FileFormatError)
    const noDepth = prim('sketch', { params: { sketch: rectWithHole(), depth: -1 } })
    expect(() => parseDoc(serializeDoc({ ...emptyDoc(), nodes: [noDepth] }))).toThrow(FileFormatError)
    const future = JSON.stringify({ format: 'cad-system-project', version: 6, app: 'x', doc: { nodes: [], meshes: {} } })
    expect(() => parseDoc(future)).toThrow(FileFormatError)
  })

  it('rejects sketch ids that clash with solver ids', () => {
    const s = rectWithHole()
    const bad = { ...s, points: s.points.map((p, i) => (i === 0 ? { ...p, id: 'k1#0' } : p)) }
    const f = serializeDoc({ ...emptyDoc(), nodes: [prim('sketch', { params: { sketch: bad, depth: 4 } })] })
    expect(() => parseDoc(f)).toThrow(FileFormatError)
  })

  it('ids in a loaded sketch never collide with new ones', () => {
    const s = rectWithHole()
    const d = { ...emptyDoc(), nodes: [prim('sketch', { params: { sketch: { ...s, next: 1 }, depth: 4 } })] }
    const back = parseDoc(serializeDoc(d))
    const n = back.nodes[0]
    const sk = n.kind === 'prim' ? n.params.sketch! : null
    expect(sk!.next).toBeGreaterThan(s.next - 1)
  })
})
