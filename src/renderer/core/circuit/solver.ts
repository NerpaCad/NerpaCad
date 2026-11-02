/**
 * DC circuit solver: finds the voltage of every net and the current through every part.
 *
 * Nodal analysis: every source has a small internal resistance (an Arduino pin ~25 Ω, a battery
 * ~1 Ω), so each source is a conductance plus an injected current and the whole circuit is one
 * linear system. Diodes and LEDs are piecewise linear (off = open, on = a forward voltage plus a
 * small resistance), and so is the transistor (off, active: collector current β times the base
 * current, saturated: a small voltage drop); their states are found by repeating the solve until
 * none changes.
 *
 * Ground is the Arduino's GND; a circuit without an Arduino is measured from a battery's minus.
 */
import type { Circuit, LedColor, Part } from './model'
import { IO_PINS, SPECS } from './parts'
import { circuitNets } from './nets'

/**
 * What the program has set a pin to: not driven (input, perhaps with the pull-up on), an output
 * at a duty 0…1, a servo signal, or a tone (a square wave: half the time high).
 */
export type PinDrive =
  | { mode: 'input' }
  | { mode: 'pullup' }
  | { mode: 'output'; duty: number }
  | { mode: 'servo'; duty: number }
  | { mode: 'tone'; duty: number; freq: number }

export const LED_VF: Record<LedColor, number> = { red: 1.8, yellow: 1.9, green: 2.0, blue: 2.8, white: 2.8 }
/** the RGB LED's three chips */
export const RGB_VF = { R: 1.9, G: 2.8, B: 2.8 }
const LED_RS = 10
/** current for full brightness, and the current an LED does not survive */
export const LED_FULL = 0.02
export const LED_BURN = 0.05
/** an Arduino pin should not give more than this */
export const PIN_MAX = 0.04
const PIN_R = 25
/** the Uno's pull-up resistor */
const PULLUP_R = 35_000
const SHORT = 0.5
/** a micro servo's electronics as a load between its 5 V and GND (~100 mA at 5 V) */
export const SERVO_LOAD = 50
/** a potentiometer's end can't go below this, ohms (a real track has some resistance) */
const POT_MIN = 1
/** a small DC motor's winding, ohms (~200 mA at 3 V when stalled) */
export const MOTOR_R = 15
/** a buzzer as a load, ohms (an active one with its own oscillator draws more) */
const BUZZER_R = 1000
const BUZZER_ACTIVE_R = 200
/** what the modules draw from their supply, as resistors, ohms */
const LCD_LOAD = 250
const SONAR_LOAD = 330
const IR_LOAD = 250
const PIR_LOAD = 5000
const TMP_LOAD = 100_000
/** the LCD board's pull-ups on SDA and SCL */
const I2C_PULLUP = 4700
/** a module's output: its resistance */
const OUT_R = 100
/** a closed switch, an ammeter, a voltmeter, ohms */
const CLOSED_R = 0.05
const AMMETER_R = 0.1
const VOLTMETER_R = 10e6
/** batteries: 9 V "Krona" ~1.5 Ω inside, two AA cells ~0.3 Ω */
const BATTERY_R: Record<number, number> = { 9: 1.5, 3: 0.3 }
/** a battery gives more than this only when shorted */
const BATTERY_SHORT = 2
/** diode 1N4007 and the transistor */
const DIODE_VF = 0.7
const DIODE_RS = 0.5
const VBE = 0.7
const RBE = 50
const BETA = 100
const VCE_SAT = 0.2
const R_SAT = 1
/** a module needs at least this between its supply pins to work */
export const MODULE_MIN_VOLTS = 2.7
const G_OFF = 1e-9
const G_MIN = 1e-12

export interface LedState {
  current: number
  /** 0…1 */
  brightness: number
  /** over the limit in this solve (the caller keeps it burnt) */
  burning: boolean
}

/** What the run feeds in: knobs, buttons, the room's effect on the sensors. */
export interface SolveInputs {
  /** potentiometer knobs 0…1 */
  knobs?: Map<string, number>
  /** buttons held down, and joysticks with their stick pressed */
  pressed?: Set<string>
  /** switches: which side (missing: the part's own) */
  switches?: Map<string, boolean>
  /** photoresistors: their resistance now, ohms */
  ldr?: Map<string, number>
  /** temperature sensors: °C */
  temps?: Map<string, number>
  /** joysticks: the stick 0…1 on each axis (0.5: in the middle) */
  joy?: Map<string, [number, number]>
  /** IR and motion sensors: their output pin high? */
  outputs?: Map<string, boolean>
}

