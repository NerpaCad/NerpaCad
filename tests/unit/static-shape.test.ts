/**
 * Static shapes of the robotics field (models from the 3D tab marked «Static»): their columns,
 * robots and heroes going over them and stopping at them, things following one that is moved,
 * the file keeping the mark, the physics holding a falling shape on one.
 */
import { describe, expect, it } from 'vitest'
import { Matrix4 } from 'three'
import { emptyDoc, type Doc, type DocNode, type MeshData, type PrimNode } from '@/core/doc/model'
import { nerpaNode, robotNode, start, workspaceJson } from '@/core/robotics/demo'
import { RoboWorld, terrainOf } from '@/core/robotics/world'
import { buildSolidGrid, gridSpans } from '@/core/robotics/solid'
import { surfacesAt, wallAt } from '@/core/robotics/terrain'
import { settleOnTerrain } from '@/core/robotics/field'
import { parseDoc, serializeDoc } from '@/core/io/formats'
import { Physics, initPhysics } from '@/core/robotics/physics'
import type { BlockJson } from '@/core/robotics/interpreter'

let bid = 0
const blk = (type: string, inputs: Record<string, unknown> = {}): BlockJson => ({ type, id: `b${++bid}`, inputs, fields: {} }) as BlockJson
const num = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })

/** a closed box from (x0, y0, z0) to (x1, y1, z1), its triangles facing out */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, into?: MeshData): MeshData {
  const m = into ?? { vertices: [], triangles: [] }
  const o = m.vertices.length / 3
  for (let i = 0; i < 8; i++) m.vertices.push(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0)
  const quads = [
    [0, 2, 3, 1], // bottom
    [4, 5, 7, 6], // top
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5]
  ]
  for (const [a, b, c, d] of quads) m.triangles.push(o + a, o + b, o + c, o + a, o + c, o + d)
  return m
}

