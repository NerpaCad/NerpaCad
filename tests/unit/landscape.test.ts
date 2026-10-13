import { describe, expect, it } from 'vitest'
import { emptyDoc, sceneNodes, type Doc, type DocNode, type PrimNode } from '@/core/doc/model'
import { robotNode, terrainNode, workspaceJson, start } from '@/core/robotics/demo'
import { RoboWorld, terrainOf } from '@/core/robotics/world'
import { GROUND_HEIGHT, LAND_COLOR, WATER_LEVEL, nearestSurface, normTerrain, topSurface, wetAt } from '@/core/robotics/terrain'
import { MAX_SPAN, landAt, lineCells, paintCells, paintLand, rectCells } from '@/core/robotics/land'
import { parseDoc, serializeDoc } from '@/core/io/formats'
import type { BlockJson } from '@/core/robotics/interpreter'

let bid = 0
const blk = (type: string, inputs: Record<string, unknown> = {}, fields: Record<string, unknown> = {}): BlockJson => ({ type, id: `b${++bid}`, inputs, fields }) as BlockJson
const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const field = (nodes: DocNode[]): Doc => ({ ...emptyDoc(), scene: 'robo', nodes })
const driver = (x: number, y: number, deg: number, power = 100): PrimNode =>
  robotNode(x, y, deg, 'R', workspaceJson([start([blk('robo_motors', { LEFT: n(power), RIGHT: n(power) })])]))
const ground = (x: number, y: number, surface: 'grass' | 'sand' | 'stone' | 'road' = 'grass') => terrainNode('ground', x, y, 0, 'g', { surface })
const water = (x: number, y: number) => terrainNode('water', x, y, 0, 'w')
const seal = (x: number, y: number, deg: number, cm = 150): PrimNode => ({
  id: `s${x}`,
  kind: 'prim',
  prim: 'nerpa',
  name: 'N',
  color: '#888888',
  isHole: false,
  params: { nerpa: { program: workspaceJson([start([blk('nerpa_walk', { CM: n(cm) })])]) } },
  transform: { position: [x, y, 0], rotation: [0, 0, deg], scale: [1, 1, 1] }
})

describe('landscape tiles', () => {
  it('a ground tile is a low slab; water is a pool whose top is the water', () => {
    const t = terrainOf(field([ground(150, 150), water(450, 150)]))
    expect(topSurface(t, 150, 150)).toBe(GROUND_HEIGHT)
    expect(topSurface(t, 450, 150)).toBe(WATER_LEVEL)
    expect(nearestSurface(t, 450, 150, 0).water).toBe(true)
    expect(wetAt(t, 450, 150, 0)).toBe(true)
    expect(wetAt(t, 150, 150, 10)).toBe(false)
  })

  it('a robot drives from the floor onto grass and over a row of tiles', () => {
    const tiles = [0, 1, 2, 3].map((i) => ground(150 + i * 300, 150))
    const w = RoboWorld.fromDoc(field([...tiles, driver(-200, 150, 0)]))
    w.run(5)
    const r = w.robots[0]
    expect(r.pose.x).toBeGreaterThan(400)
    expect(r.z).toBe(GROUND_HEIGHT)
  })

  it('robots stop at the water, from the floor and from the grass', () => {
    const a = RoboWorld.fromDoc(field([water(150, 150), driver(-300, 150, 0)]))
    a.run(4)
    expect(a.robots[0].pose.x).toBeLessThan(0)
    expect(a.robots[0].pose.x).toBeGreaterThan(-200)
    const b = RoboWorld.fromDoc(field([ground(-150, 150), water(150, 150), driver(-200, 150, 0)]))
    b.run(4)
    expect(b.robots[0].pose.x).toBeLessThan(0)
    expect(b.robots[0].z).toBe(GROUND_HEIGHT)
  })

  it('a bridge over the water lets a robot pass', () => {
    const w = RoboWorld.fromDoc(
      field([
        terrainNode('ramp', 150, -300, 0, 'r', { length: 2, height: 60 }),
        water(150, 150),
        terrainNode('bridge', 150, 150, 0, 'b', { height: 60 }),
        terrainNode('ramp', 150, 600, 180, 'r2', { length: 2, height: 60 }),
        driver(150, -650, 90)
      ])
    )
    w.run(9)
    expect(w.robots[0].pose.y).toBeGreaterThan(400)
  })

  it('the seal walks into the water and swims across', () => {
    const w = RoboWorld.fromDoc(field([water(150, 150), water(450, 150), seal(-150, 150, 0, 120)]))
    let wasWet = false
    w.run(12, () => (wasWet ||= w.seals[0].seal.wet))
    const s = w.seals[0].seal
    expect(wasWet).toBe(true)
    expect(s.x).toBeGreaterThan(400)
  })

  it('landscape tiles are saved with their top and line', () => {
    const d = field([terrainNode('ground', 150, 150, 90, 'g', { surface: 'road', line: 'turn' }), water(450, 150)])
    const back = sceneNodes(parseDoc(serializeDoc(d)), 'robo') as PrimNode[]
    expect(back[0].params.terrain).toEqual({ kind: 'ground', height: GROUND_HEIGHT, surface: 'road', line: 'turn' })
    expect(back[1].params.terrain).toEqual({ kind: 'water', height: WATER_LEVEL })
    // a line is only kept on a road
    const grass = sceneNodes(parseDoc(serializeDoc(field([terrainNode('ground', 0, 0, 0, 'g', { surface: 'grass', line: 'straight' })]))), 'robo') as PrimNode[]
    expect(grass[0].params.terrain!.line).toBeUndefined()
  })
})

