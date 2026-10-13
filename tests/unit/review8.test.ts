/**
 * Regression tests for what the independent review of 0.15 + 0.2 (stage 8) found in the
 * simulation: fliers and bridges, a cheetah on a ramp, non-swimmers and water, messages,
 * scenery on raised pieces, hops under low decks, "go to" and the landscape brush.
 */
import { describe, expect, it } from 'vitest'
import { emptyDoc, newId, type DecorKind, type Doc, type DocNode, type PrimNode, type Species } from '@/core/doc/model'
import { islandDoc, nerpaNode, robotNode, start, terrainNode, workspaceJson } from '@/core/robotics/demo'
import { RoboWorld } from '@/core/robotics/world'
import { type BlockJson, type NerpaIO, Program } from '@/core/robotics/interpreter'
import type { SimCreature } from '@/core/robotics/nerpa'
import { changeLand, landAt, oneLandPerCell, paintCells, paintLand } from '@/core/robotics/land'
import { topSurface } from '@/core/robotics/terrain'
import { terrainOf } from '@/core/robotics/world'
import { parseDoc } from '@/core/io/formats'
import { withScene } from '@/core/doc/model'
import { readFileSync } from 'fs'
import ru from '@/i18n/ru.json'

let bid = 0
const blk = (type: string, inputs: Record<string, unknown> = {}, fields: Record<string, unknown> = {}): BlockJson =>
  ({ type, id: `r${++bid}`, inputs, fields }) as BlockJson
const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const c = (i: number) => 150 + 300 * i
const hero = (species: Species, x: number, y: number, body: BlockJson[], z = 0, deg = 0) => {
  const h = nerpaNode(x, y, deg, species, workspaceJson([start(body)]), species)
  h.transform = { ...h.transform, position: [x, y, z] }
  return h
}
const bridge = (i: number, height: number) => terrainNode('bridge', c(i), c(0), 0, 'b', { height })
const decorNode = (kind: DecorKind, x: number, y: number, z: number): PrimNode => ({
  id: newId(),
  kind: 'prim',
  prim: 'decor',
  name: kind,
  color: '#888888',
  isHole: false,
  params: { decor: { kind } },
  transform: { position: [x, y, z], rotation: [0, 0, 0], scale: [1, 1, 1] }
})
const doc = (nodes: DocNode[]): Doc => ({ ...emptyDoc(), scene: 'robo', nodes })
const world = (nodes: DocNode[]) => RoboWorld.fromDoc(doc(nodes))
/** what a hero's blocks call (the world keeps it to itself) */
const io = (w: RoboWorld, s: SimCreature) => (w as unknown as { nerpaIO(s: SimCreature): NerpaIO }).nerpaIO(s)
/** run `seconds`, calling `each` after every physics step */
const run = (w: RoboWorld, seconds: number, each?: () => void) => {
  for (let k = 0; k < Math.round(seconds * 120); k++) {
    w.step()
    each?.()
  }
}

describe('Геннадий and bridges', () => {
  it('taking off under a bridge he stays under its deck', () => {
    const w = world([bridge(0, 200), hero('pigeon', c(0), c(0), [blk('pigeon_takeoff', { CM: n(5) })])])
    const s = w.seals[0].seal
    let top = 0
    run(w, 3, () => (top = Math.max(top, s.z)))
    expect(top).toBeLessThan(200 - 15)
    expect(s.z).toBeCloseTo(50, 0)
    expect(w.under(s)).toBe('air')
  })

  it('flying low toward a high bridge he passes under it, not up onto it', () => {
    const w = world([bridge(2, 300), hero('pigeon', c(0), c(0), [blk('pigeon_takeoff', { CM: n(5) }), blk('pigeon_fly', { CM: n(120) })])])
    const s = w.seals[0].seal
    let top = 0
    run(w, 8, () => (top = Math.max(top, s.z)))
    expect(s.x).toBeGreaterThan(c(2) + 150)
    expect(top).toBeLessThan(100)
  })

  it('landing under a bridge he comes down to the floor; his height counts from the floor', () => {
    const w = world([bridge(0, 300), hero('pigeon', c(0), c(0), [blk('pigeon_takeoff', { CM: n(5) })])])
    const s = w.seals[0].seal
    run(w, 3)
    expect(io(w, s).altitude()).toBeCloseTo(50, 0)
    io(w, s).land()
    run(w, 3)
    expect(s.z).toBeCloseTo(0, 3)
    expect(s.flying).toBe(false)
  })
})

