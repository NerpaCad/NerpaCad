import { describe, expect, it } from 'vitest'
import type { Circuit, Part, Wire } from '@/core/circuit/model'
import { type PinDrive, solveCircuit } from '@/core/circuit/solver'
import { P, SPECS } from '@/core/circuit/parts'
import { circuitNets, contacts, holeSnap, partsOnBoards } from '@/core/circuit/nets'
import { CircuitRun, SERVO_REST } from '@/core/circuit/runner'
import { validateCircuit } from '@/core/circuit/validate'
import type { BlockJson } from '@/core/robotics/interpreter'

let n = 0
const w = (a: string, ap: string, b: string, bp: string): Wire => ({ id: `w${++n}`, a: { part: a, pin: ap }, b: { part: b, pin: bp }, points: [], color: '#000000' })
const uno = (program?: unknown): Part => ({ id: 'u', kind: 'arduino', x: -100, y: 0, rot: 0, ...(program ? { program } : {}) })
const bb: Part = { id: 'bb', kind: 'breadboard', x: 0, y: 100, rot: 0 }
/** a part placed so that its first leg is in hole (row, column) of the breadboard */
const at = (row: number, col: number) => ({ x: bb.x + (col - 1) * P, y: bb.y + row * P })
const ROW = { a: 3, d: 6, e: 7, f: 10, j: 14 }
const drive = (pin: string, duty: number): Map<string, Map<string, PinDrive>> => new Map([['u', new Map([[pin, { mode: 'output', duty } as PinDrive]])]])

let bid = 0
const blk = (type: string, inputs: Record<string, unknown> = {}, fields: Record<string, unknown> = {}): BlockJson => ({ type, id: `b${++bid}`, inputs, fields }) as BlockJson
const num = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const program = (body: BlockJson[], vars: { name: string; id: string }[] = []) => {
  for (let i = body.length - 2; i >= 0; i--) body[i].next = { block: body[i + 1] }
  return { variables: vars, blocks: { languageVersion: 0, blocks: [{ type: 'robo_start', id: 'start', next: { block: body[0] } }] } }
}

describe('breadboard', () => {
  it('has 400 holes: 30 columns of 2 × 5 and four rails of 25', () => {
    const s = SPECS.breadboard
    expect(s.pins).toHaveLength(400)
    expect(s.bus!.filter((g) => g.length === 5)).toHaveLength(60)
    expect(s.bus!.filter((g) => g.length === 25)).toHaveLength(4)
    expect(new Set(s.pins.map((p) => p.id)).size).toBe(400)
  })

  it('joins a column of five, keeps the halves and the columns apart, joins a whole rail', () => {
    const nets = circuitNets({ parts: [bb], wires: [] })
    expect(nets.same('bb:a7', 'bb:e7')).toBe(true)
    expect(nets.same('bb:e7', 'bb:f7')).toBe(false)
    expect(nets.same('bb:a7', 'bb:a8')).toBe(false)
    expect(nets.same('bb:tp1', 'bb:tp25')).toBe(true)
    expect(nets.same('bb:tp1', 'bb:tn1')).toBe(false)
  })

  it('legs in holes connect without wires: D13 → strip → resistor → strip → LED → strip → GND', () => {
    const led: Part = { id: 'l', kind: 'led', ...at(ROW.e, 10), rot: 0, color: 'red' } // cathode e10, anode e11
    const res: Part = { id: 'r', kind: 'resistor', ...at(ROW.d, 11), rot: 0, ohms: 220 } // d11 … d15
    const c: Circuit = { parts: [uno(), bb, led, res], wires: [w('u', 'D13', 'bb', 'a15'), w('u', 'GND.1', 'bb', 'a10')] }
    expect(contacts(c)).toHaveLength(4)
    const r = solveCircuit(c, drive('D13', 1))
    expect(r.leds.get('l')!.current).toBeCloseTo(0.0125, 3)
    // half a hole off: not in, dark
    const off: Circuit = { ...c, parts: [uno(), bb, { ...led, x: led.x + 1.27 }, res] }
    expect(solveCircuit(off, drive('D13', 1)).leds.get('l')!.current).toBe(0)
  })

  it('pulls a dragged part into the nearest holes and knows what sits on a board', () => {
    const led: Part = { id: 'l', kind: 'led', x: at(ROW.e, 10).x + 1.27, y: at(ROW.e, 10).y + 1.27, rot: 0, color: 'red' }
    const s = holeSnap([bb, led], new Set(['l']))!
    expect(Math.hypot(s[0], s[1])).toBeCloseTo(Math.hypot(1.27, 1.27), 6)
    expect(holeSnap([bb, { ...led, x: 500 }], new Set(['l']))).toBeNull()
    // the board itself is not pulled into its own holes
    expect(holeSnap([bb, led], new Set(['bb', 'l']))).toBeNull()
    const placed = { ...led, ...at(ROW.e, 10) }
    expect([...partsOnBoards({ parts: [bb, placed], wires: [] }, new Set(['bb']))]).toEqual(['l'])
  })
})

