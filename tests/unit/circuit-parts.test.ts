/**
 * The new circuit parts (0.3): batteries, buttons and switches, RGB LEDs and 7-segment displays,
 * diodes, transistors and motors, the multimeter, buzzers; the room's effect on the sensors
 * (photoresistor, temperature, ultrasonic, IR, motion); the LCD; the new blocks and their C++.
 */
import { describe, expect, it } from 'vitest'
import type { Circuit, Part, PartKind, Room, Wire } from '@/core/circuit/model'
import { type PinDrive, solveCircuit } from '@/core/circuit/solver'
import { CircuitRun } from '@/core/circuit/runner'
import { arduinoCode } from '@/core/circuit/codegen'
import { validateCircuit } from '@/core/circuit/validate'
import { ldrOhms, lightAt, tempAt, distanceAhead } from '@/core/circuit/room'
import { start, workspaceJson } from '@/core/robotics/demo'
import type { BlockJson } from '@/core/robotics/interpreter'

let n = 0
const part = (kind: PartKind, id: string, extra: Partial<Part> = {}): Part => ({ id, kind, x: 0, y: 0, rot: 0, ...extra })
const w = (a: string, ap: string, b: string, bp: string): Wire => ({ id: `w${++n}`, a: { part: a, pin: ap }, b: { part: b, pin: bp }, points: [], color: '#000' })
const drives = (list: [string, PinDrive][]) => new Map([['u', new Map(list)]])
const uno = (program?: unknown) => part('arduino', 'u', program ? { program } : {})
let bid = 0
const blk = (type: string, inputs: Record<string, unknown> = {}, fields: Record<string, unknown> = {}): BlockJson => ({ type, id: `b${++bid}`, inputs, fields }) as BlockJson
const num = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const txt = (s: string) => ({ shadow: { type: 'robo_text', fields: { TEXT: s } } })
const room = (patch: Partial<Room> = {}): Room => ({ temp: 22, light: 300, items: [], ...patch })