export interface SolveResult {
  /** voltage of every pin, key `part:pin` */
  voltage: Map<string, number>
  /** every light: an LED by its id, a chip of an RGB LED or a segment as `id:pin` */
  leds: Map<string, LedState>
  /** current through a part, A (motors, buzzers, multimeters in A mode, batteries, diodes) */
  currents: Map<string, number>
  /** Arduino pins giving too much current (key `part:pin`) */
  overloaded: string[]
  /** 5 V or 3.3 V shorted to ground (or a pin fighting another, or a battery shorted) */
  short: boolean
  /** the built-in "L" LED of each Arduino (pin 13), 0…1 */
  builtin: Map<string, number>
  /** the net a pin belongs to: two pins with the same net are connected */
  net(key: string): string
}

const key = (part: string, pin: string) => `${part}:${pin}`

interface Source {
  node: string
  v: number
  g: number
  /** which pin (for overload reports) */
  pin: string
  rail: boolean
}

/** A light or a diode: piecewise linear between two pins. */
interface Junction {
  id: string
  part: string
  an: string
  ca: string
  vf: number
  rs: number
  light: boolean
}

/** A two-pin element whose current is reported (key: the part id). */
interface Branch {
  id: string
  a: string
  b: string
  g: number
}

/**
 * Solve the circuit. `drives` holds, per Arduino, the pin drives set by its program; `burnt`
 * LEDs are open circuits. `inputs` may be a Map of potentiometer knobs (older callers).
 */
