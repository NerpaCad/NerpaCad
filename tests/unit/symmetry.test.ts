import { describe, expect, it } from 'vitest'
import { addNodes, groupNodes, moveNodes, removeNodes, setColor, setTransform } from '@/core/doc/ops'
import * as S from '@/core/doc/store'
import { emptyDoc, transformMatrix } from '@/core/doc/model'
import { mirrorTransform, twinId } from '@/core/doc/symmetry'
import { parseDoc, serializeDoc } from '@/core/io/formats'
import { Matrix4 } from 'three'
import { at, prim } from './helpers'

const byId = (id: string) => S.doc.value.nodes.find((n) => n.id === id)
const turnOn = (x: boolean, y: boolean) => S.commit({ ...S.doc.value, symmetry: { x, y } })

describe('mirror transforms', () => {
  it('are exact mirror images and undo themselves', () => {
    const t = { position: [12, -5, 3] as [number, number, number], rotation: [10, 20, 30] as [number, number, number], scale: [1, 2, 3] as [number, number, number] }
    for (const m of ['x', 'y', 'xy'] as const) {
      const f = new Matrix4().makeScale(m === 'y' ? 1 : -1, m === 'x' ? 1 : -1, 1)
      const want = f.multiply(transformMatrix(t))
      const got = transformMatrix(mirrorTransform(t, m))
      for (let i = 0; i < 16; i++) expect(got.elements[i]).toBeCloseTo(want.elements[i], 6)
      expect(mirrorTransform(mirrorTransform(t, m), m)).toEqual(t)
    }
  })
})