describe('power without an Arduino, switches and lights', () => {
  it('a 9 V battery lights an LED through 470 Ω; two AA cells through 68 Ω', () => {
    const c = (volts: 9 | 3, ohms: number): Circuit => ({
      parts: [part('battery', 'b', { volts }), part('resistor', 'r', { ohms }), part('led', 'l', { color: 'red' })],
      wires: [w('b', '+', 'r', '1'), w('r', '2', 'l', 'anode'), w('l', 'cathode', 'b', '-')]
    })
    const nine = solveCircuit(c(9, 470), new Map()).leds.get('l')!
    expect(nine.current).toBeCloseTo((9 - 1.8) / (470 + 10 + 1.5), 4)
    expect(solveCircuit(c(3, 68), new Map()).leds.get('l')!.brightness).toBeGreaterThan(0.5)
    // a battery shorted by a wire
    const shorted: Circuit = { parts: [part('battery', 'b')], wires: [w('b', '+', 'b', '-')] }
    expect(solveCircuit(shorted, new Map()).short).toBe(true)
  })

  it('a button on a pin with its pull-up: HIGH when let go, LOW when pressed', () => {
    const c: Circuit = { parts: [uno(), part('button', 'k')], wires: [w('u', 'D2', 'k', '1a'), w('k', '2b', 'u', 'GND.1')] }
    const d = drives([['D2', { mode: 'pullup' }]])
    expect(solveCircuit(c, d).voltage.get('u:D2')).toBeGreaterThan(4.9)
    expect(solveCircuit(c, d, new Set(), { pressed: new Set(['k']) }).voltage.get('u:D2')).toBeLessThan(0.01)
    // without the pull-up an open input reads nothing in particular (here: 0)
    expect(solveCircuit(c, new Map()).voltage.get('u:D2')).toBeLessThan(0.1)
  })

  it('a slide switch sends 5 V one way or the other', () => {
    const c: Circuit = {
      parts: [uno(), part('switch', 's'), part('led', 'l1', { color: 'green' }), part('led', 'l2', { color: 'red' }), part('resistor', 'r1', { ohms: 220 }), part('resistor', 'r2', { ohms: 220 })],
      wires: [
        w('u', '5V', 's', 'C'),
        w('s', '1', 'r1', '1'),
        w('r1', '2', 'l1', 'anode'),
        w('l1', 'cathode', 'u', 'GND.1'),
        w('s', '2', 'r2', '1'),
        w('r2', '2', 'l2', 'anode'),
        w('l2', 'cathode', 'u', 'GND.2')
      ]
    }
    const one = solveCircuit(c, new Map())
    expect(one.leds.get('l1')!.brightness).toBeGreaterThan(0.5)
    expect(one.leds.get('l2')!.current).toBe(0)
    const two = solveCircuit(c, new Map(), new Set(), { switches: new Map([['s', true]]) })
    expect(two.leds.get('l1')!.current).toBe(0)
    expect(two.leds.get('l2')!.brightness).toBeGreaterThan(0.5)
  })

  it('PWM: each LED is as bright as the duty of its own pin, also with a tone on another pin and with many PWM pins', () => {
    const c: Circuit = {
      parts: [uno(), part('rgb', 'c'), ...['r', 'g', 'b', 'x'].map((k) => part('resistor', `r${k}`, { ohms: 220 })), part('led', 'l')],
      wires: [
        w('u', 'D9', 'rr', '1'), w('rr', '2', 'c', 'R'), w('u', 'D10', 'rg', '1'), w('rg', '2', 'c', 'G'), w('u', 'D11', 'rb', '1'), w('rb', '2', 'c', 'B'),
        w('c', '-', 'u', 'GND.1'), w('u', 'D6', 'rx', '1'), w('rx', '2', 'l', 'anode'), w('l', 'cathode', 'u', 'GND.2')
      ]
    }
    const on = solveCircuit(c, drives([['D9', { mode: 'output', duty: 1 }], ['D10', { mode: 'output', duty: 1 }]]))
    const full = on.leds.get('c:R')!.current
    const fullG = on.leds.get('c:G')!.current
    const r = solveCircuit(c, drives([['D9', { mode: 'output', duty: 0.1 }], ['D10', { mode: 'output', duty: 0.9 }], ['D11', { mode: 'tone', duty: 0.5, freq: 440 }]]))
    expect(r.leds.get('c:R')!.current).toBeCloseTo(full * 0.1, 4)
    expect(r.leds.get('c:G')!.current).toBeCloseTo(fullG * 0.9, 4)
    expect(r.leds.get('c:B')!.current).toBeGreaterThan(0)
    // four PWM pins: each is taken at its average voltage — still ordered by duty
    const many = solveCircuit(c, drives([['D9', { mode: 'output', duty: 0.2 }], ['D10', { mode: 'output', duty: 0.8 }], ['D11', { mode: 'output', duty: 0.5 }], ['D6', { mode: 'output', duty: 0.5 }]]))
    expect(many.leds.get('c:G')!.current).toBeGreaterThan(fullG * 0.5)
    expect(many.leds.get('c:R')!.current).toBeLessThan(full * 0.3)
  })

  it('an RGB LED lights the colours whose pins are high; a 7-segment display its segments', () => {
    const rgb: Circuit = {
      parts: [uno(), part('rgb', 'c'), part('resistor', 'rr', { ohms: 220 }), part('resistor', 'rb', { ohms: 100 })],
      wires: [w('u', 'D9', 'rr', '1'), w('rr', '2', 'c', 'R'), w('u', 'D11', 'rb', '1'), w('rb', '2', 'c', 'B'), w('c', '-', 'u', 'GND.1')]
    }
    const r = solveCircuit(rgb, drives([['D9', { mode: 'output', duty: 1 }]]))
    expect(r.leds.get('c:R')!.brightness).toBeGreaterThan(0.5)
    expect(r.leds.get('c:B')!.current).toBe(0)
    expect(r.leds.get('c:G')!.current).toBe(0)
    const seg: Circuit = {
      parts: [uno(), part('seg7', 'd'), part('resistor', 'r', { ohms: 220 })],
      wires: [w('u', 'D2', 'r', '1'), w('r', '2', 'd', 'a'), w('d', 'COM.2', 'u', 'GND.1')]
    }
    const s = solveCircuit(seg, drives([['D2', { mode: 'output', duty: 1 }]]))
    expect(s.leds.get('d:a')!.brightness).toBeGreaterThan(0.5)
    expect(s.leds.get('d:b')!.current).toBe(0)
  })
})

