import { describe, expect, it } from 'vitest'
import { emptyDoc, type Doc, type DocNode, type Species } from '@/core/doc/model'
import { nerpaNode, terrainNode, workspaceJson, start } from '@/core/robotics/demo'
import { RoboWorld } from '@/core/robotics/world'
import { PROFILES } from '@/core/robotics/creatures'
import { parseDoc, serializeDoc } from '@/core/io/formats'
import type { BlockJson } from '@/core/robotics/interpreter'

let bid = 0
const blk = (type: string, inputs: Record<string, unknown> = {}, fields: Record<string, unknown> = {}): BlockJson =>
  ({ type, id: `b${++bid}`, inputs, fields }) as BlockJson
const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const field = (nodes: DocNode[]): Doc => ({ ...emptyDoc(), scene: 'robo', nodes })
const hero = (species: Species, x: number, y: number, deg: number, body: BlockJson[]) =>
  nerpaNode(x, y, deg, species, workspaceJson([start(body)]), species)
const water = (x: number, y: number) => terrainNode('water', x, y, 0, 'w')
const grass = (x: number, y: number) => terrainNode('ground', x, y, 0, 'g', { surface: 'grass' })
const platform = (x: number, y: number, height = 120) => terrainNode('platform', x, y, 0, 'p', { height })
/** set a variable from a reporter, to read what a creature sensed */
const keep = (name: string, reporter: BlockJson) => blk('variables_set', { VALUE: { block: reporter } }, { VAR: { id: name } })
const world = (nodes: DocNode[]) => RoboWorld.fromDoc(field(nodes))
const creature = (w: RoboWorld) => w.seals[0].seal
/** time until the creature's x passes `x` (or Infinity) */
const timeTo = (w: RoboWorld, x: number, limit = 20) => {
  for (let i = 0; i < limit * 120; i++) {
    w.step()
    if (creature(w).x >= x) return w.time
  }
  return Infinity
}

describe('profiles', () => {
  it('each species has its own abilities', () => {
    expect(PROFILES.seal.swim).toBeGreaterThan(PROFILES.seal.walk)
    expect(PROFILES.cheetah.run).toBeGreaterThan(PROFILES.cheetah.walk * 2)
    expect(PROFILES.cheetah.jumpUp).toBeGreaterThan(120)
    expect(PROFILES.pigeon.fly).toBeGreaterThan(PROFILES.pigeon.walk)
    expect(PROFILES.pigeon.swim).toBeUndefined()
    expect(PROFILES.cheetah.swim).toBeUndefined()
  })
})

describe('the seal', () => {
  it('swims faster than it crawls', () => {
    const pool = [0, 1, 2, 3, 4].map((i) => water(150 + i * 300, 150))
    const wet = world([...pool, hero('seal', 150, 150, 0, [blk('nerpa_walk', { CM: n(100) })])])
    const dry = world([hero('seal', 150, 150, 0, [blk('nerpa_walk', { CM: n(100) })])])
    const tw = timeTo(wet, 1140)
    const td = timeTo(dry, 1140)
    expect(td).toBeGreaterThan(6)
    expect(tw).toBeLessThan(td * 0.6)
    expect(creature(wet).anim).toBe('swim')
  })

  it('knows when it is in water', () => {
    const w = world([water(150, 150), hero('seal', 150, 150, 0, [keep('w', blk('nerpa_in_water'))])])
    w.run(0.2)
    expect(w.seals[0].program!.vars.get('w')).toBe(true)
  })
})

describe('Читик the cheetah', () => {
  it('runs much faster than it walks', () => {
    const run = world([hero('cheetah', 0, 0, 0, [blk('cheetah_run', { CM: n(140) })])])
    const walk = world([hero('cheetah', 0, 0, 0, [blk('nerpa_walk', { CM: n(140) })])])
    expect(timeTo(run, 1390)).toBeLessThan(2.3)
    expect(timeTo(walk, 1390)).toBeGreaterThan(6)
  })

  it('stops at a platform, sees the ledge and jumps up onto it', () => {
    const w = world([
      platform(450, 150),
      hero('cheetah', 0, 150, 0, [blk('nerpa_walk', { CM: n(100) }), keep('ledge', blk('creature_ledge')), blk('cheetah_leap'), blk('nerpa_walk', { CM: n(10) })])
    ])
    w.run(3)
    const c = creature(w)
    expect(w.seals[0].program!.vars.get('ledge')).toBe(true)
    w.run(2)
    expect(c.z).toBe(120)
    expect(c.x).toBeGreaterThan(300)
  })

  it('cannot jump onto a ledge higher than it can: it hops on the spot', () => {
    const w = world([platform(450, 150, 250), hero('cheetah', 0, 150, 0, [blk('nerpa_walk', { CM: n(100) }), blk('cheetah_leap')])])
    w.run(3)
    const x = creature(w).x
    w.run(2)
    expect(creature(w).x).toBeCloseTo(x, 3)
    expect(creature(w).z).toBe(0)
  })

  it('jumps down from a platform and does not jump into water', () => {
    const down = world([platform(150, 150), hero('cheetah', 150, 150, 0, [blk('cheetah_leap')])])
    expect(creature(down).z).toBe(120)
    down.run(1.5)
    expect(creature(down).z).toBe(0)
    expect(creature(down).x).toBeGreaterThan(400)
    const wet = world([water(450, 150), hero('cheetah', 200, 150, 0, [blk('cheetah_leap')])])
    wet.run(1.5)
    expect(creature(wet).x).toBeCloseTo(200, 3)
  })

  it('stops at the shore and sees the water', () => {
    const w = world([water(450, 150), water(750, 150), hero('cheetah', 0, 150, 0, [blk('cheetah_run', { CM: n(100) }), keep('wet', blk('creature_water'))])])
    w.run(3)
    const c = creature(w)
    expect(c.x).toBeLessThan(300)
    expect(c.wet).toBe(false)
    expect(w.seals[0].program!.vars.get('wet')).toBe(true)
  })
})

