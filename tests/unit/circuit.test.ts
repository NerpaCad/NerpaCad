import { describe, expect, it } from 'vitest'
import type { Circuit, Part, Wire } from '@/core/circuit/model'
import { type PinDrive, solveCircuit } from '@/core/circuit/solver'
import { pinPos, resistorBands, rotatePoint } from '@/core/circuit/parts'
import { blinkCircuit, blinkProgram } from '@/core/circuit/demo'
import { CircuitRun } from '@/core/circuit/runner'
import { arduinoCode } from '@/core/circuit/codegen'
import { start, workspaceJson } from '@/core/robotics/demo'
import { emptyDoc } from '@/core/doc/model'
import { FileFormatError, parseDoc, serializeDoc } from '@/core/io/formats'

const uno: Part = { id: 'u', kind: 'arduino', x: 0, y: 0, rot: 0 }
const res = (ohms = 220): Part => ({ id: 'r', kind: 'resistor', x: 0, y: 80, rot: 0, ohms })
const led: Part = { id: 'l', kind: 'led', x: 30, y: 80, rot: 0, color: 'red' }
let n = 0
const w = (a: string, ap: string, b: string, bp: string): Wire => ({ id: `w${++n}`, a: { part: a, pin: ap }, b: { part: b, pin: bp }, points: [], color: '#000' })
const drive = (pin: string, duty: number): Map<string, Map<string, PinDrive>> => new Map([['u', new Map([[pin, { mode: 'output', duty } as PinDrive]])]])

/** D13 → 220 Ω → LED → GND, the classic blink circuit */
const blink = (ohms = 220): Circuit => ({
  parts: [uno, res(ohms), led],
  wires: [w('u', 'D13', 'r', '1'), w('r', '2', 'l', 'anode'), w('l', 'cathode', 'u', 'GND.2')]
})

describe('circuit solver', () => {
  it('lights an LED through a 220 Ω resistor when the pin is HIGH', () => {
    const r = solveCircuit(blink(), drive('D13', 1))
    const l = r.leds.get('l')!
    // (5 − 1.8) / (25 + 220 + 10) ≈ 12.5 mA
    expect(l.current).toBeCloseTo(0.0125, 3)
    expect(l.brightness).toBeGreaterThan(0.5)
    expect(l.burning).toBe(false)
    expect(r.voltage.get('u:D13')!).toBeGreaterThan(4.5)
    expect(r.builtin.get('u')).toBe(1)
  })

  it('stays dark when the pin is LOW or not set, and when the LED is backwards', () => {
    expect(solveCircuit(blink(), drive('D13', 0)).leds.get('l')!.current).toBe(0)
    expect(solveCircuit(blink(), new Map()).leds.get('l')!.current).toBe(0)
    const back: Circuit = { ...blink(), wires: [w('u', 'D13', 'r', '1'), w('r', '2', 'l', 'cathode'), w('l', 'anode', 'u', 'GND.1')] }
    expect(solveCircuit(back, drive('D13', 1)).leds.get('l')!.current).toBe(0)
  })

  it('burns an LED without a resistor and warns about the pin', () => {
    const c: Circuit = { parts: [uno, led], wires: [w('u', 'D13', 'l', 'anode'), w('l', 'cathode', 'u', 'GND.3')] }
    const r = solveCircuit(c, drive('D13', 1))
    expect(r.leds.get('l')!.burning).toBe(true)
    expect(r.overloaded).toContain('u:D13')
    // a burnt LED is an open circuit
    expect(solveCircuit(c, drive('D13', 1), new Set(['l'])).leds.get('l')!.current).toBe(0)
  })

  it('reports a short from 5 V to GND', () => {
    const c: Circuit = { parts: [uno], wires: [w('u', '5V', 'u', 'GND.1')] }
    expect(solveCircuit(c, new Map()).short).toBe(true)
    expect(solveCircuit({ parts: [uno], wires: [] }, new Map()).short).toBe(false)
  })

  it('powers from the 5 V pin and dims with PWM', () => {
    const fromRail: Circuit = { parts: [uno, res(330), led], wires: [w('u', '5V', 'r', '1'), w('r', '2', 'l', 'anode'), w('l', 'cathode', 'u', 'GND.1')] }
    expect(solveCircuit(fromRail, new Map()).leds.get('l')!.current).toBeCloseTo(3.2 / 340, 3)
    const pwm: Circuit = { ...blink(), wires: [w('u', 'D9', 'r', '1'), w('r', '2', 'l', 'anode'), w('l', 'cathode', 'u', 'GND.1')] }
    const full = solveCircuit(pwm, drive('D9', 1)).leds.get('l')!.current
    const half = solveCircuit(pwm, drive('D9', 0.5)).leds.get('l')!.current
    expect(half).toBeCloseTo(full / 2, 5)
  })

  it('knows SDA is A4 inside the board', () => {
    const c: Circuit = { ...blink(), wires: [w('u', 'SDA', 'r', '1'), w('r', '2', 'l', 'anode'), w('l', 'cathode', 'u', 'GND.1')] }
    expect(solveCircuit(c, drive('A4', 1)).leds.get('l')!.current).toBeGreaterThan(0.01)
  })

  it('two LEDs in parallel share the pin', () => {
    const led2: Part = { ...led, id: 'l2', color: 'green' }
    const c: Circuit = {
      parts: [uno, res(), led, led2],
      wires: [w('u', 'D13', 'r', '1'), w('r', '2', 'l', 'anode'), w('r', '2', 'l2', 'anode'), w('l', 'cathode', 'u', 'GND.1'), w('l2', 'cathode', 'u', 'GND.1')]
    }
    const r = solveCircuit(c, drive('D13', 1))
    // the red one (lower forward voltage) takes most of the current
    expect(r.leds.get('l')!.current).toBeGreaterThan(r.leds.get('l2')!.current)
  })
})