describe('motors, transistors, diodes, the multimeter', () => {
  /** a 9 V battery → motor → transistor's collector; its emitter to ground; D9 → 220 Ω → base (enough to saturate it) */
  const driver = (): Circuit => ({
    parts: [uno(), part('battery', 'b'), part('motor', 'm'), part('npn', 't'), part('resistor', 'rb', { ohms: 220 }), part('diode', 'd')],
    wires: [
      w('b', '+', 'm', '1'),
      w('m', '2', 't', 'C'),
      w('t', 'E', 'u', 'GND.1'),
      w('b', '-', 'u', 'GND.2'),
      w('u', 'D9', 'rb', '1'),
      w('rb', '2', 't', 'B'),
      // the flyback diode across the motor, cathode to +
      w('d', 'K', 'b', '+'),
      w('d', 'A', 'm', '2')
    ]
  })

  it('a transistor switches the motor on a battery from an Arduino pin; the diode stays off', () => {
    const off = solveCircuit(driver(), drives([['D9', { mode: 'output', duty: 0 }]]))
    expect(Math.abs(off.currents.get('m')!)).toBeLessThan(1e-4)
    const on = solveCircuit(driver(), drives([['D9', { mode: 'output', duty: 1 }]]))
    // saturated: almost the whole 9 V across the motor (15 Ω)
    expect(on.currents.get('m')!).toBeGreaterThan(0.5)
    expect(on.voltage.get('t:C')!).toBeLessThan(1)
    // the pin only gives the base current (~15 mA), the battery the motor's
    expect(on.overloaded).toEqual([])
    expect(on.currents.get('d')!).toBe(0)
    // half PWM: about half the current on average
    const half = solveCircuit(driver(), drives([['D9', { mode: 'output', duty: 0.5 }]]))
    expect(half.currents.get('m')!).toBeCloseTo(on.currents.get('m')! / 2, 1)
    // with 1 kΩ on the base the transistor is not fully on: the current is β times the base current
    const weak = driver()
    weak.parts = weak.parts.map((p) => (p.id === 'rb' ? { ...p, ohms: 1000 } : p))
    const r = solveCircuit(weak, drives([['D9', { mode: 'output', duty: 1 }]]))
    expect(r.currents.get('m')!).toBeLessThan(on.currents.get('m')!)
    expect(r.voltage.get('t:C')!).toBeGreaterThan(1)
  })

  it('a motor straight on a pin overloads it', () => {
    const c: Circuit = { parts: [uno(), part('motor', 'm')], wires: [w('u', 'D9', 'm', '1'), w('m', '2', 'u', 'GND.1')] }
    expect(solveCircuit(c, drives([['D9', { mode: 'output', duty: 1 }]])).overloaded).toEqual(['u:D9'])
  })

  it('in the active region the collector current is β times the base current', () => {
    const c: Circuit = {
      parts: [uno(), part('npn', 't'), part('resistor', 'rb', { ohms: 100_000 }), part('resistor', 'rc', { ohms: 100 })],
      wires: [w('u', '5V', 'rb', '1'), w('rb', '2', 't', 'B'), w('u', '5V', 'rc', '1'), w('rc', '2', 't', 'C'), w('t', 'E', 'u', 'GND.1')]
    }
    const r = solveCircuit(c, new Map())
    const ib = (5 - r.voltage.get('t:B')!) / 100_000
    const ic = (5 - r.voltage.get('t:C')!) / 100
    expect(ic / ib).toBeCloseTo(100, 0)
    expect(r.voltage.get('t:C')!).toBeGreaterThan(0.3)
  })

  it('pinMode OUTPUT keeps a level already written, as on a real board; a second start script is noted in the C++', () => {
    const prog = workspaceJson([
      start([blk('ard_digital_write', {}, { PIN: 'D13', STATE: 'HIGH' }), blk('ard_pin_mode', {}, { PIN: 'D13', MODE: 'OUTPUT' }), blk('ard_pin_mode', {}, { PIN: 'D7', MODE: 'OUTPUT' })]),
      start([blk('ard_digital_write', {}, { PIN: 'D7', STATE: 'LOW' })])
    ])
    const run = new CircuitRun({ parts: [uno(prog)], wires: [] })
    run.run(0.1)
    expect(run.result.builtin.get('u')).toBe(1)
    expect(arduinoCode(prog)).toContain('// block not supported: robo_start ×1')
  })

  it('the multimeter: volts across, amps in series', () => {
    const v: Circuit = { parts: [uno(), part('meter', 'm')], wires: [w('m', 'V', 'u', '3.3V'), w('m', 'COM', 'u', 'GND.1')] }
    const run = new CircuitRun(v)
    expect(run.live.get('m')!.reading).toBeCloseTo(3.3, 1)
    const a: Circuit = {
      parts: [uno(), part('meter', 'm', { mode: 'A' }), part('resistor', 'r', { ohms: 220 }), part('led', 'l', { color: 'red' })],
      wires: [w('u', '5V', 'm', 'V'), w('m', 'COM', 'r', '1'), w('r', '2', 'l', 'anode'), w('l', 'cathode', 'u', 'GND.1')]
    }
    const ra = new CircuitRun(a)
    expect(ra.live.get('m')!.reading).toBeCloseTo(ra.result.leds.get('l')!.current, 5)
    expect(ra.live.get('m')!.reading).toBeGreaterThan(0.012)
  })
})