/** a static shape node at (x, y) over a mesh centred on its own origin with its bottom at z = 0 */
function shape(id: string, x: number, y: number, fixed = true, z = 0): PrimNode {
  return {
    id,
    kind: 'prim',
    prim: 'mesh',
    name: id,
    color: '#888888',
    isHole: false,
    params: { meshId: `m-${id}` },
    transform: { position: [x, y, z], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ...(fixed ? { fixed: true as const } : {})
  }
}

const field = (nodes: DocNode[], meshes: Record<string, MeshData>): Doc => ({ ...emptyDoc(), scene: 'robo', nodes, meshes })
const driver = (x: number, y: number, deg: number): PrimNode =>
  robotNode(x, y, deg, 'R', workspaceJson([start([blk('robo_motors', { LEFT: num(100), RIGHT: num(100) })])]))

describe('the columns of a static shape', () => {
  it('a box is solid from its bottom to its top inside, empty outside', () => {
    const g = buildSolidGrid(box(-100, -50, 0, 100, 50, 40), new Matrix4().makeTranslation(500, 300, 0))
    expect(gridSpans(g, 500, 300)).toEqual([[0, 40]])
    expect(gridSpans(g, 590, 340)[0][1]).toBeCloseTo(40)
    expect(gridSpans(g, 620, 300)).toEqual([])
    expect(g.top).toBeCloseTo(40)
    expect(g.positions.length).toBe(24)
  })

  it('a shape with an overhang has two spans, and there is room under it', () => {
    // a low slab and a roof over it: in one mesh
    const m = box(-100, -100, 0, 100, 100, 10)
    box(-100, -100, 90, 100, 100, 110, m)
    const d = field([shape('arch', 0, 0)], { 'm-arch': m })
    const [t] = terrainOf(d)
    expect(t.kind).toBe('solid')
    const s = surfacesAt([t], 0, 0).map((h) => Math.round(h.z))
    expect(s).toEqual([10, 110])
    // a 58 mm robot on the slab fits under the roof; a 100 mm one does not
    expect(wallAt([t], 0, 0, 10, 58)).toBe(false)
    expect(wallAt([t], 0, 0, 10, 100)).toBe(true)
  })

  it('a turned and moved shape: its columns follow it', () => {
    const d = field([{ ...shape('long', 400, 400), transform: { position: [400, 400, 0], rotation: [0, 0, 90], scale: [1, 1, 2] } }], {
      'm-long': box(-150, -20, 0, 150, 20, 30)
    })
    const [t] = terrainOf(d)
    // turned 90°: long along Y; scaled twice as tall
    expect(surfacesAt([t], 400, 530).map((h) => Math.round(h.z))).toEqual([60])
    expect(surfacesAt([t], 530, 400).map((h) => h.z)).toEqual([0])
  })

  it('only marked models count (a movable one is not terrain)', () => {
    const d = field([shape('a', 0, 0, false), shape('b', 500, 0)], { 'm-a': box(-50, -50, 0, 50, 50, 20), 'm-b': box(-50, -50, 0, 50, 50, 20) })
    expect(terrainOf(d).map((t) => t.id)).toEqual(['b'])
  })
})

describe('going over static shapes', () => {
  it('a robot drives onto a low one and over it, and stops at a tall one', () => {
    const low = field([shape('plate', 450, 0), driver(0, 0, 0)], { 'm-plate': box(-150, -150, 0, 150, 150, 8) })
    const w = RoboWorld.fromDoc(low)
    let top = 0
    w.run(5, () => w.robots[0].pose.x > 350 && w.robots[0].pose.x < 550 && (top = Math.max(top, w.robots[0].z)))
    expect(top).toBeCloseTo(8, 0)
    expect(w.robots[0].pose.x).toBeGreaterThan(700)

    const tall = RoboWorld.fromDoc(field([shape('wall', 450, 0), driver(0, 0, 0)], { 'm-wall': box(-50, -300, 0, 50, 300, 100) }))
    tall.run(3)
    expect(tall.robots[0].pose.x).toBeLessThan(400)
    expect(tall.robots[0].z).toBe(0)
  })

  it('a robot put on one stands on it; a hero knows it stands on an object', () => {
    const meshes = { 'm-table': box(-200, -200, 0, 200, 200, 60) }
    const w = RoboWorld.fromDoc(field([shape('table', 0, 0), { ...driver(0, 0, 0), transform: { position: [0, 0, 60], rotation: [0, 0, 0], scale: [1, 1, 1] } }], meshes))
    expect(w.robots[0].z).toBeCloseTo(60)
    const seal = nerpaNode(0, 0, 0, 'seal', workspaceJson([start([])]), 'seal')
    seal.transform.position[2] = 60
    const h = RoboWorld.fromDoc(field([shape('table', 0, 0), seal], meshes))
    expect(h.under(h.seals[0].seal)).toBe('object')
  })

  it('what stands on a static shape goes with it when it is lifted', () => {
    const meshes = { 'm-step': box(-150, -150, 0, 150, 150, 30) }
    const r = { ...driver(0, 0, 0), transform: { position: [0, 0, 30] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] } }
    const before = field([shape('step', 0, 0), r], meshes)
    const after = field([shape('step', 0, 0, true, 50), r], meshes)
    const settled = settleOnTerrain(before, after)
    expect(settled.nodes.find((n) => n.id === r.id)!.transform.position[2]).toBeCloseTo(80)
    // the shape itself stays where it was put
    expect(settled.nodes.find((n) => n.id === 'step')!.transform.position[2]).toBe(50)
  })
})

describe('the mark in files and in the physics', () => {
  it('the file keeps it; a broken value is refused', () => {
    const d = field([shape('s', 0, 0)], { 'm-s': box(-10, -10, 0, 10, 10, 10) })
    const back = parseDoc(serializeDoc(d))
    expect([...back.nodes, ...(back.parked ?? [])].find((n) => n.id === 's')!.fixed).toBe(true)
    const text = serializeDoc(d)
    expect(text).toContain('"fixed":true')
    expect(() => parseDoc(text.replace('"fixed":true', '"fixed":"yes"'))).toThrow()
  })

  it('a shape falling on a static one rests on its top', async () => {
    await initPhysics()
    const d = field([shape('slab', 0, 0)], { 'm-slab': box(-200, -200, 0, 200, 200, 50) })
    const w = RoboWorld.fromDoc(d)
    // a 20 mm cube dropped from 150 mm
    const pts: number[] = []
    for (let i = 0; i < 8; i++) pts.push(i & 1 ? 10 : -10, i & 2 ? 10 : -10, 150 + (i & 4 ? 20 : 0))
    const ph = new Physics([{ id: 'cube', points: Float32Array.from(pts), mass: 10, glow: false }], [], [], w.terrain)
    for (let i = 0; i < 240; i++) ph.step(1 / 120, [], [])
    const c = ph.shapes().find((s) => s.id === 'cube')!
    ph.dispose()
    // its middle 10 mm over the slab's top (50 mm), not on the floor
    expect(c.pos[2]).toBeGreaterThan(55)
    expect(c.pos[2]).toBeLessThan(65)
  })
})