describe('potentiometer', () => {
  // pin 1 in j20 → GND, wiper j21 → A0, pin 2 j22 → 5 V (turning the knob up raises the voltage)
  const pot = (knob: number): Part => ({ id: 'p', kind: 'pot', ...at(ROW.j, 20), rot: 0, ohms: 10_000, knob })
  const divider = (knob: number, prog?: unknown): Circuit => ({
    parts: [uno(prog), bb, pot(knob)],
    wires: [w('u', 'GND.2', 'bb', 'f20'), w('u', 'A0', 'bb', 'f21'), w('u', '5V', 'bb', 'f22')]
  })

  it('divides the voltage by where the knob is', () => {
    for (const k of [0, 0.25, 0.5, 1]) expect(solveCircuit(divider(k), new Map()).voltage.get('u:A0')!).toBeCloseTo(5 * k, 2)
  })

  it('analogRead gives 0…1023; turning the knob during the run changes it', () => {
    const prog = program(
      [blk('robo_forever', { DO: { block: blk('variables_set', { VALUE: { block: blk('ard_analog_read', {}, { PIN: 'A0' }) } }, { VAR: { id: 'v' } }) } })],
      [{ name: 'x', id: 'v' }]
    )
    const run = new CircuitRun(divider(0.5, prog))
    run.run(0.1)
    const p = run.programs.get('u')!
    // the 5 V rail sags a hair under load, as on a real board: 511 or 512
    expect(Math.abs(Number(p.vars.get('v')) - 512)).toBeLessThanOrEqual(1)
    run.setKnob('p', 1)
    run.run(0.1)
    expect(p.vars.get('v')).toBe(1023)
    run.setKnob('p', 0)
    run.run(0.1)
    expect(p.vars.get('v')).toBe(0)
  })

  it('an LED dims with the knob through analogWrite(analogRead / 4)', () => {
    const led: Part = { id: 'l', kind: 'led', x: 200, y: 0, rot: 0, color: 'green' }
    const r: Part = { id: 'r', kind: 'resistor', x: 250, y: 0, rot: 0, ohms: 220 }
    const read = blk('ard_analog_read', {}, { PIN: 'A0' })
    const quarter = blk('robo_arith', { A: { block: read }, B: num(4) }, { OP: 'DIV' })
    const prog = program([blk('robo_forever', { DO: { block: blk('ard_analog_write', { VALUE: { block: quarter } }, { PIN: 'D9' }) } })])
    const base = divider(0.2, prog)
    const c: Circuit = { parts: [...base.parts, led, r], wires: [...base.wires, w('u', 'D9', 'r', '1'), w('r', '2', 'l', 'anode'), w('l', 'cathode', 'u', 'GND.3')] }
    const run = new CircuitRun(c)
    run.run(0.1)
    const dim = run.result.leds.get('l')!.current
    run.setKnob('p', 0.9)
    run.run(0.1)
    const bright = run.result.leds.get('l')!.current
    expect(bright).toBeGreaterThan(dim * 3)
  })
})

