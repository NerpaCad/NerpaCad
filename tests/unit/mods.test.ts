/**
 * Robots and mods: NerpaBot is the default robot; a mod's mod.json is checked strictly (data only,
 * files inside its folder, sane numbers); a project keeps a robot model whose mod is not installed.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { MOD_FORMAT_VERSION, parseMod } from '@/core/robotics/mods'
import { DEFAULT_ROBOT, NERPABOT, ROBOTS, allPorts, knownRobot, registerRobot, robotSpec } from '@/core/robotics/robot'
import { parseDoc, serializeDoc } from '@/core/io/formats'
import { emptyDoc } from '@/core/doc/model'
import { robotNode } from '@/core/robotics/demo'
import { RoboWorld } from '@/core/robotics/world'

const fixture = readFileSync('tests/fixtures/mods/testbot/mod.json', 'utf8')
const base = 'mod://m0/'
const mod = (patch: (j: any) => void) => {
  const j = JSON.parse(fixture)
  patch(j)
  return JSON.stringify(j)
}

describe('robots', () => {
  it('NerpaBot is the robot of a new project; an unknown model runs as NerpaBot', () => {
    expect(DEFAULT_ROBOT).toBe('nerpabot')
    expect(robotNode(0, 0, 0, 'r').params.robot!.model).toBe('nerpabot')
    expect(robotSpec('nerpabot')).toBe(NERPABOT)
    expect(robotSpec('no-such-mod')).toBe(NERPABOT)
    expect(knownRobot('no-such-mod')).toBe(false)
    expect(NERPABOT.pads.map((p) => p.port)).toEqual([1, 2, 3, 4, 5])
    // a mod cannot replace NerpaBot
    expect(registerRobot({ ...NERPABOT, maxSpeed: 1 })).toBe(false)
    expect(robotSpec('nerpabot').maxSpeed).toBe(200)
  })

  it('a project with a robot of a mod that is not installed opens, runs and keeps its model', () => {
    const r = robotNode(450, 450, 0, 'r')
    r.params.robot = { model: 'robbo', sensors: [{ port: 1, type: 'line' }] }
    const d = parseDoc(serializeDoc({ ...emptyDoc(), scene: 'robo', nodes: [r] }))
    const back = [...d.nodes, ...d.parked][0]
    expect(back.kind === 'prim' && back.params.robot!.model).toBe('robbo')
    const w = RoboWorld.fromDoc({ ...d, scene: 'robo', nodes: [back], parked: [] })
    expect(w.robots[0].spec.id).toBe('nerpabot')
    // a nonsense model id is still refused
    const bad = robotNode(0, 0, 0, 'r')
    bad.params.robot = { model: '../../x', sensors: [] }
    expect(() => parseDoc(serializeDoc({ ...emptyDoc(), scene: 'robo', nodes: [bad] }))).toThrow()
  })
})

describe('mod.json', () => {
  it('a good mod: its robot, with the files under the mod folder and the pads in radians', () => {
    const r = parseMod(fixture, base)
    expect(r.errors).toEqual([])
    const m = r.mod!
    expect(m.id).toBe('testbot')
    expect(m.license).toBe('CC0')
    const bot = m.robots[0]
    expect(bot).toMatchObject({ id: 'testbot', mod: 'testbot', wheelRadius: 25, track: 110, maxSpeed: 250, radius: 80, height: 50 })
    expect(bot.pads[2].facing).toBeCloseTo(Math.PI)
    expect(bot.model!.url).toBe('mod://m0/testbot.gltf')
    expect(bot.model).toMatchObject({ scale: 100, forward: '+z', left: '+x', up: '+y' })
    expect(bot.modules!.touch!.board).toBe('^body$')
    expect(bot.model!.colors[1]).toMatchObject({ match: '^top$', color: '#ffd60a', emissive: '#ffd60a' })
  })

  it('what is not a mod of this format is refused, with a reason', () => {
    expect(parseMod('{', base).mod).toBeNull()
    expect(parseMod(mod((j) => (j.format = 'something')), base).errors[0]).toMatch(/format/)
    const newer = parseMod(mod((j) => (j.formatVersion = MOD_FORMAT_VERSION + 1)), base)
    expect(newer.mod).toBeNull()
    expect(newer.errors[0]).toMatch(/newer/)
    expect(parseMod(mod((j) => (j.id = 'a b')), base).mod).toBeNull()
    const empty = parseMod(
      mod((j) => {
        j.robots = []
        j.heroes = []
        j.props = []
      }),
      base
    )
    expect(empty.mod).toBeNull()
    expect(empty.errors[0]).toMatch(/no "robots", "heroes" or "props"/)
  })

  it('model files only inside the mod folder; no scripts, no other places', () => {
    for (const file of ['../x.glb', '/etc/x.glb', 'C:\\x.glb', 'http://evil/x.glb', 'mod://m1/x.glb', 'x.js', 'x.html', 'sub\\x.fbx']) {
      const r = parseMod(mod((j) => (j.robots[0].model.file = file)), base)
      expect(r.mod?.robots ?? [], file).toEqual([])
    }
    // a sub-folder is fine
    expect(parseMod(mod((j) => (j.robots[0].model.file = 'models/bot v2.glb')), base).mod!.robots[0].model!.url).toBe('mod://m0/models/bot%20v2.glb')
  })

  it('numbers out of range are clamped and reported; missing ones make the robot unusable', () => {
    const r = parseMod(mod((j) => (j.robots[0].maxSpeed = 1e9)), base)
    expect(r.mod!.robots[0].maxSpeed).toBe(2000)
    expect(r.errors[0]).toMatch(/maxSpeed/)
    const noTrack = parseMod(mod((j) => delete j.robots[0].track), base)
    expect(noTrack.mod!.robots).toEqual([])
    expect(noTrack.errors.join()).toMatch(/track: a number is needed/)
    // a pad port used twice: that pad is left out
    const twice = parseMod(mod((j) => (j.robots[0].pads[1].port = 1)), base)
    expect(twice.mod!.robots[0].pads.map((p) => p.port)).toEqual([1, 3])
  })

  it('axes: three different ones, not mirrored; colours and patterns are checked', () => {
    expect(parseMod(mod((j) => (j.robots[0].model.left = '+z')), base).mod!.robots).toEqual([])
    const mirrored = parseMod(mod((j) => (j.robots[0].model.left = '-x')), base)
    expect(mirrored.mod!.robots).toEqual([])
    expect(mirrored.errors[0]).toMatch(/mirror/)
    const colours = parseMod(
      mod((j) => (j.robots[0].model.colors = [{ match: '(', color: '#ff0000' }, { match: 'x', color: 'red' }, { match: 'ok', color: '#00ff00', opacity: 7 }])),
      base
    )
    expect(colours.mod!.robots[0].model!.colors).toEqual([{ match: 'ok', color: '#00ff00', opacity: 1 }])
    expect(colours.errors.length).toBe(2)
  })

  it('robot ids already taken (NerpaBot, another mod) are refused; ports of mods show in the blocks', () => {
    const r = parseMod(mod((j) => (j.robots[0].id = 'nerpabot')), base, new Set(Object.keys(ROBOTS)))
    expect(r.mod!.robots).toEqual([])
    expect(r.errors[0]).toMatch(/already taken/)
    const big = parseMod(mod((j) => j.robots[0].pads.push({ port: 9, x: 0, y: 0, z: 20 })), base).mod!.robots[0]
    big.id = 'big-test'
    registerRobot(big)
    expect(allPorts()).toEqual([1, 2, 3, 4, 5, 9])
    delete ROBOTS['big-test']
  })

  it('the fixture "broken" mod is refused (its model is outside its folder)', () => {
    const r = parseMod(readFileSync('tests/fixtures/mods/broken/mod.json', 'utf8'), base)
    expect(r.mod).toBeNull()
    expect(r.errors.join()).toMatch(/file/)
  })
})

describe('heroes and field pieces of mods', () => {
  it('the fixture brings a hero moving like the seal and two pieces: a static relief block and a movable crate', () => {
    const m = parseMod(fixture, base).mod!
    expect(m.heroes).toEqual([
      expect.objectContaining({ id: 'testpet', mod: 'testbot', like: 'seal', tint: '^body$', color: '#ff7f50', clips: {} })
    ])
    expect(m.heroes[0].model.url).toBe('mod://m0/testbot.gltf')
    expect(m.props.map((q) => [q.id, q.section, q.static, q.mass])).toEqual([
      ['teststep', 'relief', true, undefined],
      ['testcrate', 'decor', false, 50]
    ])
  })

  it('a mod of pieces only is a mod; wrong heroes and pieces are left out with a reason', () => {
    const only = parseMod(
      mod((j) => {
        j.robots = []
        j.heroes = []
      }),
      base
    )
    expect(only.mod!.props.length).toBe(2)
    const bad = parseMod(
      mod((j) => {
        j.heroes[0].like = 'dragon'
        j.props[0].section = 'sky'
        j.props[1].model.file = '../x.glb'
        j.heroes.push({ id: 'h2', like: 'pigeon', model: { file: 'testbot.gltf' }, clips: { dance: 'x', fly: '(' } })
      }),
      base
    )
    expect(bad.mod!.heroes.map((h) => h.id)).toEqual(['h2'])
    expect(bad.mod!.props).toEqual([])
    const why = bad.errors.join('\n')
    expect(why).toMatch(/heroes\[0\]\.like/)
    expect(why).toMatch(/props\[0\]\.section/)
    expect(why).toMatch(/props\[1\]\.model\.file/)
    expect(why).toMatch(/unknown motion "dance"/)
    expect(why).toMatch(/clips\.fly/)
  })

  it('ids are unique across robots, heroes, pieces and the built-in heroes', () => {
    const r = parseMod(
      mod((j) => {
        j.heroes[0].id = 'cheetah'
        j.props[1].id = 'teststep'
      }),
      base
    )
    expect(r.mod!.heroes).toEqual([])
    expect(r.mod!.props.map((q) => q.id)).toEqual(['teststep'])
    expect(r.errors.filter((e) => /already taken/.test(e)).length).toBe(2)
  })

  it('a project keeps a hero and a piece of a mod that is not installed; the hero moves like its own kind', () => {
    const d = {
      ...emptyDoc(),
      scene: 'robo' as const,
      meshes: { 'mod-x': { vertices: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10], triangles: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3] } },
      nodes: [
        { ...robotNode(0, 0, 0, 'r'), id: 'h', prim: 'nerpa' as const, params: { nerpa: { species: 'cheetah' as const, model: 'gone-hero' } } },
        { ...robotNode(0, 0, 0, 'p'), id: 'p', prim: 'mesh' as const, fixed: true as const, params: { meshId: 'mod-x', prop: 'gone-piece' } }
      ]
    }
    const back = parseDoc(serializeDoc(d))
    const all = [...back.nodes, ...back.parked] as any[]
    expect(all.find((n) => n.id === 'h').params.nerpa).toMatchObject({ species: 'cheetah', model: 'gone-hero' })
    expect(all.find((n) => n.id === 'p').params.prop).toBe('gone-piece')
    expect(() => parseDoc(serializeDoc({ ...d, nodes: [{ ...d.nodes[1], params: { meshId: 'mod-x', prop: '../x' } }] }))).toThrow()
  })
})
