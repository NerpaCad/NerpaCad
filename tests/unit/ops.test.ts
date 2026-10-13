import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { type Box, type Doc, type DocNode, emptyDoc, transformMatrix, transformBox } from '@/core/doc/model'
import {
  addNodes,
  alignNodes,
  dropToWorkplane,
  duplicateNodes,
  duplicateRepeat,
  updateNodes,
  groupNodes,
  mirrorNodes,
  moveNodes,
  removeNodes,
  rotateNodes,
  setHole,
  sizeToScale,
  ungroupNode
} from '@/core/doc/ops'
import { at, getEngine, prim } from './helpers'
import { shortcutKey } from '@/keys'

const docOf = (...nodes: DocNode[]): Doc => addNodes(emptyDoc(), nodes)

/** World box of a node computed from its real geometry. */
async function worldBox(n: DocNode): Promise<Box> {
  const e = await getEngine()
  const r = e.evaluate(n)
  const m = transformMatrix(n.transform)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const v = new Vector3()
  for (let i = 0; i < r.positions.length; i += 3) {
    v.set(r.positions[i], r.positions[i + 1], r.positions[i + 2]).applyMatrix4(m)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], v.getComponent(k))
      max[k] = Math.max(max[k], v.getComponent(k))
    }
  }
  return { min: min as Box['min'], max: max as Box['max'] }
}

describe('grouping and holes', () => {
  it('box minus cylinder hole has the expected volume', async () => {
    const e = await getEngine()
    const box = prim('box')
    const hole = { ...prim('cylinder', { isHole: true, params: { segments: 64 } }), transform: { position: [0, 0, -5] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [0.5, 0.5, 2] as [number, number, number] } }
    const d = docOf(box, hole)
    const g = groupNodes(d, [box.id, hole.id], [0, 0, 0], 'G')!
    expect(g.doc.nodes).toHaveLength(1)
    const res = e.evaluate(g.doc.nodes[0])
    // cylinder r=5 through a 20 mm cube: 8000 - π·25·20 (64-gon ≈ 0.16% less area)
    const expected = 8000 - Math.PI * 25 * 20
    expect(Math.abs(res.volume - expected) / expected).toBeLessThan(0.01)
  })

  it('ungroup restores the original world transforms exactly', () => {
    const a = at(prim('box'), 10, 5, 0)
    const b = { ...prim('sphere'), transform: { position: [-7, 3, 2] as [number, number, number], rotation: [10, 20, 30] as [number, number, number], scale: [1.5, 1, 0.5] as [number, number, number] } }
    const d = docOf(a, b)
    const g = groupNodes(d, [a.id, b.id], [3, 4, 0], 'G')!
    const u = ungroupNode(g.doc, g.id)!
    const ra = u.doc.nodes.find((n) => n.id === a.id)!
    const rb = u.doc.nodes.find((n) => n.id === b.id)!
    expect(ra.transform).toEqual(a.transform)
    const m1 = transformMatrix(rb.transform).elements
    const m2 = transformMatrix(b.transform).elements
    m1.forEach((x, i) => expect(x).toBeCloseTo(m2[i], 6))
  })

  it('ungroup after moving and rotating the group keeps children in place', () => {
    const a = at(prim('box'), 10, 0, 0)
    const b = at(prim('cylinder'), -10, 0, 0)
    const g = groupNodes(docOf(a, b), [a.id, b.id], [0, 0, 0], 'G')!
    let d = rotateNodes(g.doc, [g.id], 2, 90, [0, 0, 10])
    d = moveNodes(d, [g.id], [5, 5, 0])
    const groupM = transformMatrix(d.nodes[0].transform)
    const expectA = groupM.clone().multiply(transformMatrix((d.nodes[0] as { children: DocNode[] }).children[0].transform))
    const u = ungroupNode(d, g.id)!
    const got = transformMatrix(u.doc.nodes[0].transform).elements
    got.forEach((x, i) => expect(x).toBeCloseTo(expectA.elements[i], 6))
    expect(u.doc.nodes[0].transform.position).toEqual([5, 15, 0])
  })

  it('nested groups and hole groups evaluate', async () => {
    const e = await getEngine()
    const a = prim('box')
    const h1 = { ...at(prim('box'), 0, 0, 10), isHole: true, transform: { position: [0, 0, 10] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [0.5, 0.5, 1] as [number, number, number] } }
    const inner = groupNodes(docOf(a, h1), [a.id, h1.id], [0, 0, 0], 'inner')!
    const e1 = e.evaluate(inner.doc.nodes[0]).volume
    expect(e1).toBeCloseTo(8000 - 10 * 10 * 10, 3)
    // group of only holes stays a hole
    const x = { ...prim('box'), isHole: true }
    const y = { ...at(prim('box'), 5, 0, 0), isHole: true }
    const hg = groupNodes(docOf(x, y), [x.id, y.id], [0, 0, 0], 'H')!
    expect(hg.doc.nodes[0].isHole).toBe(true)
  })

  it('export skips top-level holes and unions solids', async () => {
    const e = await getEngine()
    const a = prim('box')
    const b = at(prim('box'), 10, 0, 0)
    const h = { ...at(prim('box'), 100, 0, 0), isHole: true }
    const r = e.exportMesh([a, b, h])
    expect(r.volume).toBeCloseTo(8000 + 4000, 3)
    expect(r.box.max[0]).toBeCloseTo(20, 6)
  })
})