describe('the room and the sensors', () => {
  it('light: the room, a lamp close by, an LED right next to it; a photoresistor follows', () => {
    const dark = room({ light: 1 })
    expect(lightAt(dark, 0, 0)).toBeCloseTo(1)
    const lamp = room({ light: 1, items: [{ id: 'L', kind: 'lamp', x: 40, y: 0, on: true }] })
    expect(lightAt(lamp, 0, 0)).toBeGreaterThan(1000)
    expect(lightAt({ ...lamp, items: [{ ...lamp.items[0], on: false }] }, 0, 0)).toBeCloseTo(1)
    // a lamp moved far away (past its pool of light) adds nothing; at the edge of the pool, a little
    expect(lightAt(room({ light: 1, items: [{ id: 'L', kind: 'lamp', x: 400, y: 0, on: true }] }), 0, 0)).toBeCloseTo(1)
    const edge = lightAt(room({ light: 1, items: [{ id: 'L', kind: 'lamp', x: 200, y: 0, on: true }] }), 0, 0)
    expect(edge).toBeGreaterThan(20)
    expect(edge).toBeLessThan(80)
    expect(lightAt(dark, 0, 0, [{ x: 5, y: 0, brightness: 1 }])).toBeGreaterThan(200)
    expect(ldrOhms(1)).toBeGreaterThan(40_000)
    expect(ldrOhms(300)).toBeLessThan(1500)
  })

  it('a photoresistor divider on A0 reads the room, then a lamp put next to it', () => {
    const prog = workspaceJson([start([blk('robo_forever', { DO: { block: blk('ard_serial_println', { TEXT: { block: blk('ard_analog_read', {}, { PIN: 'A0' }) } }) } })])])
    const c: Circuit = {
      parts: [uno(prog), part('ldr', 'p', { x: 0, y: 100 }), part('resistor', 'r', { ohms: 10_000 })],
      wires: [w('u', '5V', 'p', '1'), w('p', '2', 'u', 'A0'), w('u', 'A0', 'r', '1'), w('r', '2', 'u', 'GND.1')],
      room: room({ light: 2 })
    }
    const run = new CircuitRun(c)
    run.run(0.2)
    const darkRead = Number(run.serial[run.serial.length - 1])
    run.setRoom(room({ light: 2, items: [{ id: 'L', kind: 'lamp', x: 2.54, y: 110, on: true }] }))
    run.run(0.2)
    const lit = Number(run.serial[run.serial.length - 1])
    expect(darkRead).toBeLessThan(400)
    expect(lit).toBeGreaterThan(900)
  })

  it('temperature: the room, warmer next to a mug of hot tea; the TMP36 gives 10 mV per degree', () => {
    const r = room({ temp: 20, items: [{ id: 'h', kind: 'heater', x: 100, y: 0 }] })
    expect(tempAt(r, 1000, 0)).toBeCloseTo(20, 1)
    expect(tempAt(r, 75, 0)).toBeGreaterThan(50)
    const c: Circuit = {
      parts: [uno(), part('tmp36', 't')],
      wires: [w('t', 'VS', 'u', '5V'), w('t', 'GND', 'u', 'GND.1'), w('t', 'OUT', 'u', 'A0')],
      room: room({ temp: 25 })
    }
    const run = new CircuitRun(c)
    expect(run.result.voltage.get('u:A0')!).toBeCloseTo(0.75, 2)
    // without power it gives nothing
    const unpowered = new CircuitRun({ ...c, wires: c.wires.filter((x) => x.a.pin !== 'VS') })
    expect(unpowered.result.voltage.get('u:A0')!).toBeLessThan(0.05)
  })

  it('the ultrasonic sensor: the distance block reads the box in front of it (and nothing to the side)', () => {
    const prog = workspaceJson([start([blk('robo_forever', { DO: { block: blk('ard_serial_println', { TEXT: { block: blk('ard_ultrasonic', {}, { TRIG: 'D9', ECHO: 'D10' }) } }) } })])])
    const s = part('hcsr04', 's', { x: 0, y: 0 })
    const c: Circuit = {
      parts: [uno(prog), s],
      wires: [w('s', 'VCC', 'u', '5V'), w('s', 'GND', 'u', 'GND.1'), w('s', 'TRIG', 'u', 'D9'), w('s', 'ECHO', 'u', 'D10')],
      // it looks toward −y: the box's near side is 200 mm away
      room: room({ items: [{ id: 'b', kind: 'box', x: 3.81, y: -13.6 - 200 - 25 }] })
    }
    expect(distanceAhead(c.room!, s, 4000, 15)).toBeCloseTo(200, 0)
    const run = new CircuitRun(c)
    run.run(0.1)
    expect(run.serial[run.serial.length - 1]).toBe('20')
    // the box moved off to the side: no echo
    run.setRoom(room({ items: [{ id: 'b', kind: 'box', x: 600, y: -100 }] }))
    run.run(0.1)
    expect(run.serial[run.serial.length - 1]).toBe('0')
  })

  it('the IR sensor goes low with something close in front; the motion sensor fires when a hand moves', () => {
    const c: Circuit = {
      parts: [uno(), part('ir', 'i'), part('pir', 'p', { x: 200, y: 0 })],
      wires: [
        w('i', 'VCC', 'u', '5V'),
        w('i', 'GND', 'u', 'GND.1'),
        w('i', 'OUT', 'u', 'D2'),
        w('p', 'VCC', 'u', '5V'),
        w('p', 'GND', 'u', 'GND.2'),
        w('p', 'OUT', 'u', 'D3')
      ],
      room: room({ items: [{ id: 'h', kind: 'hand', x: 202, y: -400 }] })
    }
    const run = new CircuitRun(c)
    expect(run.result.voltage.get('u:D2')!).toBeGreaterThan(4)
    expect(run.result.voltage.get('u:D3')!).toBeLessThan(0.1)
    // a box right in front of the IR sensor
    run.setRoom(room({ items: [{ id: 'h', kind: 'hand', x: 202, y: -400 }, { id: 'b', kind: 'box', x: 2.54, y: -32 - 60 - 25 }] }))
    expect(run.result.voltage.get('u:D2')!).toBeLessThan(0.1)
    // the hand waves in front of the motion sensor: on, then off again after a while
    run.setRoom(room({ items: [{ id: 'h', kind: 'hand', x: 260, y: -400 }] }))
    run.run(0.1)
    expect(run.result.voltage.get('u:D3')!).toBeGreaterThan(3)
    run.run(3)
    expect(run.result.voltage.get('u:D3')!).toBeLessThan(0.1)
  })
})

