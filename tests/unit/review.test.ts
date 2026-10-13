import { describe, expect, it } from 'vitest'
import { addNodes, groupNodes, setTransform, ungroupWouldDistort } from '@/core/doc/ops'
import { emptyDoc } from '@/core/doc/model'
import { FileFormatError, parseDoc, serializeDoc } from '@/core/io/formats'
import { at, getEngine, prim } from './helpers'

describe('robustness', () => {
  it('text made only of invisible characters gives empty geometry', async () => {
    const e = await getEngine()
    expect(e.evaluate(prim('text', { params: { text: '​⁠' } })).volume).toBe(0)
  })

  it('project files with broken nodes are rejected before loading', () => {
    const good = JSON.parse(serializeDoc(addNodes(emptyDoc(), [prim('box')])))
    delete good.doc.nodes[0].transform.rotation
    expect(() => parseDoc(JSON.stringify(good))).toThrow(FileFormatError)
    const g2 = JSON.parse(serializeDoc(addNodes(emptyDoc(), [prim('box')])))
    g2.doc.nodes[0].kind = 'group'
    expect(() => parseDoc(JSON.stringify(g2))).toThrow(FileFormatError)
    const g3 = JSON.parse(serializeDoc(addNodes(emptyDoc(), [prim('mesh', { params: { meshId: 'nope' } })])))
    expect(() => parseDoc(JSON.stringify(g3))).toThrow(FileFormatError)
  })

  it('setTransform with the same values keeps the same doc (no empty undo steps)', () => {
    const a = prim('box')
    const d = addNodes(emptyDoc(), [a])
    expect(setTransform(d, a.id, { ...a.transform, position: [0, 0, 0] })).toBe(d)
  })

  it('detects when ungrouping would distort a rotated child', () => {
    const a = { ...prim('box'), transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 45] as [number, number, number], scale: [1, 1, 1] as [number, number, number] } }
    const b = at(prim('box'), 30, 0, 0)
    const g = groupNodes(addNodes(emptyDoc(), [a, b]), [a.id, b.id], [0, 0, 0], 'G')!
    expect(ungroupWouldDistort(g.doc, g.id)).toBe(false)
    const stretched = setTransform(g.doc, g.id, { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 1, 1] })
    expect(ungroupWouldDistort(stretched, g.id)).toBe(true)
    const uniform = setTransform(g.doc, g.id, { position: [0, 0, 0], rotation: [0, 0, 0], scale: [2, 2, 2] })
    expect(ungroupWouldDistort(uniform, g.id)).toBe(false)
  })

  it('export keeps open imported meshes as raw triangles', async () => {
    const e = await getEngine()
    e.meshes = { open: { vertices: [0, 0, 0, 10, 0, 0, 0, 10, 0], triangles: [0, 1, 2] } }
    const r = e.exportMesh([prim('box'), prim('mesh', { params: { meshId: 'open' } })])
    expect(r.skipped).toBe(0)
    const boxOnly = e.exportMesh([prim('box')])
    expect(r.indices.length).toBe(boxOnly.indices.length + 3)
  })
})