describe('Читик on a ramp', () => {
  it('after crawling onto a ramp (nothing over him) he stands up and can leap', () => {
    // a two-tile ramp rising to +X from x = 300
    const ramp = terrainNode('ramp', c(1) + 150, c(0), -90, 'r', { height: 120, length: 2 })
    const w = world([ramp, hero('cheetah', c(0), c(0), [blk('cheetah_crawl', { CM: n(35) }), blk('robo_wait', { SECONDS: n(1) })])])
    const s = w.seals[0].seal
    run(w, 6)
    expect(s.z).toBeGreaterThan(20)
    expect(s.crouched).toBe(false)
  })
})

describe('who cannot swim stays out of the water', () => {
  const sea = [0, 1, 2, 3].map((i) => terrainNode('water', c(i), c(0), 0, 'w'))
  it('"go to" into water: Читик stays where he is and says so', () => {
    const w = world([...sea.slice(1), hero('cheetah', c(0), c(0), [blk('nerpa_goto', { X: n(c(2) / 10), Y: n(c(0) / 10) }), blk('nerpa_walk', { CM: n(60) })])])
    const s = w.seals[0].seal
    run(w, 4)
    expect(s.x).toBeLessThan(c(0) + 150)
    expect(s.wet).toBe(false)
    expect(io(w, s).inWater()).toBe(false)
  })

  it('a robot put in the water does not drive through it; the seal swims', () => {
    const r = robotNode(c(1), c(0), 0, 'r', workspaceJson([start([blk('robo_motors', { LEFT: n(50), RIGHT: n(50) })])]))
    const w = world([...sea, r])
    run(w, 3)
    expect(Math.abs(w.robots[0].pose.x - c(1))).toBeLessThan(1)
    const seal = world([...sea, hero('seal', c(0), c(0), [blk('nerpa_walk', { CM: n(60) })])])
    run(seal, 4)
    expect(seal.seals[0].seal.x).toBeGreaterThan(c(2) - 10)
    expect(seal.seals[0].seal.wet).toBe(true)
  })
})

