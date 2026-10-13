import { describe, expect, it } from 'vitest'
import { emptyDoc, sceneNodes, type Doc, type DocNode, type PrimNode } from '@/core/doc/model'
import { robotNode, terrainNode, tileNode, workspaceJson, start } from '@/core/robotics/demo'
import { RoboWorld, tilesOf, terrainOf } from '@/core/robotics/world'
import { SimCreature } from '@/core/robotics/nerpa'
import { blackAt } from '@/core/robotics/sensors'
import { BRIDGE_DECK, nearestSurface, placedTerrain, snapTerrain, stance, turnedCentre, supportAt, surfacesAt, topAt, wallAt } from '@/core/robotics/terrain'
import { parseDoc, serializeDoc } from '@/core/io/formats'
import { settleOnTerrain, turnTerrainPieces } from '@/core/robotics/field'
import { Physics, initPhysics } from '@/core/robotics/physics'
import type { BlockJson } from '@/core/robotics/interpreter'

let bid = 0
const blk = (type: string, inputs: Record<string, unknown> = {}, fields: Record<string, unknown> = {}): BlockJson => ({ type, id: `b${++bid}`, inputs, fields }) as BlockJson
const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const field = (nodes: DocNode[]): Doc => ({ ...emptyDoc(), scene: 'robo', nodes })
/** a robot driving straight at full power, facing `deg` */
const driver = (x: number, y: number, deg: number, power = 100): PrimNode => {
  const r = robotNode(x, y, deg, 'R', workspaceJson([start([blk('robo_motors', { LEFT: n(power), RIGHT: n(power) })])]))
  r.params.robot!.sensors = [{ port: 2, type: 'line' }]
  return r
}

// a ramp two tiles long rising toward +Y (y 0…600) up to a platform (y 600…900), both 12 cm high
const ramp = () => terrainNode('ramp', 150, 300, 0, 'ramp')
const platform = (y = 750) => terrainNode('platform', 150, y, 0, 'platform')

describe('terrain geometry', () => {
  it('ramps rise along their length; platforms are solid; bridges are only a deck', () => {
    const r = placedTerrain('r', { kind: 'ramp', height: 120, length: 2 }, 150, 300, 0)
    expect(topAt(r, 150, 0)).toBeCloseTo(0)
    expect(topAt(r, 150, 300)).toBeCloseTo(60)
    expect(topAt(r, 150, 600)).toBeCloseTo(120)
    expect(topAt(r, 150, 700)).toBeNull()
    const b = placedTerrain('b', { kind: 'bridge', height: 120 }, 150, 150, 0)
    const p = placedTerrain('p', { kind: 'platform', height: 120 }, 450, 150, 0)
    expect(surfacesAt([b], 150, 150).map((s) => s.z)).toEqual([0, 120])
    expect(surfacesAt([p], 450, 150).map((s) => s.z)).toEqual([120])
    expect(wallAt([p], 450, 150, 0, 58)).toBe(true)
    expect(wallAt([b], 150, 150, 0, 58)).toBe(false) // passes under
    expect(wallAt([b], 150, 150, 0, 120 - BRIDGE_DECK + 5)).toBe(true) // too tall for it
    expect(supportAt([b], 150, 150, 0)).toBe(0)
    expect(supportAt([b], 150, 150, 120)).toBe(120)
    // a turned ramp rises the other way
    const turned = placedTerrain('t', { kind: 'ramp', height: 120, length: 1 }, 150, 150, Math.PI / 2)
    expect(topAt(turned, 0, 150)).toBeCloseTo(120)
    expect(topAt(turned, 300, 150)).toBeCloseTo(0)
  })

  it('a two-tile ramp turns around its high cell; four turns bring it back', () => {
    let c: [number, number] = [150, 300]
    const seen: string[] = []
    for (let k = 0; k < 4; k++) {
      c = turnedCentre(c[0], c[1], (k * Math.PI) / 2, ((k + 1) * Math.PI) / 2, 2)
      const high = [c[0] - Math.sin(((k + 1) * Math.PI) / 2) * 150, c[1] + Math.cos(((k + 1) * Math.PI) / 2) * 150]
      expect(high[0]).toBeCloseTo(150)
      expect(high[1]).toBeCloseTo(450)
      seen.push(c.join(','))
    }
    expect(c).toEqual([150, 300])
    expect(new Set(seen).size).toBe(4)
    expect(turnedCentre(160, 140, 0, Math.PI / 2, 1)).toEqual([150, 150])
  })

  it('snaps to whole cells; a two-tile ramp has its centre on a cell edge', () => {
    expect(snapTerrain(170, 420, 0, 1)).toEqual([150, 450])
    expect(snapTerrain(170, 420, 0, 2)).toEqual([150, 300])
    expect(snapTerrain(170, 420, Math.PI / 2, 2)).toEqual([300, 450])
  })

  it('a robot on the slope leans nose up', () => {
    const r = placedTerrain('r', { kind: 'ramp', height: 120, length: 2 }, 150, 300, 0)
    const st = stance([r], 150, 300, Math.PI / 2, 60, 85, 58, 5)
    expect(st.blocked).toBe(false)
    expect(st.z).toBeCloseTo(60, 0)
    expect(st.pitch).toBeCloseTo(Math.atan(120 / 600), 2)
    expect(Math.abs(st.roll)).toBeLessThan(1e-6)
  })
})

