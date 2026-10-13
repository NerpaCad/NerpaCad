import { describe, expect, it } from 'vitest'
import { emptyDoc, type DocNode } from '@/core/doc/model'
import { lampNode, nerpaNode, robotNode, start, workspaceJson } from '@/core/robotics/demo'
import { RoboWorld } from '@/core/robotics/world'
import { type BlockJson, Program } from '@/core/robotics/interpreter'

let bid = 0
const blk = (type: string, inputs: Record<string, unknown> = {}, fields: Record<string, unknown> = {}): BlockJson =>
  ({ type, id: `m${++bid}`, inputs, fields }) as BlockJson
const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const chain = (list: BlockJson[]): BlockJson | undefined => {
  for (let i = list.length - 2; i >= 0; i--) list[i].next = { block: list[i + 1] }
  return list[0]
}
const when = (msg: string, body: BlockJson[]): BlockJson => ({ type: 'msg_when', id: `h${++bid}`, fields: { MSG: msg }, next: { block: chain(body) } })
const send = (msg: string) => blk('msg_send', {}, { MSG: msg })
const sendWait = (msg: string) => blk('msg_send_wait', {}, { MSG: msg })
const wait = (s: number) => blk('robo_wait', { SECONDS: n(s) })
const setVar = (v: string, value: number) => blk('variables_set', { VALUE: n(value) }, { VAR: { id: v } })
const change = (v: string, by = 1) => blk('math_change', { DELTA: n(by) }, { VAR: { id: v } })
const timer = (v: string) => blk('variables_set', { VALUE: { block: blk('robo_timer') } }, { VAR: { id: v } })
const ws = (...tops: BlockJson[]) => ({ blocks: { blocks: tops } })

/** programs that send to each other through one bus (as the world does) */
function bus(...programs: unknown[]) {
  const ps: Program[] = []
  const broadcast = (name: string) => {
    const d = ps.map((p) => p.receive(name))
    return () => d.every((x) => x())
  }
  for (const p of programs) ps.push(new Program(p, { broadcast }))
  const run = (s: number) => {
    for (let i = 0; i < Math.round(s * 60); i++) for (const p of ps) p.tick(1 / 60)
  }
  return { ps, run }
}

describe('messages in the interpreter', () => {
  it('"broadcast" starts every "when I receive" of that name, in every program, and goes on at once', () => {
    const { ps, run } = bus(
      ws(start([send('go'), timer('sent'), send('nobody'), timer('after')])),
      ws(when('go', [timer('got')]), when('go', [change('twice')]), when('other', [setVar('wrong', 1)])),
      ws(when(' go ', [timer('got3')]))
    )
    run(0.5)
    expect(ps[0].vars.get('sent')).toBe(ps[0].vars.get('after'))
    expect(ps[1].vars.get('got')).toBeGreaterThan(0)
    expect(ps[1].vars.get('twice')).toBe(1)
    expect(ps[1].vars.get('wrong')).toBeUndefined()
    // names match without the spaces around them
    expect(ps[2].vars.get('got3')).toBeGreaterThan(0)
  })

  it('"broadcast and wait" waits until every script it started is over', () => {
    const { ps, run } = bus(ws(start([sendWait('work'), timer('back')])), ws(when('work', [wait(1), timer('a')])), ws(when('work', [wait(2), timer('b')])))
    run(3)
    const back = ps[0].vars.get('back') as number
    expect(back).toBeGreaterThanOrEqual(ps[2].vars.get('b') as number)
    expect(back).toBeCloseTo(2, 1)
    expect(ps[1].vars.get('a')).toBeCloseTo(1, 1)
  })

  it('"broadcast and wait" with nobody listening goes on at once', () => {
    const { ps, run } = bus(ws(start([sendWait('silence'), timer('t')])))
    run(0.2)
    expect(ps[0].vars.get('t')).toBeLessThan(0.1)
  })

  it('a message that comes while its script still runs starts it again from the top (as in Scratch)', () => {
    const { ps, run } = bus(
      ws(start([send('ping'), wait(0.5), send('ping')])),
      ws(when('ping', [change('starts'), wait(1), change('ends')]))
    )
    run(3)
    expect(ps[1].vars.get('starts')).toBe(2)
    // the first run was cut short: only the second one got to the end
    expect(ps[1].vars.get('ends')).toBe(1)
  })

  it('a script can send its own message to itself: it starts over and the rest of the old run is dropped', () => {
    const { ps, run } = bus(ws(start([send('loop')]), when('loop', [change('n'), wait(0.1), ifLess('n', 5, [send('loop')]), change('skipped')])))
    run(2)
    expect(ps[0].vars.get('n')).toBe(5)
    // only the last run (which did not send) got past the send
    expect(ps[0].vars.get('skipped')).toBe(1)
  })

  it('a program without "when I receive" ignores messages; the broadcast blocks are known', () => {
    const p = new Program(ws(start([send('x'), sendWait('y')]), when('x', [])), {})
    for (let i = 0; i < 10; i++) p.tick(1 / 60)
    expect([...p.unknown]).toEqual([])
    expect(p.finished).toBe(true)
  })
})

function ifLess(v: string, lim: number, body: BlockJson[]): BlockJson {
  return blk('robo_if', {
    COND: { block: blk('robo_compare', { A: { block: blk('variables_get', {}, { VAR: { id: v } }) }, B: n(lim) }, { OP: 'LT' }) },
    DO: { block: chain(body) }
  })
}

describe('messages on the field', () => {
  it('robot → seal → pigeon → lamp: a story told by messages', () => {
    const robot = robotNode(150, 150, 0, 'R', workspaceJson([start([blk('robo_motors_for', { LEFT: n(50), RIGHT: n(50), SECONDS: n(1) }), send('arrived')])]))
    const seal = nerpaNode(
      150,
      900,
      0,
      'N',
      workspaceJson([when('arrived', [blk('nerpa_jump'), sendWait('fly'), blk('nerpa_say', { TEXT: { shadow: { type: 'robo_text', fields: { TEXT: 'ура' } } } })])]),
      'seal'
    )
    const pigeon = nerpaNode(900, 900, 0, 'G', workspaceJson([when('fly', [blk('pigeon_takeoff', { CM: n(30) }), blk('pigeon_land'), send('blink')])]), 'pigeon')
    const lamp = lampNode('point', 600, 600, 'L')
    lamp.params.light = { ...lamp.params.light!, on: false, program: workspaceJson([when('blink', [blk('light_on')])]) }
    const nodes: DocNode[] = [robot, seal, pigeon, lamp]
    const w = RoboWorld.fromDoc({ ...emptyDoc(), scene: 'robo', nodes })
    const s = w.seals[0].seal
    const p = w.seals[1].seal
    const l = w.lights[0]
    let saidAt = -1
    let flewAt = -1
    let litAt = -1
    for (let k = 0; k < 120 * 8; k++) {
      w.step()
      if (flewAt < 0 && p.z > 100) flewAt = w.time
      if (litAt < 0 && l.on) litAt = w.time
      if (saidAt < 0 && s.say === 'ура') saidAt = w.time
    }
    expect(w.messages.map((m) => m.name)).toEqual(['arrived', 'fly', 'blink'])
    expect(w.messages[0].t).toBeCloseTo(1, 1)
    expect(flewAt).toBeGreaterThan(w.messages[1].t)
    // the seal waited for the pigeon's whole flight (its script also sent "blink")
    expect(litAt).toBeGreaterThan(flewAt)
    expect(saidAt).toBeGreaterThanOrEqual(litAt)
  })
})
