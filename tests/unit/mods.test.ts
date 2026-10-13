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
    expect(parseMod(mod((j) => (j.robots = [])), base).mod).toBeNull()
  })

  it('model files only inside the mod folder; no scripts, no other places', () => {
    for (const file of ['../x.glb', '/etc/x.glb', 'C:\\x.glb', 'http://evil/x.glb', 'mod://m1/x.glb', 'x.js', 'x.html', 'sub\\x.fbx']) {
      const r = parseMod(mod((j) => (j.robots[0].model.file = file)), base)
      expect(r.mod, file).toBeNull()
    }
    // a sub-folder is fine
    expect(parseMod(mod((j) => (j.robots[0].model.file = 'models/bot v2.glb')), base).mod!.robots[0].model!.url).toBe('mod://m0/models/bot%20v2.glb')
  })

  it('numbers out of range are clamped and reported; missing ones make the robot unusable', () => {
    const r = parseMod(mod((j) => (j.robots[0].maxSpeed = 1e9)), base)
    expect(r.mod!.robots[0].maxSpeed).toBe(2000)
    expect(r.errors[0]).toMatch(/maxSpeed/)
    const noTrack = parseMod(mod((j) => delete j.robots[0].track), base)
    expect(noTrack.mod).toBeNull()
    expect(noTrack.errors.join()).toMatch(/track: a number is needed/)
    // a pad port used twice: that pad is left out
    const twice = parseMod(mod((j) => (j.robots[0].pads[1].port = 1)), base)
    expect(twice.mod!.robots[0].pads.map((p) => p.port)).toEqual([1, 3])
  })

  it('axes: three different ones, not mirrored; colours and patterns are checked', () => {
    expect(parseMod(mod((j) => (j.robots[0].model.left = '+z')), base).mod).toBeNull()
    const mirrored = parseMod(mod((j) => (j.robots[0].model.left = '-x')), base)
    expect(mirrored.mod).toBeNull()
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
    expect(r.mod).toBeNull()
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