describe('robots on terrain', () => {
  it('drives up a ramp onto a platform, leaning on the way, then falls off its far edge', () => {
    const w = RoboWorld.fromDoc(field([ramp(), platform(), driver(150, -200, 90)]))
    const r = w.robots[0]
    let maxPitch = 0
    w.run(4.8, () => (maxPitch = Math.max(maxPitch, r.pitch)))
    expect(maxPitch).toBeGreaterThan(0.15)
    // on the platform (y 600…900) at its height
    expect(r.pose.y).toBeGreaterThan(620)
    expect(r.pose.y).toBeLessThan(900)
    expect(r.z).toBeCloseTo(120, 0)
    expect(r.pitch).toBeCloseTo(0, 3)
    w.run(1.5)
    expect(r.pose.y).toBeGreaterThan(950)
    expect(r.z).toBe(0)
  })

  it('stops at the wall of a platform (it cannot climb 12 cm)', () => {
    const w = RoboWorld.fromDoc(field([platform(150), driver(600, 150, 180)]))
    const r = w.robots[0]
    w.run(3)
    // the platform spans x 0…300: the robot's front stops at its wall
    expect(r.pose.x).toBeGreaterThan(300)
    expect(r.pose.x).toBeLessThan(420)
    expect(r.z).toBe(0)
  })

  it('passes under a bridge, and drives over it between two platforms', () => {
    const bridge = terrainNode('bridge', 150, 450, 0, 'bridge')
    const under = RoboWorld.fromDoc(field([bridge, driver(-300, 450, 0)]))
    under.run(4)
    expect(under.robots[0].pose.x).toBeGreaterThan(400)
    expect(under.robots[0].z).toBe(0)
    // ramp → platform → bridge → platform
    const over = RoboWorld.fromDoc(field([ramp(), platform(750), terrainNode('bridge', 150, 1050, 0, 'b'), platform(1350), driver(150, -200, 90)]))
    const r = over.robots[0]
    let lowest = Infinity
    over.run(8, () => r.pose.y > 700 && r.pose.y < 1400 && (lowest = Math.min(lowest, r.z)))
    expect(lowest).toBeCloseTo(120, 0)
    expect(r.pose.y).toBeGreaterThan(1250)
  })

  it('a robot put on a platform stands on it', () => {
    const w = RoboWorld.fromDoc(field([platform(150), driver(150, 150, 0, 0)]))
    expect(w.robots[0].z).toBe(120)
  })
})

describe('tiles on terrain and the line sensor', () => {
  it('a tile on a ramp follows its slope; the robot on the ramp sees the line', () => {
    const t1 = tileNode({ kind: 'straight', x: 150, y: 150, angle: 0 }, 't1')
    const t2 = tileNode({ kind: 'straight', x: 150, y: 450, angle: 0 }, 't2')
    t1.transform.position[2] = 30
    t2.transform.position[2] = 90
    const d = field([ramp(), t1, t2, driver(150, 200, 90, 0)])
    const tiles = tilesOf(d)
    expect(tiles.every((t) => t.ramp)).toBe(true)
    const w = RoboWorld.fromDoc(d)
    // the front line sensor looks at the black centre line
    expect(w.robots[0].readings.get(2)).toBeLessThan(20)
  })

  it('on and under a bridge each level has its own line', () => {
    const terrain = terrainOf(field([terrainNode('bridge', 150, 150, 0, 'b')]))
    // a crossing line on the floor under the bridge, a straight one (along X) on the deck
    const floorTile = tileNode({ kind: 'straight', x: 150, y: 150, angle: 0 }, 'floor')
    const deckTile = tileNode({ kind: 'straight', x: 150, y: 150, angle: 90 }, 'deck')
    deckTile.transform.position[2] = 120
    const tiles = tilesOf(field([terrainNode('bridge', 150, 150, 0, 'b'), floorTile, deckTile]), terrain)
    expect(tiles.map((t) => t.z)).toEqual([0, 120])
    // a point on the floor line but off the deck line
    expect(blackAt(tiles, 150, 60, 0)).toBe(true)
    expect(blackAt(tiles, 150, 60, 120)).toBe(false)
    // and the other way round
    expect(blackAt(tiles, 60, 150, 0)).toBe(false)
    expect(blackAt(tiles, 60, 150, 120)).toBe(true)
    expect(nearestSurface(terrain, 150, 150, 10).z).toBe(0)
  })
})