describe('servo and serial monitor', () => {
  const servo: Part = { id: 's', kind: 'servo', x: 200, y: 50, rot: 0 }
  const turn = (angle: number) => program([blk('ard_servo', { ANGLE: num(angle) }, { PIN: 'D9' })])

  it('turns toward the angle at 60° per 0.1 s when it has power and ground', () => {
    const c: Circuit = { parts: [uno(turn(180)), servo], wires: [w('u', 'GND.1', 's', 'GND'), w('u', '5V', 's', '5V'), w('u', 'D9', 's', 'SIG')] }
    const run = new CircuitRun(c)
    expect(run.servos.get('s')!.angle).toBe(SERVO_REST)
    run.run(0.1)
    const st = run.servos.get('s')!
    expect(st.powered).toBe(true)
    expect(st.driven).toBe(true)
    expect(st.angle).toBeGreaterThan(130)
    expect(st.angle).toBeLessThan(160)
    run.run(0.2)
    expect(st.angle).toBe(180)
    expect(run.result.short).toBe(false)
  })

  it('does not move without power; powered from a pin it overloads it', () => {
    const noPower: Circuit = { parts: [uno(turn(0)), servo], wires: [w('u', 'GND.1', 's', 'GND'), w('u', 'D9', 's', 'SIG')] }
    const run = new CircuitRun(noPower)
    run.run(0.5)
    expect(run.servos.get('s')!.powered).toBe(false)
    expect(run.servos.get('s')!.driven).toBe(true)
    expect(run.servos.get('s')!.angle).toBe(SERVO_REST)
    const fromPin = program([blk('ard_digital_write', {}, { PIN: 'D7', STATE: 'HIGH' }), blk('ard_servo', { ANGLE: num(0) }, { PIN: 'D9' })])
    const c: Circuit = { parts: [uno(fromPin), servo], wires: [w('u', 'GND.1', 's', 'GND'), w('u', 'D7', 's', '5V'), w('u', 'D9', 's', 'SIG')] }
    const r2 = new CircuitRun(c)
    r2.run(0.3)
    expect(r2.result.overloaded).toContain('u:D7')
    expect(r2.servos.get('s')!.powered).toBe(false)
  })

  it('prints lines to the serial monitor and keeps only the last ones', () => {
    const prog = program(
      [blk('robo_repeat', { TIMES: num(5), DO: { block: blk('math_change', { DELTA: num(1) }, { VAR: { id: 'v' } }) } }), blk('ard_serial_println', { TEXT: { block: blk('variables_get', {}, { VAR: { id: 'v' } }) } })],
      [{ name: 'i', id: 'v' }]
    )
    const run = new CircuitRun({ parts: [uno(prog)], wires: [] })
    // like Scratch, a loop takes a tick per round
    run.run(0.5)
    expect(run.serial).toEqual(['5'])
    const many = program([blk('robo_repeat', { TIMES: num(500), DO: { block: blk('ard_serial_println', { TEXT: num(7) }) } })])
    const r2 = new CircuitRun({ parts: [uno(many)], wires: [] })
    r2.run(9)
    expect(r2.serial.length).toBe(300)
    expect(r2.serialCount).toBe(500)
  })
})

describe('files', () => {
  it('keeps breadboards, potentiometers (knob clamped) and servos; rejects bad values', () => {
    const c = { parts: [bb, { id: 'p', kind: 'pot', x: 0, y: 0, rot: 0, ohms: 10000, knob: 7 }, { id: 's', kind: 'servo', x: 0, y: 0, rot: 90 }], wires: [w('bb', 'a1', 's', 'SIG')] }
    const v = validateCircuit(JSON.parse(JSON.stringify(c)))!
    expect(v.parts.map((p) => p.kind)).toEqual(['breadboard', 'pot', 'servo'])
    expect(v.parts[1].knob).toBe(1)
    expect(validateCircuit({ ...c, parts: [{ id: 'p', kind: 'pot', x: 0, y: 0, rot: 0 }] })).toBeNull()
    expect(validateCircuit({ parts: [{ id: 'x', kind: 'toString', x: 0, y: 0, rot: 0 }], wires: [] })).toBeNull()
    expect(validateCircuit({ parts: [bb], wires: [w('bb', 'z99', 'bb', 'a1')] })).toBeNull()
  })
})