describe('parts', () => {
  it('rotates pins with the part', () => {
    expect(rotatePoint(10, 0, 90)).toEqual([-0, 10])
    const r: Part = { id: 'r', kind: 'resistor', x: 5, y: 5, rot: 90 }
    const p = pinPos(r, '2')!
    expect(p[0]).toBeCloseTo(5)
    expect(p[1]).toBeCloseTo(15.16)
  })

  it('colour bands: 220 Ω is red red brown', () => {
    const b = resistorBands(220)
    expect(b.slice(0, 3)).toEqual(['#d8352a', '#d8352a', '#7b4a21'])
    expect(resistorBands(10000).slice(0, 3)).toEqual(['#7b4a21', '#1b1b1b', '#ef7d1a'])
  })
})

describe('blink: program + circuit, headless', () => {
  it('the LED is on for a second, off for a second', () => {
    const c = blinkCircuit()
    const run = new CircuitRun(c)
    const led = c.parts.find((p) => p.kind === 'led')!.id
    const at: Record<string, number> = {}
    run.run(3.5, (r, t) => {
      for (const s of [0.5, 1.5, 2.5, 3.4]) if (Math.abs(t - s) < 0.009) at[s] = r.leds.get(led)!.brightness
    })
    expect(at[0.5]).toBeGreaterThan(0.5)
    expect(at[1.5]).toBe(0)
    expect(at[2.5]).toBeGreaterThan(0.5)
    expect(at[3.4]).toBe(0)
    expect(run.burnt.size).toBe(0)
  })

  it('without the resistor the LED burns and stays burnt', () => {
    const c = blinkCircuit()
    const uno = c.parts.find((p) => p.kind === 'arduino')!.id
    const led = c.parts.find((p) => p.kind === 'led')!.id
    c.parts = c.parts.filter((p) => p.kind !== 'resistor')
    c.wires = [c.wires[2], { id: 'x', a: { part: uno, pin: 'D13' }, b: { part: led, pin: 'anode' }, points: [], color: '#000000' }]
    const run = new CircuitRun(c)
    run.run(0.2)
    expect(run.burnt.has(led)).toBe(true)
    run.run(2.2)
    expect(run.result.leds.get(led)!.brightness).toBe(0)
  })
})

describe('Arduino code from blocks', () => {
  it('blink becomes setup() with pinMode and loop() with delays', () => {
    const code = arduinoCode(blinkProgram())
    expect(code).toContain('pinMode(13, OUTPUT);')
    expect(code).toMatch(/void loop\(\)\n\{\n {2}digitalWrite\(13, HIGH\);\n {2}delay\(1000\);/)
    expect(code).toContain('digitalWrite(13, LOW);')
  })

  it('translates conditions, loops, PWM and the timer', () => {
    const prog = workspaceJson([
      start([
        { type: 'ard_analog_write', fields: { PIN: 'D9' }, inputs: { VALUE: { shadow: { type: 'robo_number', fields: { NUM: 128 } } } } },
        {
          type: 'robo_repeat',
          inputs: { TIMES: { shadow: { type: 'robo_number', fields: { NUM: 3 } } }, DO: { block: { type: 'ard_builtin_led', fields: { STATE: 'ON' } } } }
        },
        {
          type: 'robo_if',
          inputs: {
            COND: { block: { type: 'robo_compare', fields: { OP: 'GT' }, inputs: { A: { block: { type: 'robo_timer' } }, B: { shadow: { type: 'robo_number', fields: { NUM: 2 } } } } } },
            DO: { block: { type: 'ard_digital_write', fields: { PIN: 'A0', STATE: 'LOW' } } }
          }
        }
      ])
    ])
    const code = arduinoCode(prog)
    expect(code).toContain('analogWrite(9, 128);')
    expect(code).toContain('for (int i = 0; i < 3; i++) {')
    expect(code).toContain('digitalWrite(LED_BUILTIN, HIGH);')
    expect(code).toContain('if ((((millis() - startTime) / 1000.0) > 2)) {')
    expect(code).toContain('pinMode(A0, OUTPUT);')
  })
})

describe('.tcad version 4', () => {
  it('round-trips a circuit and rejects a broken one', () => {
    const d = { ...emptyDoc(), circuit: blinkCircuit() }
    const back = parseDoc(serializeDoc(d))
    expect(back.version).toBe(5)
    expect(back.circuit).toEqual(JSON.parse(JSON.stringify(d.circuit)))
    const bad = { ...emptyDoc(), circuit: blinkCircuit() }
    bad.circuit.wires[0].b.pin = 'nope'
    expect(() => parseDoc(serializeDoc(bad))).toThrow(FileFormatError)
  })
})
