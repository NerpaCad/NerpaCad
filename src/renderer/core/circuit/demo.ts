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

// ---------------------------------------------------------------- 0.3 examples

type Pt = [number, number]
const wire = (a: [string, string], b: [string, string], color: string, points: Pt[] = []) => ({
  id: newId(),
  a: { part: a[0], pin: a[1] },
  b: { part: b[0], pin: b[1] },
  points,
  color
})
const blk = (type: string, inputs: Record<string, unknown> = {}, fields: Record<string, unknown> = {}): BlockJson => ({ type, id: newId(), inputs, fields }) as BlockJson
const txt = (s: string) => ({ shadow: { type: 'robo_text', id: newId(), fields: { TEXT: s } } })
const startWith = (body: BlockJson[], variables: { name: string; id: string }[] = []) => ({
  ...(variables.length ? { variables } : {}),
  blocks: { languageVersion: 0, blocks: [{ type: 'robo_start', id: newId(), x: 30, y: 30, next: { block: chain(body) } }] }
})
const RED = '#d8352a'
const BLACK = '#222222'

/**
 * A night light: a photoresistor and a 10 kΩ resistor make a divider on A0; when the room gets
 * dark the reading falls and the LED on pin 9 comes on. A desk lamp (off) lies next to it.
 */
export function nightLightCircuit(): Circuit {
  const uno = newId()
  const ldr = newId()
  const rd = newId()
  const led = newId()
  const rl = newId()
  const v = newId()
  const get = () => ({ block: { type: 'variables_get', id: newId(), fields: { VAR: { id: v } } } })
  const loop = blk('robo_forever', {
    DO: {
      block: chain([
        blk('variables_set', { VALUE: { block: blk('ard_analog_read', {}, { PIN: 'A0' }) } }, { VAR: { id: v } }),
        blk('ard_serial_println', { TEXT: get() }),
        blk(
          'robo_if_else',
          {
            COND: { block: blk('robo_compare', { A: get(), B: num(500) }, { OP: 'LT' }) },
            DO: { block: blk('ard_digital_write', {}, { PIN: 'D9', STATE: 'HIGH' }) },
            ELSE: { block: blk('ard_digital_write', {}, { PIN: 'D9', STATE: 'LOW' }) }
          },
          {}
        ),
        wait(0.2)
      ])
    }
  })
  return {
    parts: [
      { id: uno, kind: 'arduino', x: 0, y: 0, rot: 0, program: startWith([loop], [{ name: 'свет', id: v }]) },
      { id: ldr, kind: 'ldr', x: 85, y: 70, rot: 0 },
      { id: rd, kind: 'resistor', x: 95, y: 80, rot: 0, ohms: 10_000 },
      { id: led, kind: 'led', x: 85, y: -25, rot: 0, color: 'yellow' },
      { id: rl, kind: 'resistor', x: 95, y: -35, rot: 0, ohms: 220 }
    ],
    wires: [
      wire([uno, '5V'], [ldr, '1'], RED, [[36.86, 70]]),
      wire([ldr, '2'], [rd, '1'], '#e8b10b', [[90.08, 80]]),
      wire([rd, '2'], [uno, 'GND.3'], BLACK, [[110, 80], [110, 88], [41.94, 88]]),
      wire([uno, 'A0'], [ldr, '2'], '#e8b10b', [[49.8, 64], [90.08, 64]]),
      wire([uno, 'D9'], [rl, '2'], '#2e9e44', [[37.82, -45], [105.16, -45]]),
      wire([rl, '1'], [led, 'anode'], RED, [[95, -25]]),
      wire([led, 'cathode'], [uno, 'GND.1'], BLACK, [[80, -25], [80, -12], [25.12, -12]])
    ],
    room: { temp: 22, light: 300, items: [{ id: newId(), kind: 'lamp', x: 150, y: 70 }] }
  }
}

/**
 * A parking sensor: the ultrasonic sensor measures the distance to the box in front of it, the
 * LCD shows it, the buzzer beeps when the box is closer than 30 cm.
 */