describe('transforms', () => {
  it('mirror twice gives back the original', () => {
    const a = { ...prim('wedge'), transform: { position: [3, 4, 1] as [number, number, number], rotation: [0, 0, 30] as [number, number, number], scale: [1, 2, 1] as [number, number, number] } }
    for (const ax of [0, 1, 2] as const) {
      const d1 = mirrorNodes(docOf(a), [a.id], ax, [0, 0, 0])
      const d2 = mirrorNodes(d1, [a.id], ax, [0, 0, 0])
      const m1 = transformMatrix(d2.nodes[0].transform).elements
      const m0 = transformMatrix(a.transform).elements
      m1.forEach((x, i) => expect(x).toBeCloseTo(m0[i], 6))
    }
  })

  it('mirror equals a reflection of the world matrix', () => {
    const a = { ...prim('wedge'), transform: { position: [3, 4, 1] as [number, number, number], rotation: [20, 10, 30] as [number, number, number], scale: [1, 2, 1] as [number, number, number] } }
    const d = mirrorNodes(docOf(a), [a.id], 0, [5, 0, 0])
    const f = new Matrix4().makeTranslation(5, 0, 0).multiply(new Matrix4().makeScale(-1, 1, 1)).multiply(new Matrix4().makeTranslation(-5, 0, 0))
    const want = f.multiply(transformMatrix(a.transform)).elements
    const got = transformMatrix(d.nodes[0].transform).elements
    got.forEach((x, i) => expect(x).toBeCloseTo(want[i], 6))
  })

  it('mirrored geometry keeps a positive volume', async () => {
    const e = await getEngine()
    const a = prim('wedge')
    const d = mirrorNodes(docOf(a), [a.id], 0, [0, 0, 0])
    expect(e.exportMesh(d.nodes).volume).toBeCloseTo(4000, 3)
  })

  it('align min/center/max along X', async () => {
    const a = at(prim('box'), 0, 0, 0)
    const b = at(prim('box'), 50, 30, 0)
    const d = docOf(a, b)
    const boxes = { [a.id]: await worldBox(a), [b.id]: await worldBox(b) }
    const r = alignNodes(d, [a.id, b.id], 0, 'max', boxes)
    expect(r.nodes.map((n) => n.transform.position[0])).toEqual([50, 50])
    const c = alignNodes(d, [a.id, b.id], 0, 'center', boxes)
    expect(c.nodes.map((n) => n.transform.position[0])).toEqual([25, 25])
    const m = alignNodes(d, [a.id, b.id], 1, 'min', boxes)
    expect(m.nodes.map((n) => n.transform.position[1])).toEqual([0, 0])
  })

  it('drop to workplane puts the lowest point at z=0', async () => {
    const a = { ...at(prim('sphere'), 0, 0, 12), transform: { position: [0, 0, 12] as [number, number, number], rotation: [45, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] } }
    const d = dropToWorkplane(docOf(a), [a.id], { [a.id]: await worldBox(a) })
    const b = await worldBox(d.nodes[0])
    expect(b.min[2]).toBeCloseTo(0, 5)
  })

  it('size to scale', () => {
    const s = sizeToScale({ min: [-10, -10, 0], max: [10, 10, 20] }, [40, 10, 5], [1, -1, 1])
    expect(s).toEqual([2, -0.5, 0.25])
  })

  it('transformBox covers rotated corners', () => {
    const b = transformBox({ min: [-10, -10, 0], max: [10, 10, 20] }, transformMatrix({ position: [0, 0, 0], rotation: [0, 0, 45], scale: [1, 1, 1] }))
    expect(b.max[0]).toBeCloseTo(Math.SQRT2 * 10, 6)
  })
})