describe('symmetry mode', () => {
  it('gives every shape a twin that follows its edits, both ways', () => {
    S.loadDoc(emptyDoc(), null, null)
    const a = at(prim('box'), 30, 10, 0)
    S.commit(addNodes(S.doc.value, [a]))
    turnOn(true, false)
    const tw = byId(twinId(a.id, 'x'))!
    expect(tw).toBeDefined()
    expect(tw.transform.position).toEqual([-30, 10, 0])
    expect(tw.transform.scale[0]).toBe(-1)
    // edit the shape: the twin follows
    S.commit(moveNodes(S.doc.value, [a.id], [5, 5, 0]))
    expect(byId(tw.id)!.transform.position).toEqual([-35, 15, 0])
    S.commit(setColor(S.doc.value, [a.id], '#00ff00'))
    expect(byId(tw.id)!.color).toBe('#00ff00')
    // edit the twin: the shape follows
    S.commit(moveNodes(S.doc.value, [tw.id], [-10, 0, 0]))
    expect(byId(a.id)!.transform.position).toEqual([45, 15, 0])
    // a drag of the twin: the shape follows at every step
    const base = S.beginGesture()
    S.previewGesture(moveNodes(base, [tw.id], [0, 7, 0], base))
    expect(byId(a.id)!.transform.position).toEqual([45, 22, 0])
    S.previewGesture(moveNodes(base, [tw.id], [0, 9, 0], base))
    expect(byId(a.id)!.transform.position).toEqual([45, 24, 0])
    S.endGesture()
  })

  it('both planes give three twins; a shape on a plane has none for it', () => {
    S.loadDoc(emptyDoc(), null, null)
    const a = at(prim('cylinder'), 20, 20, 0)
    const c = at(prim('sphere'), 0, 15, 0)
    S.commit(addNodes(S.doc.value, [a, c]))
    turnOn(true, true)
    expect(S.doc.value.nodes).toHaveLength(2 + 3 + 1)
    expect(byId(twinId(a.id, 'xy'))!.transform.position).toEqual([-20, -20, 0])
    expect(byId(twinId(c.id, 'y'))).toBeDefined()
    expect(byId(twinId(c.id, 'x'))).toBeUndefined()
    // moving onto the ZY plane takes the x twins away
    S.commit(setTransform(S.doc.value, a.id, { ...byId(a.id)!.transform, position: [0, 20, 0] }))
    expect(byId(twinId(a.id, 'x'))).toBeUndefined()
    expect(byId(twinId(a.id, 'xy'))).toBeUndefined()
    expect(byId(twinId(a.id, 'y'))).toBeDefined()
  })

  it('deleting a shape or its twin deletes both; undo brings both back', () => {
    S.loadDoc(emptyDoc(), null, null)
    const a = at(prim('box'), 30, 0, 0)
    S.commit(addNodes(S.doc.value, [a]))
    turnOn(true, false)
    S.commit(removeNodes(S.doc.value, [twinId(a.id, 'x')]))
    expect(S.doc.value.nodes).toHaveLength(0)
    S.undo()
    expect(S.doc.value.nodes).toHaveLength(2)
    S.commit(removeNodes(S.doc.value, [a.id]))
    expect(S.doc.value.nodes).toHaveLength(0)
  })

  it('turning a plane off leaves the twins as ordinary shapes', () => {
    S.loadDoc(emptyDoc(), null, null)
    const a = at(prim('box'), 30, 20, 0)
    S.commit(addNodes(S.doc.value, [a]))
    turnOn(true, true)
    turnOn(true, false)
    expect(S.doc.value.nodes).toHaveLength(4)
    expect(byId(twinId(a.id, 'x'))!.mirrorOf).toBeDefined()
    expect(byId(twinId(a.id, 'y'))!.mirrorOf).toBeUndefined()
    expect(byId(twinId(a.id, 'xy'))!.mirrorOf).toBeUndefined()
    turnOn(false, false)
    expect(S.doc.value.nodes.every((n) => !n.mirrorOf)).toBe(true)
    // plain shapes now: moving one does not move the others
    S.commit(moveNodes(S.doc.value, [a.id], [1, 0, 0]))
    expect(byId(twinId(a.id, 'x'))!.transform.position[0]).toBe(-30)
  })

  it('grouping a twin with something else breaks the link instead of losing the shape', () => {
    S.loadDoc(emptyDoc(), null, null)
    const a = at(prim('box'), 30, 0, 0)
    const b = at(prim('box'), -30, 40, 0)
    S.commit(addNodes(S.doc.value, [a, b]))
    turnOn(true, false)
    const tw = twinId(a.id, 'x')
    const g = groupNodes(S.doc.value, [tw, b.id], [-30, 20, 0], 'G')!
    S.commit(g.doc)
    expect(byId(a.id)).toBeDefined()
    expect(byId(a.id)!.noMirror).toBe(true)
    expect(byId(twinId(a.id, 'x'))).toBeUndefined()
    // the group itself is a new shape with its own twin
    expect(byId(twinId(g.id, 'x'))).toBeDefined()
  })

  it('grouping shapes replaces their twins by the twin of the group; a group across the plane has none', () => {
    S.loadDoc(emptyDoc(), null, null)
    const a = at(prim('box'), 30, 0, 0)
    const b = at(prim('cylinder'), 50, 30, 0)
    S.commit(addNodes(S.doc.value, [a, b]))
    turnOn(true, false)
    expect(S.doc.value.nodes).toHaveLength(4)
    const g = groupNodes(S.doc.value, [a.id, b.id], [40, 15, 0], 'G')!
    S.commit(g.doc)
    expect(S.doc.value.nodes.map((n) => n.id).sort()).toEqual([g.id, twinId(g.id, 'x')].sort())
    // a shape grouped with its own twin makes a symmetric part: centered on the plane, no twin
    S.undo()
    const pair = groupNodes(S.doc.value, [a.id, twinId(a.id, 'x')], [0, 0, 0], 'P')!
    S.commit(pair.doc)
    expect(byId(twinId(pair.id, 'x'))).toBeUndefined()
    expect(S.doc.value.nodes.map((n) => n.id).sort()).toEqual([b.id, twinId(b.id, 'x'), pair.id].sort())
  })

  it('is saved in the file', () => {
    S.loadDoc(emptyDoc(), null, null)
    const a = at(prim('box'), 30, 10, 0)
    S.commit(addNodes(S.doc.value, [a]))
    turnOn(false, true)
    const back = parseDoc(serializeDoc(S.doc.value))
    expect(back.symmetry).toEqual({ y: true })
    expect(back.nodes.find((n) => n.id === twinId(a.id, 'y'))?.mirrorOf).toEqual({ id: a.id, m: 'y' })
  })
})