describe('buzzers, the LCD, the joystick, the new blocks', () => {
  it('a passive buzzer sounds the tone of its pin; an active one beeps on plain HIGH', () => {
    const prog = workspaceJson([start([blk('ard_tone_for', { FREQ: num(880), MS: num(300) }, { PIN: 'D8' })])])
    const c: Circuit = { parts: [uno(prog), part('buzzer', 'z')], wires: [w('u', 'D8', 'z', '+'), w('z', '-', 'u', 'GND.1')] }
    const run = new CircuitRun(c)
    run.run(0.1)
    expect(run.live.get('z')!.freq).toBe(880)
    run.run(0.4)
    expect(run.live.get('z')!.freq).toBeUndefined()
    const active = new CircuitRun({ ...c, parts: [uno(workspaceJson([start([blk('ard_digital_write', {}, { PIN: 'D8', STATE: 'HIGH' })])])), part('buzzer', 'z', { active: true })] })
    active.run(0.05)
    expect(active.live.get('z')!.freq).toBe(2300)
  })

  it('the LCD shows what is printed when it is on A4/A5 with power, and nothing otherwise', () => {
    const prog = workspaceJson([
      start([
        blk('ard_lcd_print', { COL: num(0), TEXT: txt('Привет') }, { ROW: '0' }),
        blk('ard_lcd_print', { COL: num(3), TEXT: { block: blk('robo_arith', { A: num(2), B: num(3) }, { OP: 'ADD' }) } }, { ROW: '1' })
      ])
    ])
    const wired: Circuit = {
      parts: [uno(prog), part('lcd', 'd')],
      wires: [w('d', 'VCC', 'u', '5V'), w('d', 'GND', 'u', 'GND.1'), w('d', 'SDA', 'u', 'A4'), w('d', 'SCL', 'u', 'A5')]
    }
    const run = new CircuitRun(wired)
    run.run(0.1)
    expect(run.live.get('d')!.lines).toEqual(['Привет'.padEnd(16), '   5'.padEnd(16)])
    const swapped = new CircuitRun({ ...wired, wires: [w('d', 'VCC', 'u', '5V'), w('d', 'GND', 'u', 'GND.1'), w('d', 'SDA', 'u', 'A5'), w('d', 'SCL', 'u', 'A4')] })
    swapped.run(0.1)
    expect(swapped.live.get('d')!.lines!.join('').trim()).toBe('')
  })

  it('the joystick: its axes on A0/A1, its button pulls SW to ground', () => {
    const c: Circuit = {
      parts: [uno(), part('joystick', 'j')],
      wires: [w('j', 'GND', 'u', 'GND.1'), w('j', '5V', 'u', '5V'), w('j', 'VRx', 'u', 'A0'), w('j', 'VRy', 'u', 'A1'), w('j', 'SW', 'u', 'D2')]
    }
    const run = new CircuitRun(c)
    expect(run.result.voltage.get('u:A0')!).toBeCloseTo(2.5, 1)
    run.setJoy('j', 1, 0)
    expect(run.result.voltage.get('u:A0')!).toBeGreaterThan(4.9)
    expect(run.result.voltage.get('u:A1')!).toBeLessThan(0.1)
    run.press('j', true)
    expect(run.result.voltage.get('u:D2')!).toBeLessThan(0.01)
  })

  it('C++ for the new blocks: pinMode, tone, the LCD library, the distance helper', () => {
    const prog = workspaceJson([
      start([
        blk('ard_pin_mode', {}, { PIN: 'D2', MODE: 'INPUT_PULLUP' }),
        blk('ard_tone', { FREQ: num(440) }, { PIN: 'D8' }),
        blk('ard_lcd_print', { COL: num(0), TEXT: { block: blk('ard_ultrasonic', {}, { TRIG: 'D9', ECHO: 'D10' }) } }, { ROW: '1' }),
        blk('ard_no_tone', {}, { PIN: 'D8' })
      ])
    ])
    const code = arduinoCode(prog)
    expect(code).toContain('#include <LiquidCrystal_I2C.h>')
    expect(code).toContain('LiquidCrystal_I2C lcd(0x27, 16, 2);')
    expect(code).toContain('  lcd.init();')
    expect(code).toContain('  pinMode(2, INPUT_PULLUP);')
    expect(code).toContain('  tone(8, 440);')
    expect(code).toContain('  lcd.setCursor(0, 1);\n  lcd.print(distanceCm(9, 10));')
    expect(code).toContain('return pulseIn(echo, HIGH, 30000) / 58;')
    expect(code).toContain('  pinMode(9, OUTPUT);\n  pinMode(10, INPUT);')
    expect(code).toContain('  noTone(8);')
  })

  it('files keep the new parts, their settings and the room; nonsense is refused', () => {
    const c: Circuit = {
      parts: [part('battery', 'b', { volts: 3 }), part('meter', 'm', { mode: 'A' }), part('switch', 's', { on: true }), part('buzzer', 'z', { active: true }), part('pir', 'p')],
      wires: [],
      room: room({ temp: 30, light: 50, items: [{ id: 'L', kind: 'lamp', x: 1, y: 2, on: true }, { id: 'B', kind: 'box', x: 3, y: 4 }] })
    }
    const back = validateCircuit(JSON.parse(JSON.stringify(c)))!
    expect(back).toEqual(c)
    expect(validateCircuit({ ...c, room: { ...c.room, items: [{ id: 'x', kind: 'dragon', x: 0, y: 0 }] } })).toBeNull()
    expect(validateCircuit({ ...c, room: { ...c.room, items: [{ id: 'b', kind: 'box', x: 0, y: 0 }] } })).toBeNull()
  })
})

