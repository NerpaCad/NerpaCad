import { describe, expect, it } from 'vitest'
import { emptyDoc, newId, type DecorKind, type DocNode, type PrimNode, type Species } from '@/core/doc/model'
import { nerpaNode, start, terrainNode, tileNode, workspaceJson } from '@/core/robotics/demo'
import { RoboWorld } from '@/core/robotics/world'
import type { BlockJson } from '@/core/robotics/interpreter'
import { cellAt } from '@/core/robotics/land'
import { SURFACE_KINDS } from '@/core/robotics/surface'
import ru from '@/i18n/ru.json'
import en from '@/i18n/en.json'
import zh from '@/i18n/zh.json'

let bid = 0
const blk = (type: string, inputs: Record<string, unknown> = {}, fields: Record<string, unknown> = {}): BlockJson =>
  ({ type, id: `s${++bid}`, inputs, fields }) as BlockJson
const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const keep = (name: string, reporter: BlockJson) => blk('variables_set', { VALUE: { block: reporter } }, { VAR: { id: name } })
const decorNodeAt = (kind: DecorKind, x: number, y: number, z = 0): PrimNode => ({
  id: newId(),
  kind: 'prim',
  prim: 'decor',
  name: kind,
  color: '#888888',
  isHole: false,
  params: { decor: { kind } },
  transform: { position: [x, y, z], rotation: [0, 0, 0], scale: [1, 1, 1] }
})
const c = (i: number) => 150 + 300 * i
const ground = (i: number, j: number, surface: string) => terrainNode('ground', c(i), c(j), 0, 'g', { surface: surface as never })
const water = (i: number, j: number) => terrainNode('water', c(i), c(j), 0, 'w')
const hero = (species: Species, x: number, y: number, deg: number, body: BlockJson[] = []) => nerpaNode(x, y, deg, species, workspaceJson([start(body)]), species)
const world = (nodes: DocNode[]) => {
  const w = RoboWorld.fromDoc({ ...emptyDoc(), scene: 'robo', nodes })
  for (let i = 0; i < 4; i++) w.step()
  return w
}
const under = (w: RoboWorld, k = 0) => w.under(w.seals[k].seal)
const ahead = (w: RoboWorld, k = 0) => w.aheadKind(w.seals[k].seal)

