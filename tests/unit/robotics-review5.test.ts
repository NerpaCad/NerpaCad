import { describe, expect, it } from 'vitest'
import { emptyDoc, newId, type Doc, type DocNode, type PrimNode, type RobotSensor } from '@/core/doc/model'
import { NOTHING_CM, type BlockJson } from '@/core/robotics/interpreter'
import { robotNode, start, workspaceJson } from '@/core/robotics/demo'
import { RoboWorld } from '@/core/robotics/world'
import { SimCreature } from '@/core/robotics/nerpa'
import { Physics, initPhysics, type ShapeBody } from '@/core/robotics/physics'

const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
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


describe('stage 5 review fixes', () => {
  it('sensors see the field from the very first tick (no physics step needed first)', async () => {
    await initPhysics()
    const w = RoboWorld.fromDoc(field([robotWith([{ port: 2, type: 'ultrasonic' }])]))
    const ph = new Physics([cube('c', 400, 0, 30)], w.robots)
    w.probe = ph
    w.refresh()
    expect(w.robots[0].readings.get(2)).toBe(26)
    ph.dispose()
  })

  it('a bigger seal pushes with its whole body', async () => {
    await initPhysics()
    // the cube sits just ahead of the nose of a 300 % seal, far from a 100 % one (nose at 125 mm)
    const push = (size: number) => {
      const w = RoboWorld.fromDoc(field([seal(undefined)]))
      const s = w.seals[0].seal
      const ph = new Physics([cube('c', 300, 0, 20)], [], w.seals)
      s.size = size
      for (let i = 0; i < 120; i++) {
        w.step()
        ph.step(1 / 120, [], w.seals)
      }
      const x = ph.position('c')!.x
      ph.dispose()
      return x
    }
    expect(push(100)).toBeCloseTo(300, 0)
    expect(push(300)).toBeGreaterThan(308)
  })

  it('overflowing numbers do not break the seal', () => {
    const s = new SimCreature('n', 10, 20, 0, '#fff')
    s.walk(Infinity)
    s.turnTo(Infinity)
    s.glide(NaN, Infinity, Infinity)
    s.goTo(Infinity, NaN)
    s.step(5)
    for (const v of [s.x, s.y, s.theta]) expect(Number.isFinite(v)).toBe(true)
    // and from blocks: 1e200 × 1e200 steps count as 0
    const big = { block: { type: 'robo_arith', fields: { OP: 'MUL' }, inputs: { A: n(1e200), B: n(1e200) } } }
    const w = RoboWorld.fromDoc(field([seal(workspaceJson([start([blk('nerpa_walk', { CM: big })])]))]))
    w.run(1)
    expect(Number.isFinite(w.seals[0].seal.x)).toBe(true)
  })

  it('a hidden seal does not get clicks', () => {
    const program = workspaceJson([
      hat('robo_when_clicked', [blk('nerpa_jump')]),
      start([blk('nerpa_hide')])
    ])
    const w = RoboWorld.fromDoc(field([seal(program)]))
    w.run(0.05)
    expect(w.seals[0].seal.visible).toBe(false)
    w.click(w.seals[0].seal.id)
    w.run(0.2)
    expect(w.seals[0].seal.lift).toBe(0)
  })

  it('"distance to" something that is not on the field is very far', () => {
    const program = workspaceJson([
      start([
        blk('variables_set', { VALUE: { block: blk('nerpa_distance', {}, { TARGET: 'ROBOT' }) } }, { VAR: { id: 'v1' } })
      ])
    ])
    const w = RoboWorld.fromDoc(field([seal({ ...program, variables: [{ name: 'd', id: 'v1' }] })]))
    w.run(0.05)
    expect(w.seals[0].program!.vars.get('v1')).toBe(NOTHING_CM)
  })

  it('"say … for N s" waits even when the text is empty', () => {
    const s = new SimCreature('n', 0, 0, 0, '#fff')
    s.step(0)
    const done = s.speak('', 1)
    s.step(0.5)
    expect(done()).toBe(false)
    s.step(1.01)
    expect(done()).toBe(true)
  })
})