describe('the 0.3 examples', () => {
  it('night light: off in a lit room, on in the dark, off again with the lamp switched on next to it', async () => {
    const { nightLightCircuit } = await import('@/core/circuit/demo')
    const c = nightLightCircuit()
    const led = c.parts.find((p) => p.kind === 'led')!.id
    const run = new CircuitRun(c)
    run.run(0.5)
    expect(run.result.leds.get(led)!.current).toBe(0)
    run.setRoom({ ...c.room!, light: 1 })
    run.run(0.5)
    expect(run.result.leds.get(led)!.brightness).toBeGreaterThan(0.5)
    run.setRoom({ ...c.room!, light: 1, items: c.room!.items.map((it) => ({ ...it, on: true })) })
    run.run(0.5)
    expect(run.result.leds.get(led)!.current).toBe(0)
  })

  it('parking sensor: the LCD shows the distance to the box; it beeps when the box comes closer than 30 cm', async () => {
    const { parkingCircuit } = await import('@/core/circuit/demo')
    const c = parkingCircuit()
    const lcd = c.parts.find((p) => p.kind === 'lcd')!.id
    const bz = c.parts.find((p) => p.kind === 'buzzer')!.id
    const run = new CircuitRun(c)
    run.run(0.5)
    expect(run.live.get(lcd)!.lines![0].trim()).toBe('Distance:')
    expect(run.live.get(lcd)!.lines![1].trim()).toBe('25  cm')
    const box = c.room!.items[0]
    run.setRoom({ ...c.room!, items: [{ ...box, y: box.y + 150 }] })
    let beeped = false
    run.run(0.6, () => (beeped ||= run.live.get(bz)!.freq === 1000))
    expect(run.live.get(lcd)!.lines![1].trim()).toBe('10  cm')
    expect(beeped).toBe(true)
  })

  it('button and motor: the motor runs only while the button is held', async () => {
    const { motorButtonCircuit } = await import('@/core/circuit/demo')
    const c = motorButtonCircuit()
    const btn = c.parts.find((p) => p.kind === 'button')!.id
    const mot = c.parts.find((p) => p.kind === 'motor')!.id
    const run = new CircuitRun(c)
    run.run(0.2)
    expect(run.live.get(mot)!.speed).toBe(0)
    run.press(btn, true)
    run.run(0.2)
    expect(run.live.get(mot)!.speed!).toBeGreaterThan(2)
    expect(run.result.overloaded).toEqual([])
    expect(run.result.short).toBe(false)
    run.press(btn, false)
    run.run(0.2)
    expect(run.live.get(mot)!.speed).toBe(0)
  })
})