describe('what a hero stands on', () => {
  it('each kind of ground', () => {
    expect(under(world([hero('seal', 300, 300, 0)]))).toBe('floor')
    for (const s of ['grass', 'sand', 'stone', 'road']) expect(under(world([ground(0, 0, s), hero('cheetah', c(0), c(0), 0)]))).toBe(s)
    expect(under(world([water(0, 0), hero('seal', c(0), c(0), 0)]))).toBe('water')
    expect(under(world([terrainNode('platform', c(0), c(0), 0, 'p'), hero('cheetah', c(0), c(0), 0)]))).toBe('platform')
  })

  it('a ramp, a bridge (and the floor under it), a track tile — and a road’s own line is still road', () => {
    // a long ramp rising to +Y: halfway up it
    const ramp = terrainNode('ramp', c(0), c(1) - 150, 0, 'r', { height: 120, length: 2 })
    const w = world([ramp, hero('seal', c(0), c(1) - 150, 0, [blk('nerpa_goto', { X: n(15), Y: n(30) })])])
    expect(under(w)).toBe('ramp')
    const bridge = terrainNode('bridge', c(2), c(0), 0, 'b', { height: 120 })
    // put on the deck: "go to" over the bridge keeps it on the deck
    const onTop = hero('seal', c(2), c(0), 0, [blk('nerpa_goto', { X: n(c(2) / 10), Y: n(c(0) / 10) })])
    onTop.transform = { ...onTop.transform, position: [c(2), c(0), 120] }
    expect(under(world([bridge, onTop]))).toBe('bridge')
    expect(under(world([bridge, hero('seal', c(2), c(0), 0)]))).toBe('floor')
    const tile = tileNode({ kind: 'straight', x: c(0), y: c(0), angle: 0 }, 't')
    expect(under(world([tile, hero('pigeon', c(0), c(0), 0)]))).toBe('track')
    const road = terrainNode('ground', c(0), c(0), 0, 'g', { surface: 'road', line: 'straight' })
    expect(under(world([road, hero('pigeon', c(0), c(0), 0)]))).toBe('road')
  })

  it('a rock the cheetah jumped onto; the pigeon in the air, then landed', () => {
    const w = world([ground(0, 0, 'grass'), ground(1, 0, 'grass'), decorNodeAt('rock', c(1), c(0), 10), hero('cheetah', c(0), c(0), 0, [blk('cheetah_leap')])])
    for (let i = 0; i < 120; i++) w.step()
    expect(under(w)).toBe('rock')
    const p = world([ground(0, 0, 'sand'), hero('pigeon', c(0), c(0), 0, [blk('pigeon_takeoff', { CM: n(40) }), blk('robo_wait', { SECONDS: n(1) }), blk('pigeon_land')])])
    for (let i = 0; i < 240; i++) p.step()
    expect(under(p)).toBe('air')
    for (let i = 0; i < 600; i++) p.step()
    expect(under(p)).toBe('sand')
  })

  it('ahead: where it would step — water, the side of a platform, grass; a flier sees what is below ahead', () => {
    expect(ahead(world([ground(0, 0, 'grass'), water(1, 0), hero('cheetah', c(0) + 60, c(0), 0)]))).toBe('water')
    expect(ahead(world([ground(0, 0, 'grass'), terrainNode('platform', c(1), c(0), 0, 'p'), hero('cheetah', c(0) + 60, c(0), 0)]))).toBe('platform')
    expect(ahead(world([ground(0, 0, 'grass'), ground(1, 0, 'road'), hero('seal', c(0) + 60, c(0), 0)]))).toBe('road')
    const p = world([ground(0, 0, 'grass'), water(1, 0), hero('pigeon', c(0) + 60, c(0), 0, [blk('pigeon_takeoff', { CM: n(40) })])])
    for (let i = 0; i < 400; i++) p.step()
    expect(ahead(p)).toBe('water')
  })

  it('the blocks: "under me" gives the word in the user’s language, "standing on?" and "… ahead?" compare', () => {
    RoboWorld.surfaceWords = { grass: 'трава', water: 'вода' }
    const w = world([
      ground(0, 0, 'grass'),
      water(1, 0),
      hero('cheetah', c(0) + 40, c(0), 0, [
        keep('u', blk('creature_under')),
        keep('on', blk('creature_on', {}, { SURF: 'grass' })),
        keep('notOn', blk('creature_on', {}, { SURF: 'sand' })),
        keep('ah', blk('creature_ahead_is', {}, { SURF: 'water' }))
      ])
    ])
    const v = w.seals[0].program!.vars
    expect(v.get('u')).toBe('трава')
    expect(v.get('on')).toBe(true)
    expect(v.get('notOn')).toBe(false)
    expect(v.get('ah')).toBe(true)
    expect([...w.seals[0].program!.unknown]).toEqual([])
    RoboWorld.surfaceWords = {}
  })

  it('every surface has a word in all three languages', () => {
    for (const k of SURFACE_KINDS) for (const l of [ru, en, zh] as Record<string, string>[]) expect(l[`surf.${k}`]).toBeTruthy()
  })
})

describe('a seal that keeps to the road', () => {
  it('walks only where "road ahead?" says yes, turning at the road’s end', () => {
    // an L-shaped road through the grass
    const road = new Set(['0,0', '1,0', '2,0', '3,0', '3,1', '3,2'])
    const nodes: DocNode[] = []
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) nodes.push(ground(i, j, road.has(`${i},${j}`) ? 'road' : 'grass'))
    const step = blk('robo_if_else', {
      COND: { block: blk('creature_ahead_is', {}, { SURF: 'road' }) },
      DO: { block: blk('nerpa_walk', { CM: n(5) }) },
      ELSE: { block: blk('nerpa_turn', { DEG: n(90) }, { DIR: 'LEFT' }) }
    })
    nodes.push(hero('seal', c(0), c(0), 0, [blk('robo_repeat', { TIMES: n(60), DO: { block: step } })]))
    const w = world(nodes)
    const s = w.seals[0].seal
    const seen = new Set<string>()
    for (let k = 0; k < 120 * 40; k++) {
      w.step()
      if (k % 6) continue
      const cell = cellAt(s.x, s.y).join(',')
      seen.add(cell)
      expect(road.has(cell)).toBe(true)
      expect(w.under(s)).toBe('road')
    }
    expect(seen.has('3,2')).toBe(true)
  })
})