export function parkingCircuit(): Circuit {
  const uno = newId()
  const sonar = newId()
  const buzzer = newId()
  const lcd = newId()
  const d = newId()
  const get = () => ({ block: { type: 'variables_get', id: newId(), fields: { VAR: { id: d } } } })
  const near = blk('robo_logic', { A: { block: blk('robo_compare', { A: get(), B: num(0) }, { OP: 'GT' }) }, B: { block: blk('robo_compare', { A: get(), B: num(30) }, { OP: 'LT' }) } }, { OP: 'AND' })
  const loop = blk('robo_forever', {
    DO: {
      block: chain([
        blk('variables_set', { VALUE: { block: blk('ard_ultrasonic', {}, { TRIG: 'D9', ECHO: 'D10' }) } }, { VAR: { id: d } }),
        // wipe the old number first (a shorter one would leave its last digits on the screen)
        blk('ard_lcd_print', { COL: num(0), TEXT: txt('    ') }, { ROW: '1' }),
        blk('ard_lcd_print', { COL: num(0), TEXT: get() }, { ROW: '1' }),
        blk('ard_lcd_print', { COL: num(4), TEXT: txt('cm      ') }, { ROW: '1' }),
        blk('robo_if', { COND: { block: near }, DO: { block: blk('ard_tone_for', { FREQ: num(1000), MS: num(80) }, { PIN: 'D8' }) } }),
        wait(0.2)
      ])
    }
  })
  return {
    parts: [
      {
        id: uno,
        kind: 'arduino',
        x: 0,
        y: 0,
        rot: 0,
        program: startWith([blk('ard_lcd_print', { COL: num(0), TEXT: txt('Distance:') }, { ROW: '0' }), loop], [{ name: 'расстояние', id: d }])
      },
      { id: sonar, kind: 'hcsr04', x: 100, y: -10, rot: 0 },
      { id: buzzer, kind: 'buzzer', x: 130, y: 30, rot: 0 },
      { id: lcd, kind: 'lcd', x: 100, y: 110, rot: 0 }
    ],
    wires: [
      wire([sonar, 'VCC'], [uno, '5V'], RED, [[100, 20], [70, 20], [70, 58], [36.86, 58]]),
      wire([sonar, 'GND'], [uno, 'GND.1'], BLACK, [[107.62, -3], [92, -3], [92, -16], [25.12, -16]]),
      wire([sonar, 'TRIG'], [uno, 'D9'], '#ef7d1a', [[102.54, 12], [80, 12], [80, -6], [37.82, -6]]),
      wire([sonar, 'ECHO'], [uno, 'D10'], '#2e9e44', [[105.08, 8], [84, 8], [84, -10], [35.28, -10]]),
      wire([buzzer, '+'], [uno, 'D8'], '#8a45c7', [[130, 16], [118, 16], [118, -20], [40.36, -20]]),
      wire([buzzer, '-'], [uno, 'GND.2'], BLACK, [[137.62, 62], [39.4, 62]]),
      wire([lcd, 'GND'], [uno, 'GND.3'], BLACK, [[100, 118], [41.94, 118]]),
      wire([lcd, 'VCC'], [uno, '5V'], RED, [[102.54, 122], [36.86, 122]]),
      wire([lcd, 'SDA'], [uno, 'A4'], '#2f6fd6', [[105.08, 126], [59.96, 126]]),
      wire([lcd, 'SCL'], [uno, 'A5'], '#e8b10b', [[107.62, 130], [62.5, 130]])
    ],
    room: { temp: 22, light: 300, items: [{ id: newId(), kind: 'box', x: 103.81, y: -10 - 13.6 - 250 - 25 }] }
  }
}

/**
 * A button starts a motor: the button pulls pin 2 to ground (its pull-up on), pin 9 switches a
 * transistor through 220 Ω; the motor runs from a 9 V battery, a diode guards the transistor.
 */
export function motorButtonCircuit(): Circuit {
  const uno = newId()
  const btn = newId()
  const bat = newId()
  const mot = newId()
  const npn = newId()
  const rb = newId()
  const dio = newId()
  const pressed = blk('robo_not', { A: { block: blk('ard_digital_read', {}, { PIN: 'D2' }) } })
  const loop = blk('robo_forever', {
    DO: {
      block: blk('robo_if_else', {
        COND: { block: pressed },
        DO: { block: blk('ard_digital_write', {}, { PIN: 'D9', STATE: 'HIGH' }) },
        ELSE: { block: blk('ard_digital_write', {}, { PIN: 'D9', STATE: 'LOW' }) }
      })
    }
  })
  return {
    parts: [
      { id: uno, kind: 'arduino', x: 0, y: 0, rot: 0, program: startWith([blk('ard_pin_mode', {}, { PIN: 'D2', MODE: 'INPUT_PULLUP' }), loop]) },
      { id: btn, kind: 'button', x: 85, y: 20, rot: 0 },
      { id: bat, kind: 'battery', x: 170, y: 40, rot: 0, volts: 9 },
      { id: mot, kind: 'motor', x: 120, y: 60, rot: 0 },
      { id: npn, kind: 'npn', x: 120, y: 95, rot: 0 },
      { id: rb, kind: 'resistor', x: 90, y: 105, rot: 0, ohms: 220 },
      { id: dio, kind: 'diode', x: 140, y: 75, rot: 0 }
    ],
    wires: [
      wire([uno, 'D2'], [btn, '1a'], '#2e9e44', [[56.9, -4], [78, -4], [78, 20]]),
      wire([btn, '2b'], [uno, 'GND.1'], BLACK, [[95, 14.92], [95, -8], [25.12, -8]]),
      wire([bat, '+'], [mot, '1'], RED, [[170, 48], [120, 48]]),
      wire([bat, '-'], [uno, 'GND.3'], BLACK, [[172.54, 125], [41.94, 125]]),
      wire([mot, '2'], [npn, 'C'], '#ef7d1a', [[127.62, 85], [125.08, 85]]),
      wire([npn, 'E'], [uno, 'GND.2'], BLACK, [[115, 95], [115, 118], [39.4, 118]]),
      wire([uno, 'D9'], [rb, '1'], '#2f6fd6', [[37.82, -14], [70, -14], [70, 105]]),
      wire([rb, '2'], [npn, 'B'], '#2f6fd6', [[122.54, 105]]),
      wire([dio, 'A'], [mot, '2'], '#8a45c7', [[140, 80], [127.62, 80]]),
      wire([dio, 'K'], [bat, '+'], RED, [[150.16, 52], [170, 52]])
    ]
  }
}
