import { describe, expect, it } from 'vitest'
import { addNodes, removeNodes } from '@/core/doc/ops'
import * as S from '@/core/doc/store'
import { emptyDoc, sameContent, sceneNodes, withScene } from '@/core/doc/model'
import { FileFormatError, parseDoc, serializeDoc } from '@/core/io/formats'
import { robotNode, tileNode } from '@/core/robotics/demo'
import { prim } from './helpers'

const legacy = (version: number, nodes: unknown[]) =>
  JSON.stringify({ format: 'cad-system-project', version, app: 'Cad System', doc: { version, nodes, meshes: {} } })

describe('two scenes in one project', () => {
  it('switching the scene swaps the nodes but not the content', () => {
    const box = prim('box')
    const tile = tileNode({ kind: 'straight', x: 150, y: 150, angle: 0 }, 't')
    const d = { ...emptyDoc(), nodes: [box], parked: [tile] }
    const r = withScene(d, 'robo')
    expect(r.nodes).toEqual([tile])
    expect(r.parked).toEqual([box])
    expect(withScene(d, 'model')).toBe(d)
    expect(sameContent(d, r)).toBe(true)
    expect(sameContent(d, { ...r, nodes: [] })).toBe(false)
    expect(sceneNodes(r, 'model')).toEqual([box])
  })

  it('files keep both scenes whichever is on screen', () => {
    const box = prim('box')
    const robot = robotNode(150, 150, 0, 'r')
    const onRobo = withScene({ ...emptyDoc(), nodes: [box], parked: [robot] }, 'robo')
    const f = JSON.parse(serializeDoc(onRobo))
    expect(f.version).toBe(6)
    expect(f.doc.nodes.map((n: { id: string }) => n.id)).toEqual([box.id])
    expect(f.doc.robo.map((n: { id: string }) => n.id)).toEqual([robot.id])
    const back = parseDoc(serializeDoc(onRobo))
    expect(back.scene).toBe('model')
    expect(back.nodes.map((n) => n.id)).toEqual([box.id])
    expect(back.parked.map((n) => n.id)).toEqual([robot.id])
  })

  it('old files: a field with tiles or robots becomes the robotics scene, anything else the 3D scene', () => {
    const tile = tileNode({ kind: 'turn', x: 150, y: 150, angle: 0 }, 't')
    const box = prim('box')
    const field = parseDoc(legacy(3, [tile, box]))
    expect(sceneNodes(field, 'robo').map((n) => n.id)).toEqual([tile.id, box.id])
    expect(sceneNodes(field, 'model')).toEqual([])
    const model = parseDoc(legacy(2, [prim('sphere')]))
    expect(sceneNodes(model, 'model')).toHaveLength(1)
    expect(sceneNodes(model, 'robo')).toEqual([])
  })

  it('refuses a robot in the 3D scene and ids used twice across scenes', () => {
    const robot = robotNode(0, 0, 0, 'r')
    const wrong = { format: 'nerpacad-project', version: 5, app: 'NerpaCad', doc: { version: 5, nodes: [robot], robo: [], meshes: {} } }
    expect(() => parseDoc(JSON.stringify(wrong))).toThrow(FileFormatError)
    const box = prim('box')
    const twice = { ...wrong, doc: { version: 5, nodes: [box], robo: [box], meshes: {} } }
    expect(() => parseDoc(JSON.stringify(twice))).toThrow(FileFormatError)
  })

  it('a mesh used on the robotics field survives deleting its twin in the 3D scene', () => {
    const a = prim('mesh', { params: { meshId: 'm1' } })
    const b = prim('mesh', { params: { meshId: 'm1', source: 'x' } })
    const d = { ...emptyDoc(), nodes: [a], parked: [b], meshes: { m1: { vertices: [0, 0, 0], triangles: [] } } }
    expect(removeNodes(d, [a.id]).meshes.m1).toBeDefined()
  })
})

describe('the store switches scenes', () => {
  it('without an undo step or unsaved changes, remembering selection and grid per scene', () => {
    S.loadDoc(emptyDoc(), null, null)
    const box = prim('box')
    S.commit(addNodes(S.doc.value, [box]), [box.id])
    S.markSaved('/p.nerpa', 'p.nerpa')
    S.gridStep.value = 5
    S.showScene('robo')
    expect(S.doc.value.scene).toBe('robo')
    expect(S.doc.value.nodes).toEqual([])
    expect(S.selection.value).toEqual([])
    expect(S.gridStep.value).toBe(S.DEFAULT_GRID.robo)
    expect(S.dirty.value).toBe(false)
    const tile = tileNode({ kind: 'cross', x: 150, y: 150, angle: 0 }, 't')
    S.commit(addNodes(S.doc.value, [tile]), [tile.id])
    expect(S.dirty.value).toBe(true)
    S.showScene('model')
    expect(S.doc.value.nodes.map((n) => n.id)).toEqual([box.id])
    expect(S.selection.value).toEqual([box.id])
    expect(S.gridStep.value).toBe(5)
    // undoing the tile (made on the field) keeps the 3D scene on screen
    S.undo()
    expect(S.doc.value.scene).toBe('model')
    expect(S.doc.value.nodes.map((n) => n.id)).toEqual([box.id])
    expect(S.doc.value.parked).toEqual([])
    expect(S.dirty.value).toBe(false)
  })

  it('opening a project keeps the scene on screen', () => {
    S.loadDoc(emptyDoc(), null, null)
    S.showScene('robo')
    const tile = tileNode({ kind: 'cross', x: 150, y: 150, angle: 0 }, 't')
    S.loadDoc({ ...emptyDoc(), parked: [tile] }, null, null)
    expect(S.doc.value.scene).toBe('robo')
    expect(S.doc.value.nodes.map((n) => n.id)).toEqual([tile.id])
    expect(S.dirty.value).toBe(false)
    S.showScene('model')
  })
})

describe('example projects', () => {
  it('open, with the demo field in the robotics scene', async () => {
    const { readFileSync } = await import('node:fs')
    const lf = parseDoc(readFileSync('examples/line-follower.nerpa', 'utf8'))
    expect(sceneNodes(lf, 'robo').some((n) => n.kind === 'prim' && n.prim === 'robot')).toBe(true)
    expect(sceneNodes(lf, 'model')).toEqual([])
    const blink = parseDoc(readFileSync('examples/blink.nerpa', 'utf8'))
    expect(blink.circuit?.parts.length).toBeGreaterThan(0)
  })
})