describe('Arduino code for the new blocks', () => {
  it('servo, serial monitor, analogRead, digitalRead, variables with Latin names, text', async () => {
    const { arduinoCode, cName } = await import('@/core/circuit/codegen')
    const { breadboardProgram } = await import('@/core/circuit/demo')
    const code = arduinoCode(breadboardProgram())
    expect(code).toContain('#include <Servo.h>')
    expect(code).toContain('Servo servo9;')
    expect(code).toContain('servo9.attach(9);')
    expect(code).not.toContain('pinMode(9, OUTPUT);')
    expect(code).toContain('long znachenie = 0; // значение')
    expect(code).toContain('znachenie = analogRead(A0);')
    expect(code).toContain('Serial.begin(9600);')
    expect(code).toContain('Serial.println(znachenie);')
    const prog = program(
      [
        blk('variables_set', { VALUE: { shadow: { type: 'robo_text', fields: { TEXT: 'он сказал "да"' } } } }, { VAR: { id: 't' } }),
        blk('robo_if', { COND: { block: blk('ard_digital_read', {}, { PIN: 'D2' }) }, DO: { block: blk('ard_serial_println', { TEXT: { block: blk('variables_get', {}, { VAR: { id: 't' } }) } }) } })
      ],
      [{ name: 'фраза', id: 't' }]
    )
    const c2 = arduinoCode(prog)
    expect(c2).toContain('String fraza; // фраза')
    expect(c2).toContain('fraza = "он сказал \\"да\\"";')
    expect(c2).toContain('if ((digitalRead(2) == HIGH)) {')
    const taken = new Set<string>()
    expect(cName('int', taken)).toBe('int_')
    expect(cName('2x', taken)).toBe('v_2x')
    expect(cName('счёт', taken)).toBe('schyot')
    expect(cName('счёт', taken)).toBe('schyot2')
  })
})

describe('the breadboard example', () => {
  it('runs: knob in the middle → servo at 90°, knob at the end → servo at 180°, LED brighter, full-scale reading', async () => {
    const { breadboardCircuit } = await import('@/core/circuit/demo')
    const c = breadboardCircuit()
    expect(contacts(c)).toHaveLength(7)
    const run = new CircuitRun(c)
    run.run(1)
    const id = (k: string) => c.parts.find((p) => p.kind === k)!.id
    expect(run.servos.get(id('servo'))!.angle).toBeCloseTo(90, 0)
    const dim = run.result.leds.get(id('led'))!.current
    run.setKnob(id('pot'), 1)
    run.run(1)
    expect(run.servos.get(id('servo'))!.angle).toBeCloseTo(180, 0)
    expect(run.result.leds.get(id('led'))!.current).toBeGreaterThan(dim * 1.5)
    expect(run.serial[run.serial.length - 1]).toBe('1023')
    expect(run.result.short).toBe(false)
    expect(run.result.overloaded).toEqual([])
  })
})

