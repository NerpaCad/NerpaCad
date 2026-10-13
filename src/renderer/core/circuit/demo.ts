/** The "Blink" demo: pin 13 → 220 Ω → red LED → GND, and a program that blinks it once a second. */
import type { BlockJson } from '../robotics/interpreter'
import { newId } from '../doc/model'
import type { Circuit } from './model'

const wait = (s: number): BlockJson => ({ type: 'robo_wait', id: newId(), inputs: { SECONDS: { shadow: { type: 'robo_number', id: newId(), fields: { NUM: s } } } } })
const write = (pin: string, high: boolean): BlockJson => ({ type: 'ard_digital_write', id: newId(), fields: { PIN: pin, STATE: high ? 'HIGH' : 'LOW' } })
const chain = (list: BlockJson[]) => {
  for (let i = 0; i < list.length - 1; i++) list[i].next = { block: list[i + 1] }
  return list[0]
}

export function blinkProgram(pin = 'D13') {
  const loop: BlockJson = { type: 'robo_forever', id: newId(), inputs: { DO: { block: chain([write(pin, true), wait(1), write(pin, false), wait(1)]) } } }
  const start = { type: 'robo_start', id: newId(), x: 30, y: 30, next: { block: loop } }
  return { blocks: { languageVersion: 0, blocks: [start] } }
}

export function blinkCircuit(): Circuit {
  const uno = newId()
  const r = newId()
  const led = newId()
  return {
    parts: [
      { id: uno, kind: 'arduino', x: 0, y: 0, rot: 0, program: blinkProgram() },
      { id: r, kind: 'resistor', x: 86, y: -24, rot: 0, ohms: 220 },
      { id: led, kind: 'led', x: 104, y: -24, rot: 180, color: 'red' }
    ],
    wires: [
      { id: newId(), a: { part: uno, pin: 'D13' }, b: { part: r, pin: '1' }, points: [[27.66, -24]], color: '#ef7d1a' },
      { id: newId(), a: { part: r, pin: '2' }, b: { part: led, pin: 'anode' }, points: [], color: '#d8352a' },
      { id: newId(), a: { part: led, pin: 'cathode' }, b: { part: uno, pin: 'GND.1' }, points: [[104, -34], [25.12, -34]], color: '#222222' }
    ]
  }
}

// ---------------------------------------------------------------- breadboard example

const P = 2.54
const G = 1.27
const num = (v: number) => ({ shadow: { type: 'robo_number', id: newId(), fields: { NUM: v } } })
const arith = (op: string, a: unknown, b: unknown): BlockJson => ({ type: 'robo_arith', id: newId(), fields: { OP: op }, inputs: { A: a, B: b } }) as BlockJson

/** Read the knob, turn the servo and dim the LED with it, print the value — ten times a second. */
export function breadboardProgram() {
  const v = newId()
  const get = () => ({ block: { type: 'variables_get', id: newId(), fields: { VAR: { id: v } } } })
  const body = chain([
    { type: 'variables_set', id: newId(), fields: { VAR: { id: v } }, inputs: { VALUE: { block: { type: 'ard_analog_read', id: newId(), fields: { PIN: 'A0' } } } } },
    { type: 'ard_servo', id: newId(), fields: { PIN: 'D9' }, inputs: { ANGLE: { block: arith('DIV', { block: arith('MUL', get(), num(180)) }, num(1023)) } } },
    { type: 'ard_analog_write', id: newId(), fields: { PIN: 'D6' }, inputs: { VALUE: { block: arith('DIV', get(), num(4)) } } },
    { type: 'ard_serial_println', id: newId(), inputs: { TEXT: get() } },
    wait(0.1)
  ] as BlockJson[])
  const loop: BlockJson = { type: 'robo_forever', id: newId(), inputs: { DO: { block: body } } }
  const start = { type: 'robo_start', id: newId(), x: 30, y: 30, next: { block: loop } }
  return { variables: [{ name: 'значение', id: v }], blocks: { languageVersion: 0, blocks: [start] } }
}

/**
 * A potentiometer on a breadboard feeds A0; the program turns a servo on pin 9 and dims an LED
 * on pin 6 (through a 220 Ω resistor on the board) with it. The rails carry 5 V and GND.
 */
export function breadboardCircuit(): Circuit {
  const uno = newId()
  const bb = newId()
  const pot = newId()
  const led = newId()
  const res = newId()
  const servo = newId()
  const bx = 80 * G
  const by = 0
  /** position of hole (1-based column, row in pitches) */
  const hole = (col: number, row: number): [number, number] => [bx + (col - 1) * P, by + row * P]
  const w = (a: [string, string], b: [string, string], color: string, points: [number, number][] = []) => ({
    id: newId(),
    a: { part: a[0], pin: a[1] },
    b: { part: b[0], pin: b[1] },
    points,
    color
  })
  const [px, py] = hole(3, 7)
  const [lx, ly] = hole(12, 10)
  const [rx, ry] = hole(13, 12)
  return {
    parts: [
      { id: uno, kind: 'arduino', x: 0, y: 0, rot: 0, program: breadboardProgram() },
      { id: bb, kind: 'breadboard', x: bx, y: by, rot: 0 },
      // legs in e3 (GND side), e4 (wiper), e5 (5 V side)
      { id: pot, kind: 'pot', x: px, y: py, rot: 0, ohms: 10_000, knob: 0.5 },
      // cathode f12, anode f13
      { id: led, kind: 'led', x: lx, y: ly, rot: 0, color: 'green' },
      // h13 … h17
      { id: res, kind: 'resistor', x: rx, y: ry, rot: 0, ohms: 220 },
      { id: servo, kind: 'servo', x: bx + 71 * G, y: by + 36 * G, rot: 0 }
    ],
    wires: [
      // wires routed around the board edges (bends in mm)
      w([uno, '5V'], [bb, 'tp1'], '#d8352a', [[36.86, 58], [92, 58], [92, 2.54]]),
      w([uno, 'GND.2'], [bb, 'tn1'], '#222222', [[39.4, 60.5], [89.5, 60.5], [89.5, 0]]),
      // the bottom rails get power too
      w([bb, 'tp25'], [bb, 'bp25'], '#d8352a'),
      w([bb, 'tn24'], [bb, 'bn24'], '#222222'),
      w([bb, 'a3'], [bb, 'tn3'], '#222222'),
      w([bb, 'a5'], [bb, 'tp5'], '#d8352a'),
      w([bb, 'a4'], [uno, 'A0'], '#e8b10b', [[94.5, 7.62], [94.5, 55.5], [49.8, 55.5]]),
      w([bb, 'j12'], [bb, 'bn10'], '#222222'),
      w([uno, 'D6'], [bb, 'j17'], '#2e9e44', [[46.74, -5], [97, -5], [97, 38.3], [142.24, 38.3]]),
      w([servo, 'GND'], [bb, 'bn20'], '#222222', [[bx + 71 * G, 50], [bx + 22.5 * P, 50]]),
      w([servo, '5V'], [bb, 'bp20'], '#d8352a', [[bx + 71 * G + P, 47.8], [bx + 23.6 * P, 47.8], [bx + 23.6 * P, 16 * P]]),
      w([servo, 'SIG'], [uno, 'D9'], '#ef7d1a', [[bx + 71 * G + 2 * P, 53], [208, 53], [208, -8], [37.82, -8]])
    ]
  }
}