describe('the line sensor on landscape tiles', () => {
  it('sees the line of a road, and how light grass, sand and water are', () => {
    const still = (x: number, y: number, deg: number) => {
      const r = driver(x, y, deg, 0)
      r.params.robot!.sensors = [{ port: 2, type: 'line' }]
      return r
    }
    const read = (nodes: DocNode[], bot: PrimNode) => {
      const w = RoboWorld.fromDoc(field([...nodes, bot]))
      w.refresh()
      return w.robots[0].readings.get(2)!
    }
    // a road along Y with its line under the sensor (the sensor is ahead of the robot's centre)
    const road = terrainNode('ground', 150, 150, 0, 'road', { surface: 'road', line: 'straight' })
    expect(read([road], still(150, 90, 90))).toBeLessThan(10)
    // beside the line: the road itself
    expect(read([road], still(240, 90, 90))).toBeGreaterThan(80)
    expect(read([ground(150, 150, 'grass')], still(150, 90, 90))).toBe(62)
    expect(read([ground(150, 150, 'sand')], still(150, 90, 90))).toBe(86)
  })

  it('a line follower follows a road made of landscape tiles', async () => {
    const { lineFollowerProgram } = await import('@/core/robotics/demo')
    const tiles = [0, 1, 2, 3, 4].map((i) => terrainNode('ground', 150 + i * 300, 150, 90, 'road', { surface: 'road', line: 'straight' }))
    const r = robotNode(-60, 150, 0, 'R', lineFollowerProgram())
    r.params.robot!.sensors = [{ port: 1, type: 'line' }, { port: 3, type: 'line' }]
    const w = RoboWorld.fromDoc(field([...tiles, r]))
    w.run(8)
    const bot = w.robots[0]
    expect(bot.pose.x).toBeGreaterThan(700)
    expect(Math.abs(bot.pose.y - 150)).toBeLessThan(40)
  })

  it('the stored parameters are normalised: fixed heights, a line only on a road', () => {
    expect(normTerrain({ kind: 'ground', height: 99, surface: 'sand', line: 'straight' })).toEqual({ kind: 'ground', height: GROUND_HEIGHT, surface: 'sand' })
    expect(normTerrain({ kind: 'ground', height: 0, surface: 'road', line: 'turn' })).toEqual({ kind: 'ground', height: GROUND_HEIGHT, surface: 'road', line: 'turn' })
    expect(normTerrain({ kind: 'ground', height: 0, surface: 'road', line: 'none' })).toEqual({ kind: 'ground', height: GROUND_HEIGHT, surface: 'road' })
    expect(normTerrain({ kind: 'water', height: 50 })).toEqual({ kind: 'water', height: WATER_LEVEL })
    expect(normTerrain({ kind: 'ramp', height: 1000, length: 5 })).toEqual({ kind: 'ramp', height: 300, length: 2 })
  })

  it('painting lays one tile per cell, changes it, keeps a road line, and erases it', () => {
    const name = () => 'x'
    let d = field([])
    d = paintLand(d, 120, 40, 'grass', name).doc
    d = paintLand(d, 170, 260, 'grass', name).doc // the same cell
    expect(d.nodes.length).toBe(1)
    const tile = landAt(d, 150, 150)!
    expect(tile.transform.position).toEqual([150, 150, 0])
    expect(tile.color).toBe(LAND_COLOR.grass)
    const same = paintLand(d, 150, 150, 'grass', name)
    expect(same.doc).toBe(d)
    d = paintLand(d, 150, 150, 'road', name).doc
    d = { ...d, nodes: d.nodes.map((n) => (n.kind === 'prim' ? { ...n, params: { terrain: { ...n.params.terrain!, line: 'cross' as const } } } : n)) }
    d = paintLand(d, 150, 150, 'water', name).doc
    expect(landAt(d, 150, 150)!.params.terrain).toEqual({ kind: 'water', height: WATER_LEVEL })
    expect(landAt(d, 150, 150)!.id).toBe(tile.id)
    d = paintLand(d, 150, 150, 'road', name).doc
    expect(landAt(d, 150, 150)!.params.terrain!.line).toBeUndefined()
    d = paintLand(d, -10, 10, 'sand', name).doc
    expect(landAt(d, -150, 150)).not.toBeNull()
    d = paintLand(d, 150, 150, null, name).doc
    expect(landAt(d, 150, 150)).toBeNull()
    expect(d.nodes.length).toBe(1)
  })

  it('the cells under a platform are not painted', () => {
    const d = field([terrainNode('platform', 150, 150, 0, 'p')])
    expect(paintLand(d, 150, 150, 'grass', () => 'x').doc).toBe(d)
    expect(paintLand(d, 450, 150, 'grass', () => 'x').doc.nodes.length).toBe(2)
  })

  it('Shift: a rectangle of cells; Ctrl: a straight line with no corner-only steps', () => {
    expect(rectCells([0, 0], [2, 1]).length).toBe(6)
    expect(rectCells([2, 1], [0, 0]).length).toBe(6)
    expect(rectCells([0, 0], [500, 0]).length).toBe(MAX_SPAN)
    expect(lineCells([0, 0], [4, 0])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]])
    const slant = lineCells([0, 0], [3, 2])
    expect(slant[0]).toEqual([0, 0])
    expect(slant[slant.length - 1]).toEqual([3, 2])
    for (let i = 1; i < slant.length; i++) expect(Math.abs(slant[i][0] - slant[i - 1][0]) + Math.abs(slant[i][1] - slant[i - 1][1])).toBe(1)
  })

  it('many cells are painted at once like one by one: new, changed, kept, skipped under a platform, erased', () => {
    let d = field([ground(150, 150, 'sand'), terrainNode('platform', 450, 450, 0, 'p')])
    d = paintCells(d, rectCells([0, 0], [2, 2]), 'grass', (k) => `g${k}`, (k) => k)
    const tiles = d.nodes.filter((n) => n.kind === 'prim' && n.params.terrain?.kind === 'ground')
    expect(tiles.length).toBe(8)
    expect(landAt(d, 150, 150)!.params.terrain!.surface).toBe('grass')
    expect(landAt(d, 450, 450)).toBeNull()
    expect(paintCells(d, rectCells([0, 0], [2, 2]), 'grass', () => 'x')).toBe(d)
    d = paintCells(d, lineCells([0, 1], [2, 1]), null, () => 'x')
    expect(landAt(d, 150, 450)).toBeNull()
    expect(landAt(d, 150, 150)).not.toBeNull()
  })
})