describe('review fixes', () => {
  it('a 10 MΩ potentiometer or resistor loads from a file', () => {
    const c = { parts: [{ id: 'p', kind: 'pot', x: 0, y: 0, rot: 0, ohms: 10_000_000, knob: 0.5 }, { id: 'r', kind: 'resistor', x: 0, y: 0, rot: 0, ohms: 1_000_000 }], wires: [] }
    expect(validateCircuit(c)).not.toBeNull()
    expect(validateCircuit({ ...c, parts: [{ ...c.parts[0], ohms: 2e7 }] })).toBeNull()
  })

  it('a servo signal does not brighten a dimmed LED on another pin', () => {
    const servo: Part = { id: 's', kind: 'servo', x: 200, y: 50, rot: 0 }
    const led: Part = { id: 'l', kind: 'led', x: 300, y: 0, rot: 0, color: 'red' }
    const res: Part = { id: 'r', kind: 'resistor', x: 350, y: 0, rot: 0, ohms: 220 }
    const wires = [w('u', 'D6', 'r', '1'), w('r', '2', 'l', 'anode'), w('l', 'cathode', 'u', 'GND.3')]
    const dimOnly = program([blk('ard_analog_write', { VALUE: num(5) }, { PIN: 'D6' })])
    const withServo = program([blk('ard_servo', { ANGLE: num(180) }, { PIN: 'D9' }), blk('ard_analog_write', { VALUE: num(5) }, { PIN: 'D6' })])
    const a = new CircuitRun({ parts: [uno(dimOnly), led, res], wires })
    const b = new CircuitRun({ parts: [uno(withServo), led, res, servo], wires: [...wires, w('u', 'GND.1', 's', 'GND'), w('u', '5V', 's', '5V'), w('u', 'D9', 's', 'SIG')] })
    a.run(0.2)
    b.run(0.2)
    expect(b.result.leds.get('l')!.current).toBeCloseTo(a.result.leds.get('l')!.current, 5)
  })

  it('with a servo attached, analogWrite on pins 9 and 10 only switches (the Uno timer is taken)', () => {
    const led: Part = { id: 'l', kind: 'led', x: 300, y: 0, rot: 0, color: 'red' }
    const res: Part = { id: 'r', kind: 'resistor', x: 350, y: 0, rot: 0, ohms: 220 }
    const prog = program([blk('ard_servo', { ANGLE: num(90) }, { PIN: 'D3' }), blk('ard_analog_write', { VALUE: num(60) }, { PIN: 'D10' })])
    const run = new CircuitRun({ parts: [uno(prog), led, res], wires: [w('u', 'D10', 'r', '1'), w('r', '2', 'l', 'anode'), w('l', 'cathode', 'u', 'GND.3')] })
    run.run(0.2)
    expect(run.result.leds.get('l')!.current).toBe(0)
    expect([...run.timerClash]).toEqual(['u:D10'])
  })

  it('serial prints a condition as 1 or 0, like the Arduino', () => {
    const prog = program([blk('ard_serial_println', { TEXT: { block: blk('robo_compare', { A: num(3), B: num(2) }, { OP: 'GT' }) } })])
    const run = new CircuitRun({ parts: [uno(prog)], wires: [] })
    run.run(0.1)
    expect(run.serial).toEqual(['1'])
  })

  it('code: numbers into a text variable use String(), text read as a number uses toInt(), text spreads through copies', async () => {
    const { arduinoCode, cName } = await import('@/core/circuit/codegen')
    const get = (id: string) => ({ block: blk('variables_get', {}, { VAR: { id } }) })
    const prog = program(
      [
        blk('variables_set', { VALUE: { shadow: { type: 'robo_text', fields: { TEXT: 'hi' } } } }, { VAR: { id: 't' } }),
        blk('variables_set', { VALUE: { block: blk('ard_analog_read', {}, { PIN: 'A0' }) } }, { VAR: { id: 't' } }),
        blk('variables_set', { VALUE: get('t') }, { VAR: { id: 'u' } }),
        blk('ard_analog_write', { VALUE: get('u') }, { PIN: 'D6' })
      ],
      [
        { name: 't', id: 't' },
        { name: 'u', id: 'u' }
      ]
    )
    const code = arduinoCode(prog)
    expect(code).toContain('String t;')
    expect(code).toContain('String u;')
    expect(code).toContain('t = String(analogRead(A0));')
    expect(code).toContain('u = t;')
    expect(code).toContain('analogWrite(6, u.toInt());')
    const taken = new Set<string>()
    for (const n of ['map', 'random', 'or', 'Serial', 'HIGH', 'startTime']) expect(cName(n, taken).endsWith('_')).toBe(true)
  })
})