describe('Геннадий the pigeon', () => {
  it('takes off, flies over water and a low platform, and reports its height', () => {
    const w = world([
      water(450, 150),
      platform(750, 150),
      hero('pigeon', 0, 150, 0, [blk('pigeon_takeoff', { CM: n(30) }), keep('alt', blk('pigeon_altitude')), blk('pigeon_fly', { CM: n(120) })])
    ])
    w.run(1.5)
    expect(w.seals[0].program!.vars.get('alt')).toBeCloseTo(30, 0)
    w.run(4)
    const p = creature(w)
    expect(p.x).toBeCloseTo(1200, -1)
    expect(p.flying).toBe(true)
    expect(p.z).toBeCloseTo(300, 0)
  })

  it('a platform higher than it flies stops it', () => {
    const w = world([platform(450, 150, 250), hero('pigeon', 0, 150, 0, [blk('pigeon_takeoff', { CM: n(15) }), blk('pigeon_fly', { CM: n(100) })])])
    w.run(5)
    expect(creature(w).x).toBeLessThan(300)
  })

  it('does not land on water (it says so), and lands on grass', () => {
    const w = world([water(150, 150), grass(450, 150), hero('pigeon', 150, 150, 0, [blk('pigeon_takeoff', { CM: n(20) }), blk('pigeon_land')])])
    w.run(2)
    const p = creature(w)
    expect(p.flying).toBe(true)
    expect(p.say).toBe(RoboWorld.waterSay)
    const g = world([grass(450, 150), hero('pigeon', 450, 150, 0, [blk('pigeon_takeoff', { CM: n(20) }), blk('pigeon_fly_to', { X: n(45), Y: n(25) }), blk('pigeon_land')])])
    g.run(4)
    const q = creature(g)
    expect(q.flying).toBe(false)
    expect(q.z).toBe(10)
    expect(q.y).toBeCloseTo(250, 0)
  })

  it('"fly" from the ground takes off first; walking stops at water', () => {
    const w = world([hero('pigeon', 0, 0, 0, [blk('pigeon_fly', { CM: n(50) })])])
    w.run(4)
    expect(creature(w).flying).toBe(true)
    expect(creature(w).x).toBeCloseTo(500, -1)
    const wet = world([water(450, 150), hero('pigeon', 150, 150, 0, [blk('nerpa_walk', { CM: n(100) })])])
    wet.run(6)
    expect(creature(wet).x).toBeLessThan(300)
  })

  it('walking off a platform it glides down slowly', () => {
    const w = world([platform(150, 150, 300), hero('pigeon', 150, 150, 0, [blk('nerpa_walk', { CM: n(30) })])])
    let fastest = 0
    w.run(5, (x) => (fastest = Math.min(fastest, creature(x).vz)))
    expect(creature(w).z).toBe(0)
    expect(fastest).toBeGreaterThanOrEqual(-351)
    expect(fastest).toBeLessThan(-100)
  })
})

describe('in a file', () => {
  it('keeps the species; a seal from an old file stays a seal', () => {
    const d = field([hero('cheetah', 0, 0, 0, []), hero('pigeon', 300, 0, 0, [])])
    const back = parseDoc(serializeDoc(d))
    const all = [...back.nodes, ...(back.parked ?? [])] as any[]
    expect(all.map((x) => x.params.nerpa.species).sort()).toEqual(['cheetah', 'pigeon'])
    const old = serializeDoc(field([nerpaNode(0, 0, 0, 'N')])).replace(',"species":"seal"', '')
    const seal = [...parseDoc(old).nodes, ...(parseDoc(old).parked ?? [])][0] as any
    expect(seal.params.nerpa.species ?? 'seal').toBe('seal')
    const w = RoboWorld.fromDoc({ ...field([seal]) })
    expect(w.seals[0].seal.species).toBe('seal')
    expect(() => parseDoc(serializeDoc(d).replaceAll('"cheetah"', '"dragon"'))).toThrow()
  })
})