export function solveCircuit(
  c: Circuit,
  drives: Map<string, Map<string, PinDrive>>,
  burnt: Set<string> = new Set(),
  inputs: SolveInputs | Map<string, number> = {}
): SolveResult {
  const inp: SolveInputs = inputs instanceof Map ? { knobs: inputs } : inputs
  const knobs = inp.knobs ?? new Map<string, number>()
  // wires, breadboard strips, legs in holes, the board's joined pins
  const nets = circuitNets(c)
  const arduinos = c.parts.filter((p) => p.kind === 'arduino')
  const batteries = c.parts.filter((p) => p.kind === 'battery')
  const pin = (p: Part, id: string) => nets.find(key(p.id, id))

  // ground: every Arduino's GND; without one, the first battery's minus
  const ground = new Set(arduinos.length ? arduinos.map((a) => pin(a, 'GND.1')) : batteries.slice(0, 1).map((b) => pin(b, '-')))
  const allPins: string[] = []
  for (const p of c.parts) for (const q of SPECS[p.kind].pins) allPins.push(key(p.id, q.id))
  const nodes: string[] = []
  const index = new Map<string, number>()
  for (const k of allPins) {
    const n = nets.find(k)
    if (ground.has(n) || index.has(n)) continue
    index.set(n, nodes.length)
    nodes.push(n)
  }

  // ---------------------------------------------------------------- the parts as elements
  const resistors: { a: string; b: string; g: number }[] = []
  const branches: Branch[] = []
  const junctions: Junction[] = []
  const transistors: { id: string; b: string; c: string; e: string }[] = []
  /** Norton sources between two nets (batteries, sensor outputs): `v` volts from b up to a */
  const cells: { id: string; a: string; b: string; v: number; g: number; battery: boolean }[] = []
  /** modules that only work with power: checked like the junctions */
  const modules: { id: string; vcc: string; gnd: string; out?: string; outV: (vcc: number) => number }[] = []

  const R = (a: string, b: string, ohms: number) => resistors.push({ a, b, g: 1 / Math.max(1e-3, ohms) })
  for (const p of c.parts) {
    const at = (id: string) => pin(p, id)
    switch (p.kind) {
      case 'resistor':
        R(at('1'), at('2'), Math.max(0.1, p.ohms ?? 220))
        break
      case 'pot': {
        // two resistors meeting at the wiper
        const total = Math.max(2 * POT_MIN, p.ohms ?? 10_000)
        const k = clamp01(knobs.get(p.id) ?? p.knob ?? 0.5)
        R(at('1'), at('W'), Math.max(POT_MIN, total * k))
        R(at('W'), at('2'), Math.max(POT_MIN, total * (1 - k)))
        break
      }
      case 'servo':
        R(at('5V'), at('GND'), SERVO_LOAD)
        break
      case 'led':
        junctions.push({ id: p.id, part: p.id, an: at('anode'), ca: at('cathode'), vf: LED_VF[p.color ?? 'red'], rs: LED_RS, light: true })
        break
      case 'rgb':
        for (const ch of ['R', 'G', 'B'] as const)
          junctions.push({ id: key(p.id, ch), part: p.id, an: at(ch), ca: at('-'), vf: RGB_VF[ch], rs: LED_RS, light: true })
        break
      case 'seg7':
        for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'])
          junctions.push({ id: key(p.id, s), part: p.id, an: at(s), ca: at('COM.1'), vf: LED_VF.red, rs: LED_RS, light: true })
        break
      case 'diode':
        junctions.push({ id: p.id, part: p.id, an: at('A'), ca: at('K'), vf: DIODE_VF, rs: DIODE_RS, light: false })
        break
      case 'button':
        if (inp.pressed?.has(p.id)) branches.push({ id: p.id, a: at('1a'), b: at('2a'), g: 1 / CLOSED_R })
        break
      case 'switch': {
        const right = inp.switches?.get(p.id) ?? !!p.on
        branches.push({ id: p.id, a: at('C'), b: at(right ? '2' : '1'), g: 1 / CLOSED_R })
        break
      }
      case 'buzzer':
        branches.push({ id: p.id, a: at('+'), b: at('-'), g: 1 / (p.active ? BUZZER_ACTIVE_R : BUZZER_R) })
        break
      case 'motor':
        branches.push({ id: p.id, a: at('1'), b: at('2'), g: 1 / MOTOR_R })
        break
      case 'ldr':
        branches.push({ id: p.id, a: at('1'), b: at('2'), g: 1 / (inp.ldr?.get(p.id) ?? 1000) })
        break
      case 'meter':
        branches.push({ id: p.id, a: at('V'), b: at('COM'), g: 1 / (p.mode === 'A' ? AMMETER_R : VOLTMETER_R) })
        break
      case 'battery': {
        const v = p.volts === 3 ? 3 : 9
        cells.push({ id: p.id, a: at('+'), b: at('-'), v, g: 1 / BATTERY_R[v], battery: true })
        break
      }
      case 'npn':
        transistors.push({ id: p.id, b: at('B'), c: at('C'), e: at('E') })
        break
      case 'lcd':
        R(at('VCC'), at('GND'), LCD_LOAD)
        R(at('SDA'), at('VCC'), I2C_PULLUP)
        R(at('SCL'), at('VCC'), I2C_PULLUP)
        break
      case 'joystick': {
        const [jx, jy] = inp.joy?.get(p.id) ?? [0.5, 0.5]
        for (const [w, k] of [
          ['VRx', jx],
          ['VRy', jy]
        ] as [string, number][]) {
          // each axis: a 10 kΩ potentiometer from GND to +5V
          R(at('GND'), at(w), Math.max(POT_MIN, 10_000 * clamp01(k)))
          R(at(w), at('5V'), Math.max(POT_MIN, 10_000 * (1 - clamp01(k))))
        }
        if (inp.pressed?.has(p.id)) branches.push({ id: p.id, a: at('SW'), b: at('GND'), g: 1 / CLOSED_R })
        break
      }
      case 'tmp36': {
        R(at('VS'), at('GND'), TMP_LOAD)
        const t = inp.temps?.get(p.id) ?? 22
        modules.push({ id: p.id, vcc: at('VS'), gnd: at('GND'), out: at('OUT'), outV: (vcc) => Math.max(0, Math.min(vcc - 0.1, 0.5 + 0.01 * t)) })
        break
      }
      case 'hcsr04':
        R(at('VCC'), at('GND'), SONAR_LOAD)
        // its echo pin stays low between measurements (the "distance" block does the pulse)
        modules.push({ id: p.id, vcc: at('VCC'), gnd: at('GND'), out: at('ECHO'), outV: () => 0 })
        break
      case 'ir': {
        R(at('VCC'), at('GND'), IR_LOAD)
        const high = inp.outputs?.get(p.id) ?? true
        modules.push({ id: p.id, vcc: at('VCC'), gnd: at('GND'), out: at('OUT'), outV: (vcc) => (high ? vcc : 0) })
        break
      }
      case 'pir': {
        R(at('VCC'), at('GND'), PIR_LOAD)
        const high = inp.outputs?.get(p.id) ?? false
        modules.push({ id: p.id, vcc: at('VCC'), gnd: at('GND'), out: at('OUT'), outV: () => (high ? 3.3 : 0) })
        break
      }
    }
  }

  // ---------------------------------------------------------------- sources
  // power pins always, IO pins when driven. PWM pins (and tones) are solved at both levels.
  const pwmPins: { a: string; pin: string; duty: number }[] = []
  /** the sources with each PWM pin at a level: high, low, or (null) its average */
  const sourcesAt = (high: Map<string, boolean> | null): Source[] => {
    const out: Source[] = []
    for (const a of arduinos) {
      const at = (id: string) => pin(a, id)
      out.push({ node: at('5V'), v: 5, g: 1 / 0.05, pin: key(a.id, '5V'), rail: true })
      out.push({ node: at('IOREF'), v: 5, g: 1, pin: key(a.id, 'IOREF'), rail: true })
      out.push({ node: at('3.3V'), v: 3.3, g: 1 / 0.2, pin: key(a.id, '3.3V'), rail: true })
      out.push({ node: at('RESET'), v: 5, g: 1 / 10000, pin: key(a.id, 'RESET'), rail: true })
      const d = drives.get(a.id)
      for (const io of IO_PINS) {
        const dr = d?.get(io)
        if (!dr || dr.mode === 'input') continue
        if (dr.mode === 'pullup') {
          out.push({ node: at(io), v: 5, g: 1 / PULLUP_R, pin: key(a.id, io), rail: false })
          continue
        }
        // a servo signal is short pulses: only its average voltage matters to the rest of the circuit
        const pk = key(a.id, io)
        const level = dr.mode === 'servo' || !high ? dr.duty : dr.duty >= 1 ? 1 : dr.duty <= 0 ? 0 : high.get(pk) ? 1 : 0
        out.push({ node: at(io), v: 5 * level, g: 1 / PIN_R, pin: pk, rail: false })
      }
    }
    return out
  }
  for (const a of arduinos) {
    const d = drives.get(a.id)
    for (const io of IO_PINS) {
      const dr = d?.get(io)
      if (dr && (dr.mode === 'output' || dr.mode === 'tone') && dr.duty > 0 && dr.duty < 1) pwmPins.push({ a: a.id, pin: io, duty: dr.duty })
    }
  }

  // ---------------------------------------------------------------- one solve at one PWM level
  const solveOnce = (sources: Source[]) => {
    const on = new Map<string, boolean>()
    const tstate = new Map<string, 'off' | 'active' | 'sat'>()
    const powered = new Map<string, boolean>()
    let v: Float64Array = new Float64Array(nodes.length)
    const volt = (n: string) => (ground.has(n) ? 0 : v[index.get(n)!])
    for (let iter = 0; iter < 60; iter++) {
      v = solveLinear(
        nodes.length,
        (stamp) => {
          for (const r of resistors) stamp.g(r.a, r.b, r.g)
          for (const b of branches) stamp.g(b.a, b.b, b.g)
          for (const j of junctions) {
            if (!burnt.has(j.id) && on.get(j.id)) {
              const g = 1 / j.rs
              stamp.g(j.an, j.ca, g)
              stamp.i(j.an, j.ca, j.vf * g)
            } else stamp.g(j.an, j.ca, G_OFF)
          }
          for (const t of transistors) {
            const st = tstate.get(t.id) ?? 'off'
            if (st === 'off') {
              stamp.g(t.b, t.e, G_OFF)
              stamp.g(t.c, t.e, G_OFF)
              continue
            }
            // the base–emitter junction conducts
            stamp.g(t.b, t.e, 1 / RBE)
            stamp.i(t.b, t.e, VBE / RBE)
            if (st === 'active') stamp.vccs(t.c, t.e, t.b, t.e, BETA / RBE, VBE)
            else {
              stamp.g(t.c, t.e, 1 / R_SAT)
              stamp.i(t.c, t.e, VCE_SAT / R_SAT)
            }
          }
          for (const cl of cells) {
            stamp.g(cl.a, cl.b, cl.g)
            stamp.i(cl.a, cl.b, cl.v * cl.g)
          }
          for (const m of modules) {
            if (!m.out) continue
            if (!powered.get(m.id)) {
              stamp.g(m.out, m.gnd, G_OFF)
              continue
            }
            // its output: a voltage above its GND pin behind a small resistance
            const vout = m.outV(Math.max(0, volt(m.vcc) - volt(m.gnd)))
            stamp.g(m.out, m.gnd, 1 / OUT_R)
            stamp.i(m.out, m.gnd, vout / OUT_R)
          }
          for (const s of sources) stamp.src(s.node, s.v, s.g)
        },
        index,
        ground
      )
      let changed = false
      for (const j of junctions) {
        if (burnt.has(j.id)) continue
        const vd = volt(j.an) - volt(j.ca)
        const now = on.get(j.id) ?? false
        const next = now ? (vd - j.vf) / j.rs > -1e-9 : vd > j.vf + 1e-9
        if (next !== now) {
          on.set(j.id, next)
          changed = true
        }
      }
      for (const t of transistors) {
        const st = tstate.get(t.id) ?? 'off'
        const vbe = volt(t.b) - volt(t.e)
        const vce = volt(t.c) - volt(t.e)
        const ib = (vbe - VBE) / RBE
        let next = st
        if (st === 'off') next = vbe > VBE + 1e-9 ? 'active' : 'off'
        else if (ib < -1e-12) next = 'off'
        else if (st === 'active' && vce < VCE_SAT - 1e-9) next = 'sat'
        else if (st === 'sat' && (vce - VCE_SAT) / R_SAT > BETA * ib + 1e-9) next = 'active'
        if (next !== st) {
          tstate.set(t.id, next)
          changed = true
        }
      }
      for (const m of modules) {
        const want = volt(m.vcc) - volt(m.gnd) >= MODULE_MIN_VOLTS
        if (want !== (powered.get(m.id) ?? false)) {
          powered.set(m.id, want)
          changed = true
        }
      }
      if (!changed) break
    }
    const lit = new Map<string, number>()
    for (const j of junctions) {
      const vd = volt(j.an) - volt(j.ca)
      lit.set(j.id, !burnt.has(j.id) && on.get(j.id) ? Math.max(0, (vd - j.vf) / j.rs) : 0)
    }
    const flow = new Map<string, number>()
    for (const b of branches) flow.set(b.id, (volt(b.a) - volt(b.b)) * b.g)
    for (const cl of cells) flow.set(cl.id, (cl.v - (volt(cl.a) - volt(cl.b))) * cl.g)
    const srcI = sources.map((s) => ({ s, i: (s.v - volt(s.node)) * s.g }))
    return { volt, lit, flow, srcI }
  }

  // PWM: each pin is high part of the time. With a few PWM pins every high/low combination is
  // solved and weighted by how long it lasts (LEDs are not linear, so averaging voltages would be
  // wrong); with many, each pin is taken at its average voltage.
  const runs: { r: ReturnType<typeof solveOnce>; w: number }[] = []
  if (pwmPins.length > MAX_PWM_COMBOS) runs.push({ r: solveOnce(sourcesAt(null)), w: 1 })
  else
    for (let m = 0; m < 1 << pwmPins.length; m++) {
      const high = new Map<string, boolean>()
      let w = 1
      pwmPins.forEach((p, i) => {
        const up = !!(m & (1 << i))
        high.set(key(p.a, p.pin), up)
        w *= up ? p.duty : 1 - p.duty
      })
      runs.push({ r: solveOnce(sourcesAt(high)), w })
    }
  const mean = (f: (r: ReturnType<typeof solveOnce>) => number) => runs.reduce((acc, { r, w }) => acc + w * f(r), 0)

  const voltage = new Map<string, number>()
  for (const k of allPins) {
    const n = nets.find(k)
    voltage.set(k, mean((r) => r.volt(n)))
  }
  const leds = new Map<string, LedState>()
  const currents = new Map<string, number>()
  for (const j of junctions) {
    const avg = mean((r) => r.lit.get(j.id)!)
    const peak = Math.max(...runs.map(({ r }) => r.lit.get(j.id)!))
    if (j.light) leds.set(j.id, { current: avg, brightness: Math.min(1, avg / LED_FULL), burning: peak > LED_BURN })
    else currents.set(j.id, avg)
  }
  for (const id of runs[0].r.flow.keys()) currents.set(id, mean((r) => r.flow.get(id) ?? 0))
  const overloaded = new Set<string>()
  let short = false
  for (const { r } of runs) {
    for (const { s, i } of r.srcI) {
      if (s.rail ? Math.abs(i) > SHORT : Math.abs(i) > PIN_MAX) {
        if (s.rail) short = true
        else overloaded.add(s.pin)
      }
    }
    for (const cl of cells) if (cl.battery && Math.abs(r.flow.get(cl.id) ?? 0) > BATTERY_SHORT) short = true
  }
  const builtin = new Map<string, number>()
  for (const a of arduinos) {
    const d = drives.get(a.id)?.get('D13')
    builtin.set(a.id, d && (d.mode === 'output' || d.mode === 'servo' || d.mode === 'tone') ? d.duty : 0)
  }
  return { voltage, leds, currents, overloaded: [...overloaded], short, builtin, net: (k) => nets.find(k) }
}