describe('messages: "broadcast and wait"', () => {
  it('waits for a script started again by the same message until it is really over', () => {
    const when = (msg: string, body: BlockJson[]): BlockJson => {
      for (let i = body.length - 2; i >= 0; i--) body[i].next = { block: body[i + 1] }
      return { type: 'msg_when', id: `h${++bid}`, fields: { MSG: msg }, next: { block: body[0] } }
    }
    const setTimer = blk('variables_set', { VALUE: { block: blk('robo_timer') } }, { VAR: { id: 'T' } })
    const sender = start([blk('msg_send_wait', {}, { MSG: 'x' }), setTimer])
    const again = start([blk('robo_wait', { SECONDS: n(0.5) }), blk('msg_send', {}, { MSG: 'x' })])
    const receiver = when('x', [blk('robo_wait', { SECONDS: n(1) })])
    const ps: Program[] = []
    const broadcast = (name: string) => {
      const d = ps.map((p) => p.receive(name))
      return () => d.every((x) => x())
    }
    ps.push(new Program({ blocks: { blocks: [sender, again, receiver] }, variables: [{ id: 'T' }] }, { broadcast }))
    for (let i = 0; i < 180; i++) ps[0].tick(1 / 60)
    // the receiver was started again at 0.5 s: it ends at 1.5 s, and so does the waiting
    expect(Number(ps[0].vars.get('T'))).toBeGreaterThan(1.45)
  })

  it('a script started again by a message stops the walk it was making', () => {
    const go = (body: BlockJson[]): BlockJson => {
      for (let i = body.length - 2; i >= 0; i--) body[i].next = { block: body[i + 1] }
      return { type: 'msg_when', id: `h${++bid}`, fields: { MSG: 'go' }, next: { block: body[0] } }
    }
    const program = {
      blocks: {
        blocks: [
          start([blk('msg_send', {}, { MSG: 'go' }), blk('robo_wait', { SECONDS: n(0.5) }), blk('msg_send', {}, { MSG: 'go' })]),
          go([blk('robo_wait', { SECONDS: n(0.2) }), blk('nerpa_walk', { CM: n(100) })])
        ]
      }
    }
    const s = nerpaNode(c(0), c(0), 0, 'seal', program, 'seal')
    const w = world([s])
    const seal = w.seals[0].seal
    // the first walk is stopped at 0.5 s; the second starts 0.2 s later and walks the whole metre
    run(w, 0.6)
    const at = seal.x
    run(w, 0.1)
    expect(Math.abs(seal.x - at)).toBeLessThan(1)
    run(w, 10)
    expect(seal.x - c(0)).toBeCloseTo((at - c(0)) + 1000, -1)
  })
})

describe('scenery on raised pieces', () => {
  it('a tree on a bridge deck does not block the way under the bridge', () => {
    const tree = decorNode('tree', c(2), c(0), 200)
    const r = robotNode(c(0), c(0), 0, 'r', workspaceJson([start([blk('robo_motors', { LEFT: n(60), RIGHT: n(60) })])]))
    const w = world([bridge(2, 200), tree, r])
    run(w, 10)
    expect(w.robots[0].pose.x).toBeGreaterThan(c(2) + 150)
  })

  it('a tree is a perch, not a rock; Читик sent onto a trunk does not stand on its top', () => {
    const tree = decorNode('tree', c(1), c(0), 0)
    const w = world([tree, hero('pigeon', c(0), c(0), [blk('pigeon_fly_to', { X: n(c(1) / 10), Y: n(c(0) / 10) }), blk('pigeon_land')])])
    run(w, 8)
    const s = w.seals[0].seal
    expect(s.z).toBeCloseTo(300, 0)
    expect(w.under(s)).toBe('tree')
    const rock = decorNode('rock', c(2), c(0), 0)
    const cat = world([tree, rock, hero('cheetah', c(0), c(0), [blk('nerpa_goto', { X: n(c(1) / 10), Y: n(c(0) / 10) })])])
    run(cat, 1)
    expect(cat.seals[0].seal.z).toBeLessThan(20)
    const onRock = world([tree, rock, hero('cheetah', c(0), c(0), [blk('nerpa_goto', { X: n(c(2) / 10), Y: n(c(0) / 10) })])])
    run(onRock, 1)
    expect(onRock.under(onRock.seals[0].seal)).toBe('rock')
  })
})

