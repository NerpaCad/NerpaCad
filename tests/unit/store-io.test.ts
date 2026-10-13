import { describe, expect, it } from 'vitest'
import { addNodes, moveNodes, groupNodes } from '@/core/doc/ops'
import * as S from '@/core/doc/store'
import { emptyDoc } from '@/core/doc/model'
import { importStl, parseDoc, serializeDoc, toObj, toStlBinary, FileFormatError } from '@/core/io/formats'
import { getEngine, prim, at } from './helpers'
import ru from '@/i18n/ru.json'
import en from '@/i18n/en.json'

describe('undo / redo', () => {
  it('commits, undoes and redoes; a drag is one step', () => {
    S.loadDoc(emptyDoc(), null, null)
    const a = prim('box')
    S.commit(addNodes(S.doc.value, [a]), [a.id])
    expect(S.canUndo.value).toBe(true)
    const base = S.beginGesture()
    for (let i = 1; i <= 10; i++) S.previewGesture(moveNodes(base, [a.id], [i, 0, 0], base))
    S.endGesture()
    expect(S.doc.value.nodes[0].transform.position[0]).toBe(10)
    S.undo()
    expect(S.doc.value.nodes[0].transform.position[0]).toBe(0)
    S.undo()
    expect(S.doc.value.nodes).toHaveLength(0)
    expect(S.selection.value).toEqual([])
    S.redo()
    S.redo()
    expect(S.doc.value.nodes[0].transform.position[0]).toBe(10)
    expect(S.canRedo.value).toBe(false)
  })

  it('cancelled gesture leaves no history; dirty tracks saved state', () => {
    S.loadDoc(emptyDoc(), null, null)
    expect(S.dirty.value).toBe(false)
    const a = prim('box')
    S.commit(addNodes(S.doc.value, [a]))
    expect(S.dirty.value).toBe(true)
    S.markSaved('/x.tcad', 'x.tcad')
    expect(S.dirty.value).toBe(false)
    const base = S.beginGesture()
    S.previewGesture(moveNodes(base, [a.id], [5, 0, 0], base))
    S.cancelGesture()
    expect(S.dirty.value).toBe(false)
    S.undo()
    expect(S.dirty.value).toBe(true)
  })
})

describe('files', () => {
  it('project save → open gives an identical document', () => {
    const a = at(prim('box'), 1, 2, 3)
    const b = prim('text', { params: { text: 'Привет' } })
    const g = groupNodes(addNodes(emptyDoc(), [a, b]), [a.id, b.id], [0, 0, 0], 'Группа')!
    const d = { ...g.doc, meshes: { m: { vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 2] } } }
    expect(parseDoc(serializeDoc(d))).toEqual(d)
  })

  it('rejects files that are not projects', () => {
    expect(() => parseDoc('{"hello":1}')).toThrow(FileFormatError)
    expect(() => parseDoc('garbage')).toThrow(FileFormatError)
  })

  it('STL export → import keeps triangles and volume', async () => {
    const e = await getEngine()
    const src = e.exportMesh([prim('sphere', { params: { segments: 24 } }), at(prim('box'), 15, 0, 0)])
    const stl = toStlBinary(src.positions, src.indices)
    expect(stl.byteLength).toBe(84 + (src.indices.length / 3) * 50)
    const mesh = importStl(stl)
    expect(mesh.triangles.length).toBe(src.indices.length)
    e.meshes = { m: mesh }
    const back = e.evaluate(prim('mesh', { params: { meshId: 'm' } }))
    expect(back.error).toBeUndefined()
    expect(back.volume).toBeCloseTo(src.volume, 0)
    expect(back.box.min[2]).toBeCloseTo(0, 4)
  })

  it('ASCII STL imports too, and an open mesh is flagged', async () => {
    const e = await getEngine()
    const ascii = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 10 0 0
vertex 0 10 0
endloop
endfacet
endsolid t`
    const mesh = importStl(new TextEncoder().encode(ascii).buffer as ArrayBuffer)
    expect(mesh.triangles).toHaveLength(3)
    e.meshes = { open: mesh }
    expect(e.evaluate(prim('mesh', { params: { meshId: 'open' } })).error).toBe('notManifold')
  })

  it('OBJ export has vertices and faces', async () => {
    const e = await getEngine()
    const r = e.exportMesh([prim('box')])
    const obj = toObj(r.positions, r.indices)
    expect(obj.match(/^v /gm)!.length).toBe(r.positions.length / 3)
    expect(obj.match(/^f /gm)!.length).toBe(r.indices.length / 3)
  })
})

describe('i18n', () => {
  it('ru and en have the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort())
  })
})