describe('falling and turning beside terrain', () => {
  it('drives off a platform at any angle and lands; after landing next to it, it can turn in place', () => {
    for (const deg of [0, 10, 20, 30, 45, 60, 75]) {
      const bot = driver(150, 150, deg)
      bot.transform.position[2] = 120
      const w = RoboWorld.fromDoc(field([platform(150), bot]))
      const r = w.robots[0]
      w.run(3)
      expect(r.z, `heading ${deg}°`).toBe(0)
      expect(Math.hypot(r.pose.x - 150, r.pose.y - 150), `heading ${deg}°`).toBeGreaterThan(300)
    }
    // stopped right beside the platform it fell off: turning in place is free
    const bot = driver(150, 150, 0)
    bot.transform.position[2] = 120
    const w = RoboWorld.fromDoc(field([platform(150), bot]))
    const r = w.robots[0]
    while (r.z > 0 || r.pose.x < 300) w.step()
    r.left = -50
    r.right = 50
    ;(w as any).programs = () => []
    const th = r.pose.theta
    for (let i = 0; i < 60; i++) w.step()
    expect(Math.abs(r.pose.theta - th)).toBeGreaterThan(0.3)
  })

  it('crosses a bridge at an angle without hanging in the air', () => {
    const bot = driver(150, 750, 70)
    bot.transform.position[2] = 120
    const w = RoboWorld.fromDoc(field([platform(750), terrainNode('bridge', 150, 1050, 0, 'b'), platform(1350), bot]))
    const r = w.robots[0]
    w.run(4)
    // it goes off the side of the bridge or the far platform and ends up on the floor
    expect(r.z).toBe(0)
  })

  it('a seal sent onto a platform with "go to" stands on it and can walk off', () => {
    const w = RoboWorld.fromDoc(field([platform(150), { ...driver(0, 0, 0), prim: 'nerpa', params: { nerpa: {} }, id: 'seal', transform: { position: [600, 150, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } as PrimNode]))
    const s: SimCreature = w.seals[0].seal
    s.goTo(150, 150)
    w.step()
    expect(s.z).toBe(120)
    s.walk(300)
    w.run(4)
    expect(s.x).toBeGreaterThan(330)
    expect(s.z).toBe(0)
  })
})

describe('turning terrain together', () => {
  it('a ramp and its platform turned together around a point stay joined', () => {
    const r = ramp()
    const p = platform()
    const before = field([r, p])
    const turned: Doc = { ...before, nodes: before.nodes.map((n) => ({ ...n, transform: { ...n.transform, rotation: [0, 0, 90] as [number, number, number] } })) }
    const after = turnTerrainPieces(before, turned, [r.id, p.id], [150, 450])
    const pos = (id: string) => after.nodes.find((n) => n.id === id)!.transform.position
    expect(pos(r.id)).toEqual([300, 450, 0])
    expect(pos(p.id)).toEqual([-150, 450, 0])
    // the ramp's high end (x = 0) meets the platform (x −300…0)
    const t = terrainOf(after)
    expect(topAt(t[0], 5, 450)).toBeCloseTo(119, 0)
    expect(topAt(t[1], -5, 450)).toBe(120)
  })
})

describe('the touch sensor on terrain', () => {
  it('is not pressed at the foot of a ramp it drives up, but is at a platform wall', async () => {
    await initPhysics()
    const touchy = (x: number, y: number, deg: number) => {
      const r = driver(x, y, deg, 60)
      r.params.robot!.sensors = [{ port: 2, type: 'touch' }]
      return r
    }
    const run = (nodes: DocNode[], seconds: number) => {
      const w = RoboWorld.fromDoc(field(nodes))
      const ph = new Physics([], w.robots, w.seals, w.terrain)
      w.probe = ph
      let pressed = 0
      const steps = Math.round(seconds * 120)
      for (let i = 0; i < steps; i++) {
        w.step()
        ph.step(1 / 120, w.robots, w.seals)
        pressed = Math.max(pressed, w.robots[0].readings.get(2) ?? 0)
      }
      ph.dispose()
      return { pressed, r: w.robots[0] }
    }
    // a short, steep ramp (one tile, 12 cm) up to a platform
    const up = run([terrainNode('ramp', 150, 150, 0, 'r', { length: 1 }), platform(450), touchy(150, -250, 90)], 7)
    expect(up.r.z).toBeCloseTo(120, 0)
    expect(up.pressed).toBe(0)
    const wall = run([platform(150), touchy(600, 150, 180)], 3)
    expect(wall.pressed).toBe(1)
  })
})

describe('the seal on terrain', () => {
  it('walks up a ramp and bumps into a wall', () => {
    const prog = workspaceJson([start([blk('nerpa_walk', { CM: n(120) })])])
    const seal = (x: number, y: number, deg: number): PrimNode => ({
      id: `s${x}`,
      kind: 'prim',
      prim: 'nerpa',
      name: 'N',
      color: '#888888',
      isHole: false,
      params: { nerpa: { program: prog } },
      transform: { position: [x, y, 0], rotation: [0, 0, deg], scale: [1, 1, 1] }
    })
    const up = RoboWorld.fromDoc(field([ramp(), platform(), seal(150, -100, 90)]))
    let top = 0
    up.run(9, () => (top = Math.max(top, up.seals[0].seal.z)))
    const s: SimCreature = up.seals[0].seal
    // up the ramp, over the platform and down off its far edge
    expect(top).toBeCloseTo(120, 0)
    expect(s.y).toBeGreaterThan(1000)
    expect(s.z).toBe(0)
    const wall = RoboWorld.fromDoc(field([platform(150), seal(700, 150, 180)]))
    wall.run(9)
    const s2 = wall.seals[0].seal
    expect(s2.x).toBeGreaterThan(300)
    expect(s2.z).toBe(0)
  })
})

describe('files', () => {
  it('saves and loads platforms, ramps and bridges; bad values are fixed or rejected', () => {
    const d = field([ramp(), platform(), terrainNode('bridge', 450, 750, 90, 'b', { height: 999 })])
    const back = sceneNodes(parseDoc(serializeDoc(d)), 'robo')
    const t = back.filter((x) => x.kind === 'prim' && x.prim === 'terrain') as PrimNode[]
    expect(t.map((x) => x.params.terrain!.kind)).toEqual(['ramp', 'platform', 'bridge'])
    expect(t[0].params.terrain!.length).toBe(2)
    expect(t[2].params.terrain!.height).toBe(300)
    const bad = JSON.parse(serializeDoc(d))
    const list = bad.doc.robo
    list[0].params.terrain.kind = 'volcano'
    expect(() => parseDoc(JSON.stringify(bad))).toThrow()
  })
})

describe('editing the field', () => {
  const at = (d: Doc, id: string) => d.nodes.find((x) => x.id === id)!.transform.position[2]
  const withParams = (d: Doc, id: string, height: number): Doc => ({
    ...d,
    nodes: d.nodes.map((x) => (x.id === id && x.kind === 'prim' ? { ...x, params: { terrain: { ...x.params.terrain!, height } } } : x))
  })
  it('things on a piece follow it when it is made taller, removed, or put under them', () => {
    const p = platform(150)
    const r = driver(150, 150, 0)
    r.transform.position[2] = 120
    const box = driver(150, 150, 0)
    box.transform.position[2] = 180 // resting on something else: left alone
    const d0 = field([p, r, box])
    const taller = settleOnTerrain(d0, withParams(d0, p.id, 200))
    expect(at(taller, r.id)).toBe(200)
    expect(at(taller, box.id)).toBe(180)
    const gone = settleOnTerrain(d0, { ...d0, nodes: d0.nodes.filter((x) => x.id !== p.id) })
    expect(at(gone, r.id)).toBe(0)
    // a platform added under a robot on the floor lifts it; a bridge over it does not
    const floorBot = driver(150, 150, 0)
    const bare = field([floorBot])
    expect(at(settleOnTerrain(bare, field([floorBot, platform(150)])), floorBot.id)).toBe(120)
    expect(at(settleOnTerrain(bare, field([floorBot, terrainNode('bridge', 150, 150, 0, 'b')])), floorBot.id)).toBe(0)
    // nothing changed in the terrain: the very same document
    expect(settleOnTerrain(d0, d0)).toBe(d0)
  })
})