describe('editing', () => {
  it('duplicate gives new ids and deep copies groups', () => {
    const a = prim('box')
    const b = prim('cone')
    const g = groupNodes(docOf(a, b), [a.id, b.id], [0, 0, 0], 'G')!
    const r = duplicateNodes(g.doc, [g.id], [5, 0, 0])
    expect(r.doc.nodes).toHaveLength(2)
    const copy = r.doc.nodes[1]
    expect(copy.id).not.toBe(g.id)
    expect(copy.kind === 'group' && copy.children[0].id).not.toBe(a.id)
    expect(copy.transform.position[0]).toBe(5)
  })

  it('remove prunes unused imported meshes', () => {
    const m = prim('mesh', { params: { meshId: 'm1' } })
    const d: Doc = { ...docOf(m), meshes: { m1: { vertices: [], triangles: [] } } }
    expect(removeNodes(d, [m.id]).meshes).toEqual({})
  })

  it('operations never mutate their input', () => {
    const a = prim('box')
    const d = docOf(a)
    const frozen = JSON.stringify(d)
    moveNodes(d, [a.id], [1, 2, 3])
    setHole(d, [a.id], true)
    rotateNodes(d, [a.id], 0, 45, [0, 0, 0])
    mirrorNodes(d, [a.id], 1, [0, 0, 0])
    expect(JSON.stringify(d)).toBe(frozen)
  })
})

describe('duplicate, repeated like Tinkercad', () => {
  it('repeats a move: an evenly spaced row', () => {
    let d = docOf(prim('box'))
    const a = d.nodes[0].id
    let r = duplicateNodes(d, [a])
    d = moveNodes(r.doc, r.ids, [25, 0, 0])
    const r2 = duplicateRepeat(d, [a], r.ids)!
    const r3 = duplicateRepeat(r2.doc, r.ids, r2.ids)!
    const xs = r3.doc.nodes.map((n) => n.transform.position[0])
    expect(xs).toEqual([0, 25, 50, 75])
  })

  it('repeats a turn around a centre: a circle', () => {
    let d = docOf(at(prim('box'), 50, 0, 0))
    const a = d.nodes[0].id
    const r = duplicateNodes(d, [a])
    d = rotateNodes(r.doc, r.ids, 2, 90, [0, 0, 0])
    let prev = r.ids
    let from = [a]
    for (let i = 0; i < 2; i++) {
      const n = duplicateRepeat(d, from, prev)!
      d = n.doc
      from = prev
      prev = n.ids
    }
    const p = d.nodes.map((n) => n.transform.position.map((v) => Math.round(v)))
    expect(p).toEqual([
      [50, 0, 0],
      [0, 50, 0],
      [-50, 0, 0],
      [0, -50, 0]
    ])
    expect(Math.round(d.nodes[3].transform.rotation[2])).toBe(-90)
  })

  it('repeats a resize: a growing series', () => {
    let d = docOf(prim('box'))
    const a = d.nodes[0].id
    const r = duplicateNodes(d, [a])
    d = updateNodes(r.doc, r.ids, (n) => ({ ...n, transform: { ...n.transform, scale: [2, 2, 2] } }))
    const r2 = duplicateRepeat(d, [a], r.ids)!
    expect(r2.doc.nodes[2].transform.scale).toEqual([4, 4, 4])
  })

  it('gives up when a node is gone', () => {
    const d = docOf(prim('box'))
    expect(duplicateRepeat(d, [d.nodes[0].id], ['missing'])).toBeNull()
  })
})

describe('shortcut keys', () => {
  const ev = (key: string, code: string) => ({ key, code }) as KeyboardEvent
  it('work with a Russian layout', () => {
    expect(shortcutKey(ev('я', 'KeyZ'))).toBe('z')
    expect(shortcutKey(ev('С', 'KeyC'))).toBe('c')
    expect(shortcutKey(ev('z', 'KeyZ'))).toBe('z')
    // a Latin layout with other key positions keeps its own letters
    expect(shortcutKey(ev('w', 'KeyZ'))).toBe('w')
    expect(shortcutKey(ev('Delete', 'Delete'))).toBe('delete')
  })
})