/** up to this many PWM pins every high/low combination is solved */
const MAX_PWM_COMBOS = 3

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5)

interface Stamp {
  /** conductance between two nets */
  g(a: string, b: string, g: number): void
  /** current `i` pushed from b into a (through the element) */
  i(a: string, b: string, i: number): void
  /** a source of `v` volts (against ground) behind conductance `g` on net `n` */
  src(n: string, v: number, g: number): void
  /** a current from a to b of gm·(V(c) − V(d) − off) (a transistor's collector current) */
  vccs(a: string, b: string, c: string, d: string, gm: number, off: number): void
}

function solveLinear(n: number, build: (s: Stamp) => void, index: Map<string, number>, ground: Set<string>): Float64Array {
  const A = Array.from({ length: n }, () => new Float64Array(n))
  const b = new Float64Array(n)
  const at = (net: string) => (ground.has(net) ? -1 : (index.get(net) ?? -1))
  build({
    g(x, y, g) {
      const i = at(x)
      const j = at(y)
      if (i >= 0) A[i][i] += g
      if (j >= 0) A[j][j] += g
      if (i >= 0 && j >= 0) {
        A[i][j] -= g
        A[j][i] -= g
      }
    },
    i(x, y, cur) {
      const i = at(x)
      const j = at(y)
      if (i >= 0) b[i] += cur
      if (j >= 0) b[j] -= cur
    },
    src(net, v, g) {
      const i = at(net)
      if (i < 0) return
      A[i][i] += g
      b[i] += v * g
    },
    vccs(x, y, cp, cm, gm, off) {
      // the current leaves x and enters y
      const i = at(x)
      const j = at(y)
      const p = at(cp)
      const m = at(cm)
      if (i >= 0) {
        if (p >= 0) A[i][p] += gm
        if (m >= 0) A[i][m] -= gm
        b[i] += gm * off
      }
      if (j >= 0) {
        if (p >= 0) A[j][p] -= gm
        if (m >= 0) A[j][m] += gm
        b[j] -= gm * off
      }
    }
  })
  for (let i = 0; i < n; i++) A[i][i] += G_MIN
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (p !== c) {
      ;[A[p], A[c]] = [A[c], A[p]]
      ;[b[p], b[c]] = [b[c], b[p]]
    }
    const d = A[c][c]
    if (Math.abs(d) < 1e-30) continue
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / d
      if (f === 0) continue
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]
      b[r] -= f * b[c]
    }
  }
  const x = new Float64Array(n)
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]
    x[r] = Math.abs(A[r][r]) < 1e-30 ? 0 : s / A[r][r]
  }
  return x
}

export type { Part }
