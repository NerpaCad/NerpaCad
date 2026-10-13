import { describe, expect, it } from 'vitest'
import { emptyDoc, newId, type Doc, type DocNode, type PrimNode, type RobotSensor } from '@/core/doc/model'
import { lightReading, coneFactor } from '@/core/robotics/lighting'
import { Program, type BlockJson } from '@/core/robotics/interpreter'
import { robotNode, start, workspaceJson } from '@/core/robotics/demo'
import { RoboWorld } from '@/core/robotics/world'
import { SimCreature, NERPA_SPEED, JUMP_TIME } from '@/core/robotics/nerpa'
import { Physics, initPhysics, type ShapeBody } from '@/core/robotics/physics'
import { NERPABOT, SONAR_MAX_CM } from '@/core/robotics/robot'

const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const txt = (v: string) => ({ shadow: { type: 'robo_text', fields: { TEXT: v } } })
let bid = 0
const blk = (type: string, inputs: Record<string, unknown> = {}, fields: Record<string, unknown> = {}): BlockJson =>
  ({ type, id: `b${++bid}`, inputs, fields }) as BlockJson
const chain = (bs: BlockJson[]) => {
  for (let i = bs.length - 2; i >= 0; i--) bs[i].next = { block: bs[i + 1] }
  return bs[0]
}
const hat = (type: string, body: BlockJson[], fields: Record<string, unknown> = {}) =>
  ({ type, id: `h${++bid}`, fields, next: { block: chain(body) } }) as BlockJson

const cube = (id: string, cx: number, cy: number, cz: number, s = 40, glow = false): ShapeBody => {
  const pts: number[] = []
  for (let i = 0; i < 8; i++) pts.push(cx + (i & 1 ? s / 2 : -s / 2), cy + (i & 2 ? s / 2 : -s / 2), cz + (i & 4 ? s / 2 : -s / 2))
  return { id, points: new Float32Array(pts), mass: 10, glow }
}

function field(nodes: DocNode[]): Doc {
  return { ...emptyDoc(), scene: 'robo', nodes }
}

function robotWith(sensors: RobotSensor[], program?: unknown, x = 0, y = 0, heading = 0): PrimNode {
  const r = robotNode(x, y, heading, 'R', program)
  r.params.robot!.sensors = sensors
  return r
}

function lamp(x: number, y: number, z: number, params: Partial<NonNullable<PrimNode['params']['light']>> = {}): PrimNode {
  return {
    id: newId(),
    kind: 'prim',
    prim: 'light',
    name: 'L',
    color: '#ffffff',
    isHole: false,
    params: { light: { kind: 'point', brightness: 100, on: true, angle: 60, tilt: 30, ...params } },
    transform: { position: [x, y, z], rotation: [0, 0, 0], scale: [1, 1, 1] }
  }
}