describe('jumps under low decks, in the air, "go to"', () => {
  it('crouched under a bridge Читик does not hop through the deck; the seal under a low one neither', () => {
    const w = world([bridge(2, 150), hero('cheetah', c(0), c(0), [blk('cheetah_crawl', { CM: n(60) }), blk('nerpa_jump')])])
    const s = w.seals[0].seal
    let lift = 0
    run(w, 10, () => (lift = Math.max(lift, s.lift)))
    expect(Math.abs(s.x - c(2))).toBeLessThan(150)
    expect(lift).toBe(0)
    const seal = world([bridge(0, 120), hero('seal', c(0), c(0), [blk('nerpa_jump')])])
    let sealLift = 0
    run(seal, 2, () => (sealLift = Math.max(sealLift, seal.seals[0].seal.lift)))
    expect(sealLift).toBe(0)
  })

  it('falling off a platform the seal is in the air', () => {
    const w = world([terrainNode('platform', c(0), c(0), 0, 'p', { height: 300 }), hero('seal', c(0), c(0), [blk('nerpa_walk', { CM: n(40) })], 300)])
    const s = w.seals[0].seal
    let air = false
    run(w, 4, () => {
      if (s.z > 50 && s.z < 250 && w.under(s) === 'air') air = true
    })
    expect(air).toBe(true)
    expect(w.under(s)).toBe('floor')
  })

  it('"go to" a point under a bridge keeps the seal on the floor', () => {
    const w = world([bridge(2, 300), hero('seal', c(0), c(0), [blk('nerpa_goto', { X: n(c(2) / 10), Y: n(c(0) / 10) })])])
    run(w, 1)
    expect(w.seals[0].seal.z).toBeCloseTo(0, 3)
    expect(w.under(w.seals[0].seal)).toBe('floor')
  })

  it('Читик leaps forward under a high bridge (his arc stays low)', () => {
    const w = world([bridge(1, 300), hero('cheetah', c(0), c(0), [blk('cheetah_leap')])])
    run(w, 2)
    expect(w.seals[0].seal.x).toBeGreaterThan(c(0) + 250)
  })
})

describe('the island demo and the landscape brush', () => {
  const tr = (k: string) => (ru as Record<string, string>)[k] ?? k
  const onSurface = (d: Doc) => {
    const t = terrainOf(d)
    for (const a of d.nodes.filter((x) => x.kind === 'prim' && (x.prim === 'robot' || x.prim === 'nerpa'))) {
      const [x, y, z] = a.transform.position
      expect(z, a.name).toBeCloseTo(topSurface(t, x, y), 3)
    }
  }
  it('its robot and heroes stand on the tiles (the seal on the water), in the demo and in the example file', () => {
    onSurface(islandDoc(tr))
    onSurface(withScene(parseDoc(readFileSync('examples/island.nerpa', 'utf8')), 'robo'))
  })

  it('the brush leaves the ground under a platform as it is', () => {
    const grass = terrainNode('ground', c(0), c(0), 0, 'g', { surface: 'grass' })
    const platform = terrainNode('platform', c(0), c(0), 0, 'p', { height: 120 })
    const d = doc([grass, platform])
    expect(paintLand(d, c(0), c(0), 'water', () => 'w').doc).toBe(d)
    expect(paintLand(d, c(0), c(0), null, () => 'w').doc).toBe(d)
    expect(paintCells(d, [[0, 0]], 'sand', () => 's')).toBe(d)
    expect(paintCells(d, [[0, 0]], null, () => 's')).toBe(d)
  })

  it('one tile per cell: a copy put on a tile replaces it; changing a tile changes that one', () => {
    const a = terrainNode('ground', c(0), c(0), 0, 'a', { surface: 'grass' })
    const b = terrainNode('ground', c(1), c(0), 0, 'b', { surface: 'grass' })
    const prev = doc([a, b])
    const copy = { ...a, id: newId(), name: 'copy' }
    const next = oneLandPerCell(prev, doc([a, b, copy]))
    expect(next.nodes.map((x) => x.name)).toEqual(['b', 'copy'])
    expect(landAt(next, c(0), c(0))!.id).toBe(copy.id)
    // b dragged onto a's cell: b stays, a goes
    const moved = { ...b, transform: { ...b.transform, position: [c(0), c(0), 0] as [number, number, number] } }
    expect(oneLandPerCell(prev, doc([a, moved])).nodes.map((x) => x.name)).toEqual(['b'])
    expect(oneLandPerCell(prev, prev)).toBe(prev)
    const sand = changeLand(prev, b.id, 'sand')
    expect((sand.nodes[1] as PrimNode).params.terrain!.surface).toBe('sand')
    expect((sand.nodes[0] as PrimNode).params.terrain!.surface).toBe('grass')
  })
})
