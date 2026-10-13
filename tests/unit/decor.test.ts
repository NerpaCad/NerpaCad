import { describe, expect, it } from 'vitest'
import { emptyDoc, type Doc, type DocNode, type PrimNode, type DecorKind } from '@/core/doc/model'
import { robotNode, terrainNode, workspaceJson, start } from '@/core/robotics/demo'
import { RoboWorld } from '@/core/robotics/world'
import { postsOf } from '@/core/robotics/decor'
import { Physics, initPhysics } from '@/core/robotics/physics'
import { parseDoc, serializeDoc } from '@/core/io/formats'
import type { BlockJson } from '@/core/robotics/interpreter'

let bid = 0
const blk = (type: string, inputs: Record<string, unknown> = {}): BlockJson => ({ type, id: `b${++bid}`, inputs, fields: {} }) as BlockJson
const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const field = (nodes: DocNode[]): Doc => ({ ...emptyDoc(), scene: 'robo', nodes })
const driver = (x: number, y: number, deg: number, power = 80): PrimNode =>
  robotNode(x, y, deg, 'R', workspaceJson([start([blk('robo_motors', { LEFT: n(power), RIGHT: n(power) })])]))
const decor = (kind: DecorKind, x: number, y: number, z = 0): PrimNode => ({
  id: `d-${kind}-${x}`,
  kind: 'prim',
  prim: 'decor',
  name: kind,
  color: '#4f9a3a',
  isHole: false,
  params: { decor: { kind } },
  transform: { position: [x, y, z], rotation: [0, 0, 0], scale: [1, 1, 1] }
})
const drive = (nodes: DocNode[], seconds: number) => {
  const w = RoboWorld.fromDoc(field(nodes))
  for (let i = 0; i < seconds * 120; i++) w.step()
  return w.robots[0]
}

describe('scenery', () => {
  it('blocks the way as round posts (flowers do not)', () => {
    const posts = postsOf(field([decor('tree', 0, 0), decor('rock', 300, 0, 10), decor('flowers', 600, 0)]))
    expect(posts.map((p) => p.kind)).toEqual(['post', 'post'])
    // a post stands on what is under it (here a 10 mm landscape tile): its base, then its own height
    expect(posts[1].base).toBe(10)
    expect(posts[1].height).toBe(55)
    expect(posts.map((p) => p.decor)).toEqual(['tree', 'rock'])
  })

  it('a robot stops at a rock and a tree trunk, and drives over flowers', () => {
    const atRock = drive([decor('rock', 600, 0), driver(0, 0, 0)], 6)
    expect(atRock.pose.x).toBeLessThan(600 - 44)
    expect(atRock.pose.x).toBeGreaterThan(400)
    const atTree = drive([decor('tree', 600, 0), driver(0, 0, 0)], 6)
    expect(atTree.pose.x).toBeLessThan(600 - 20)
    expect(atTree.pose.x).toBeGreaterThan(450)
    const flowers = drive([decor('flowers', 400, 0), driver(0, 0, 0)], 6)
    expect(flowers.pose.x).toBeGreaterThan(400 + 45 + 100)
  })

  it('a bush on a grass tile stands on it and still blocks', () => {
    const r = drive([terrainNode('ground', 750, 150, 0, 'g', { surface: 'grass' }), decor('bush', 750, 150, 10), driver(150, 150, 0)], 6)
    expect(r.pose.x).toBeLessThan(750 - 52)
    expect(r.z).toBeCloseTo(10, 0)
  })

  it('the sonar sees a rock', async () => {
    await initPhysics()
    const r = driver(0, 0, 0, 0)
    r.params.robot!.sensors = [{ port: 1, type: 'ultrasonic' }]
    const w = RoboWorld.fromDoc(field([decor('rock', 500, 0), r]))
    const ph = new Physics([], w.robots, w.seals, w.terrain)
    w.probe = ph
    w.step()
    const cm = w.robots[0].readings.get(1)!
    ph.dispose()
    expect(cm).toBeGreaterThan(30)
    expect(cm).toBeLessThan(48)
  })

  it('goes into a file and comes back; a broken one is refused', () => {
    const d = field([decor('pine', 100, 200), decor('flowers', -100, 0)])
    const back = parseDoc(serializeDoc(d))
    const all = [...back.nodes, ...(back.parked ?? [])] as PrimNode[]
    expect(all.filter((x) => x.prim === 'decor').map((x) => x.params.decor!.kind).sort()).toEqual(['flowers', 'pine'])
    const bad = serializeDoc(d).replaceAll('"pine"', '"palm"')
    expect(() => parseDoc(bad)).toThrow()
  })
})