function seal(program: unknown, x = 0, y = 0): PrimNode {
  return {
    id: newId(),
    kind: 'prim',
    prim: 'nerpa',
    name: 'N',
    color: '#8f9aa6',
    isHole: false,
    params: { nerpa: { program } },
    transform: { position: [x, y, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
  }
}

describe('light sensor maths', () => {
  it('100 % at 30 cm in front reads 100, falls off with the square of the distance', () => {
    const at: [number, number, number] = [0, 0, 0]
    const up: [number, number, number] = [0, 0, 1]
    expect(lightReading(at, up, [{ pos: [0, 0, 300], brightness: 100 }])).toBe(100)
    expect(lightReading(at, up, [{ pos: [0, 0, 600], brightness: 100 }])).toBe(25)
    expect(lightReading(at, up, [{ pos: [0, 0, 600], brightness: 50 }])).toBe(13)
    // from the side half as much, from behind nothing
    expect(lightReading(at, up, [{ pos: [600, 0, 0], brightness: 100 }])).toBe(13)
    expect(lightReading(at, up, [{ pos: [0, 0, -300], brightness: 100 }])).toBe(0)
    // several sources add up, capped at 100
    expect(lightReading(at, up, [{ pos: [0, 0, 600], brightness: 100 }, { pos: [0, 0, 600], brightness: 100 }])).toBe(50)
    expect(lightReading(at, up, [{ pos: [0, 0, 100], brightness: 100 }])).toBe(100)
  })

  it('a cone lamp lights only inside its cone, with a soft edge', () => {
    const cosHalf = Math.cos(Math.PI / 6)
    expect(coneFactor(1, cosHalf)).toBe(1)
    expect(coneFactor(Math.cos(Math.PI / 5), cosHalf)).toBe(0)
    const mid = coneFactor(Math.cos((Math.PI / 6) * 0.9), cosHalf)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(1)
    const src = { pos: [0, 0, 300] as [number, number, number], brightness: 100, dir: [0, 0, -1] as [number, number, number], cosHalf }
    expect(lightReading([0, 0, 0], [0, 0, 1], [src])).toBe(100)
    expect(lightReading([300, 0, 0], [0, 0, 1], [src])).toBe(0)
  })

  it('something in between blocks the light', () => {
    const src = { pos: [0, 0, 300] as [number, number, number], brightness: 100 }
    expect(lightReading([0, 0, 0], [0, 0, 1], [src], () => true)).toBe(0)
  })
})

describe('robot sensors in a world', () => {
  it('ultrasonic measures the distance to a cube in front, in cm', async () => {
    await initPhysics()
    const w = RoboWorld.fromDoc(field([robotWith([{ port: 2, type: 'ultrasonic' }])]))
    expect(w.robots[0].readings.get(2)).toBe(SONAR_MAX_CM) // no probe yet: nothing seen
    // the transducers are 59 mm out from pad 2 (x = 59.7): at x ≈ 118.7; the cube face at 380
    const ph = new Physics([cube('c', 400, 0, 30)], w.robots)
    ph.step(1 / 120, w.robots)
    w.probe = ph
    w.refresh()
    expect(w.robots[0].readings.get(2)).toBe(26)
    ph.dispose()
  })

  it('ultrasonic sees other robots, not the floor, and reads the maximum when nothing is there', async () => {
    await initPhysics()
    const other = robotWith([], undefined, 700, 0, 180)
    const w = RoboWorld.fromDoc(field([robotWith([{ port: 2, type: 'ultrasonic' }, { port: 4, type: 'ultrasonic' }]), other]))
    const ph = new Physics([], w.robots)
    ph.step(1 / 120, w.robots)
    w.probe = ph
    w.refresh()
    // the other robot's body (radius 85 around x = 700 − 5) starts at 610
    expect(w.robots[0].readings.get(2)).toBeGreaterThan(45)
    expect(w.robots[0].readings.get(2)).toBeLessThan(52)
    expect(w.robots[0].readings.get(4)).toBe(SONAR_MAX_CM)
    ph.dispose()
  })

  it('touch is pressed when something is at the button', async () => {
    await initPhysics()
    const w = RoboWorld.fromDoc(field([robotWith([{ port: 2, type: 'touch' }, { port: 1, type: 'touch' }])]))
    // the button of pad 2 is at x ≈ 59.7 + 66 = 125.7
    const ph = new Physics([cube('c', 140, 0, 20, 20)], w.robots)
    ph.step(1 / 120, w.robots)
    w.probe = ph
    w.refresh()
    expect(w.robots[0].readings.get(2)).toBe(1)
    expect(w.robots[0].readings.get(1)).toBe(0)
    ph.dispose()
  })

  it('a robot with a touch sensor stops at a wall', async () => {
    await initPhysics()
    const program = workspaceJson([
      start([
        blk('robo_forward', { POWER: n(40) }),
        blk('robo_wait_until', { COND: { block: blk('robo_touch', {}, { PORT: '2' }) } }),
        blk('robo_stop')
      ])
    ])
    const w = RoboWorld.fromDoc(field([robotWith([{ port: 2, type: 'touch' }], program)]))
    const wall = cube('wall', 400, 0, 40, 80)
    wall.mass = 100000
    const ph = new Physics([wall], w.robots)
    w.probe = ph
    for (let i = 0; i < 6 * 120; i++) {
      w.step()
      ph.step(1 / 120, w.robots)
    }
    const r = w.robots[0]
    expect(r.left).toBe(0)
    // stopped with the button against the wall (face at 360): the button reaches 125.7 + 6 in front of the centre
    expect(r.pose.x).toBeGreaterThan(215)
    expect(r.pose.x).toBeLessThan(240)
    ph.dispose()
  })

  it('light sensor sees lamps, a switched-on flashlight and glowing shapes; things in between block them', async () => {
    await initPhysics()
    const robot = robotWith([{ port: 1, type: 'light' }])
    // a bulb 30 cm above the sensor eye (pad 1 at (37.7, 35), eye 52 mm out: (89.7, 35, 31.5))
    const bulb = lamp(89.7, 35, 331.5)
    const w = RoboWorld.fromDoc(field([robot, bulb]))
    expect(w.robots[0].readings.get(1)).toBe(100)
    w.lights[0].brightness = 50
    w.refresh()
    expect(w.robots[0].readings.get(1)).toBe(50)
    w.lights[0].on = false
    w.refresh()
    expect(w.robots[0].readings.get(1)).toBe(0)
    // a glowing cube 30 cm above
    const ph = new Physics([cube('g', 89.7, 35, 331.5, 20, true)], w.robots)
    w.probe = ph
    w.shapes = () => ph.shapes()
    w.refresh()
    expect(w.robots[0].readings.get(1)).toBeGreaterThan(50)
    ph.dispose()
    // a plate between the lamp and the sensor
    w.lights[0].on = true
    const ph2 = new Physics([cube('plate', 89.7, 35, 150, 80)], w.robots)
    ph2.step(1 / 120, w.robots)
    w.probe = ph2
    w.shapes = () => []
    w.refresh()
    expect(w.robots[0].readings.get(1)).toBe(0)
    ph2.dispose()
  })

  it('a flashlight is switched by blocks and lights another robot’s light sensor', () => {
    const program = workspaceJson([start([blk('robo_flashlight', {}, { PORT: '2', STATE: 'ON' }), blk('robo_flashlight_brightness', { VALUE: n(80) }, { PORT: '2' })])])
    // robot B faces robot A's light sensor on its back pad 4, 20 cm away
    const a = robotWith([{ port: 2, type: 'flashlight' }], program)
    const b = robotWith([{ port: 4, type: 'light' }], undefined, 400, 0, 0)
    const w = RoboWorld.fromDoc(field([a, b]))
    expect(w.robots[1].readings.get(4)).toBe(0)
    w.run(0.1)
    expect(w.robots[0].flash.get(2)).toEqual({ on: true, brightness: 80 })
    expect(w.robots[0].readings.get(2)).toBe(80)
    expect(w.robots[1].readings.get(4)).toBeGreaterThan(10)
  })

  it('a lamp runs its own program: blinking', () => {
    const program = workspaceJson([
      start([blk('robo_forever', { DO: { block: chain([blk('light_off'), blk('robo_wait', { SECONDS: n(0.5) }), blk('light_on'), blk('robo_wait', { SECONDS: n(0.5) })]) } })])
    ])
    const w = RoboWorld.fromDoc(field([lamp(0, 0, 200, { program })]))
    const seen: boolean[] = []
    w.run(2, (x) => seen.push(x.lights[0].on))
    const changes = seen.filter((v, i) => i > 0 && v !== seen[i - 1]).length
    expect(changes).toBeGreaterThanOrEqual(3)
  })
})

describe('the seal', () => {
  it('walks, turns, glides and jumps, each taking its time', () => {
    const s = new SimCreature('n', 0, 0, 0, '#fff')
    let t = 0
    const run = (sec: number) => {
      const end = t + sec
      while (t < end - 1e-9) {
        t += 1 / 120
        s.step(t)
      }
    }
    const walked = s.walk(300)
    expect(walked()).toBe(false)
    run(300 / NERPA_SPEED + 0.02)
    expect(walked()).toBe(true)
    expect(s.x).toBeCloseTo(300, 3)
    const turned = s.turn(Math.PI / 2)
    run(1)
    expect(turned()).toBe(true)
    expect(s.theta).toBeCloseTo(Math.PI / 2, 6)
    const g = s.glide(0, 0, 1)
    expect(s.anim).toBe('swim')
    run(0.5)
    expect(s.x).toBeCloseTo(150, 0)
    run(0.6)
    expect(g()).toBe(true)
    expect(s.anim).toBe('idle')
    const j = s.jump()
    run(JUMP_TIME / 2)
    expect(s.lift).toBeGreaterThan(80)
    run(JUMP_TIME)
    expect(j()).toBe(true)
    expect(s.lift).toBe(0)
  })

  it('runs a program: walk, turn, say, go to, glide; the blocks wait for the moves', () => {
    const program = workspaceJson([
      start([
        blk('nerpa_walk', { CM: n(15) }),
        blk('nerpa_turn', { DEG: n(90) }, { DIR: 'LEFT' }),
        blk('nerpa_say_for', { TEXT: txt('Привет!'), SECONDS: n(1) }),
        blk('nerpa_goto', { X: n(-10), Y: n(5) }),
        blk('nerpa_glide', { X: n(20), Y: n(5), SECONDS: n(1) })
      ])
    ])
    const w = RoboWorld.fromDoc(field([seal(program)]))
    const s = w.seals[0].seal
    w.run(0.5)
    expect(s.x).toBeGreaterThan(50)
    expect(s.x).toBeLessThan(100)
    w.run(1.2) // walk done (1 s), turning
    expect(s.theta).toBeGreaterThan(1)
    expect(s.say).toBe('Привет!')
    w.run(1)
    expect(s.say).toBe(null)
    expect(s.x).toBeGreaterThan(-100)
    w.run(1.5)
    expect(s.x).toBeCloseTo(200, 0)
    expect(s.y).toBeCloseTo(50, 0)
    expect(w.seals[0].program!.finished).toBe(true)
  })

  it('keys and clicks start their own scripts; variables count', () => {
    const program = {
      variables: [{ name: 'счёт', id: 'v1' }],
      blocks: {
        languageVersion: 0,
        blocks: [
          hat('robo_when_key', [blk('math_change', { DELTA: n(1) }, { VAR: { id: 'v1' } })], { KEY: 'ArrowUp' }),
          hat('robo_when_clicked', [blk('nerpa_jump')]),
          hat('robo_start', [blk('variables_set', { VALUE: n(10) }, { VAR: { id: 'v1' } })])
        ]
      }
    }
    const w = RoboWorld.fromDoc(field([seal(program)]))
    const p = w.seals[0].program!
    w.run(0.05)
    expect(p.vars.get('v1')).toBe(10)
    w.pressKey('ArrowUp')
    w.run(0.05)
    w.pressKey('ArrowDown')
    w.pressKey('ArrowUp')
    w.run(0.05)
    expect(p.vars.get('v1')).toBe(12)
    w.click(w.seals[0].seal.id)
    w.run(0.2)
    expect(w.seals[0].seal.lift).toBeGreaterThan(0)
  })

  it('knows where it is, how far things are and whether it touches them', () => {
    const w = RoboWorld.fromDoc(field([seal(undefined, 0, 0), robotWith([], undefined, 500, 0)]))
    const p = new Program(
      workspaceJson([start([blk('nerpa_face', {}, { TARGET: 'ROBOT' })])]),
      {}
    )
    void p
    const s = w.seals[0].seal
    const io = (w as unknown as { nerpaIO(n: SimCreature): import('@/core/robotics/interpreter').NerpaIO }).nerpaIO(s)
    expect(io.distance('ROBOT')).toBeCloseTo(505, 0)
    expect(io.touching('ROBOT')).toBe(false)
    s.goTo(350, 0)
    expect(io.touching('ROBOT')).toBe(true)
    expect(io.distance('LIGHT')).toBe(Infinity)
    s.goTo(0, 0)
    s.theta = Math.PI
    const done = io.face('ROBOT')
    w.run(1)
    expect(done()).toBe(true)
    expect(Math.cos(s.theta)).toBeCloseTo(1, 6)
  })

  it('pushes shapes out of its way', async () => {
    await initPhysics()
    const program = workspaceJson([start([blk('nerpa_walk', { CM: n(40) })])])
    const w = RoboWorld.fromDoc(field([seal(program)]))
    const ph = new Physics([cube('c', 250, 0, 20)], [], w.seals)
    for (let i = 0; i < 4 * 120; i++) {
      w.step()
      ph.step(1 / 120, [], w.seals)
    }
    expect(ph.position('c')!.x).toBeGreaterThan(300)
    ph.dispose()
  })
})

void NERPABOT
