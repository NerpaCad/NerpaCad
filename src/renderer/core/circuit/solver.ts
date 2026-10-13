/**
 * DC circuit solver: finds the voltage of every net and the current through every LED.
 *
 * Nodal analysis: every source has a small internal resistance (an Arduino pin ~25 Ω), so each
 * source is a conductance plus an injected current and the whole circuit is one linear system.
 * LEDs are piecewise linear (off = open, on = a forward voltage plus a small resistance); their
 * states are found by repeating the solve until no LED changes.
 */
import type { Circuit, LedColor, Part } from './model'
import { IO_PINS, SPECS } from './parts'
import { circuitNets } from './nets'

/** What the program has set a pin to: not driven (input), or an output at a duty 0…1. */
export type PinDrive = { mode: 'input' } | { mode: 'output'; duty: number } | { mode: 'servo'; duty: number }

export const LED_VF: Record<LedColor, number> = { red: 1.8, yellow: 1.9, green: 2.0, blue: 2.8, white: 2.8 }
const LED_RS = 10
/** current for full brightness, and the current an LED does not survive */
export const LED_FULL = 0.02
export const LED_BURN = 0.05
/** an Arduino pin should not give more than this */
export const PIN_MAX = 0.04
const PIN_R = 25
const SHORT = 0.5
/** a micro servo's electronics as a load between its 5 V and GND (~100 mA at 5 V) */
export const SERVO_LOAD = 50
/** a potentiometer's end can't go below this, ohms (a real track has some resistance) */
const POT_MIN = 1
const G_OFF = 1e-9
const G_MIN = 1e-12

export interface LedState {
  current: number
  /** 0…1 */
  brightness: number
  /** over the limit in this solve (the caller keeps it burnt) */
  burning: boolean
}

export interface SolveResult {
  /** voltage of every pin, key `part:pin` */
  voltage: Map<string, number>
  leds: Map<string, LedState>
  /** Arduino pins giving too much current (key `part:pin`) */
  overloaded: string[]
  /** 5 V or 3.3 V shorted to ground (or a pin fighting another) */
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

/**
 * Solve the circuit. `drives` holds, per Arduino, the pin drives set by its program;
 * `burnt` LEDs are open circuits.
 */
export function solveCircuit(
  c: Circuit,
  drives: Map<string, Map<string, PinDrive>>,
  burnt: Set<string> = new Set(),
  knobs: Map<string, number> = new Map()
): SolveResult {
  // wires, breadboard strips, legs in holes, the board's joined pins
  const nets = circuitNets(c)
  const arduinos = c.parts.filter((p) => p.kind === 'arduino')

  // ground: every Arduino's GND is the reference
  const ground = new Set(arduinos.map((a) => nets.find(key(a.id, 'GND.1'))))
  const allPins: string[] = []
  for (const p of c.parts) for (const pin of SPECS[p.kind].pins) allPins.push(key(p.id, pin.id))
  const nodes: string[] = []
  const index = new Map<string, number>()
  for (const k of allPins) {
    const n = nets.find(k)
    if (ground.has(n) || index.has(n)) continue
    index.set(n, nodes.length)
    nodes.push(n)
  }

  // sources: power pins always, IO pins when driven. PWM pins are solved at both levels.
  const pwmPins: { a: string; pin: string; duty: number }[] = []
  const sourcesAt = (pwmHigh: boolean): Source[] => {
    const out: Source[] = []
    for (const a of arduinos) {
      const at = (pin: string) => nets.find(key(a.id, pin))
      out.push({ node: at('5V'), v: 5, g: 1 / 0.05, pin: key(a.id, '5V'), rail: true })
      out.push({ node: at('IOREF'), v: 5, g: 1, pin: key(a.id, 'IOREF'), rail: true })
      out.push({ node: at('3.3V'), v: 3.3, g: 1 / 0.2, pin: key(a.id, '3.3V'), rail: true })
      out.push({ node: at('RESET'), v: 5, g: 1 / 10000, pin: key(a.id, 'RESET'), rail: true })
      const d = drives.get(a.id)
      for (const pin of IO_PINS) {
        const dr = d?.get(pin)
        if (!dr || dr.mode === 'input') continue
        // a servo signal is short pulses: only its average voltage matters to the rest of the circuit
        const level = dr.mode === 'servo' ? dr.duty : dr.duty >= 1 ? 1 : dr.duty <= 0 ? 0 : pwmHigh ? 1 : 0
        out.push({ node: at(pin), v: 5 * level, g: 1 / PIN_R, pin: key(a.id, pin), rail: false })
      }
    }
    return out
  }
  for (const a of arduinos) {
    const d = drives.get(a.id)
    for (const pin of IO_PINS) {
      const dr = d?.get(pin)
      if (dr && dr.mode === 'output' && dr.duty > 0 && dr.duty < 1) pwmPins.push({ a: a.id, pin, duty: dr.duty })
    }
  }

  const leds = c.parts.filter((p) => p.kind === 'led')
  const resistors = c.parts.filter((p) => p.kind === 'resistor')
  const pots = c.parts.filter((p) => p.kind === 'pot')
  const servos = c.parts.filter((p) => p.kind === 'servo')

  const solveOnce = (sources: Source[]) => {
    const on = new Map<string, boolean>()
    let v: Float64Array = new Float64Array(nodes.length)
    for (let iter = 0; iter < 40; iter++) {
      v = solveLinear(nodes.length, (stamp) => {
        for (const r of resistors) stamp.g(nets.find(key(r.id, '1')), nets.find(key(r.id, '2')), 1 / Math.max(0.1, r.ohms ?? 220))
        // a potentiometer: two resistors meeting at the wiper
        for (const p of pots) {
          const R = Math.max(2 * POT_MIN, p.ohms ?? 10_000)
          const k = Math.max(0, Math.min(1, knobs.get(p.id) ?? p.knob ?? 0.5))
          stamp.g(nets.find(key(p.id, '1')), nets.find(key(p.id, 'W')), 1 / Math.max(POT_MIN, R * k))
          stamp.g(nets.find(key(p.id, 'W')), nets.find(key(p.id, '2')), 1 / Math.max(POT_MIN, R * (1 - k)))
        }
        for (const s of servos) stamp.g(nets.find(key(s.id, '5V')), nets.find(key(s.id, 'GND')), 1 / SERVO_LOAD)
        for (const l of leds) {
          const an = nets.find(key(l.id, 'anode'))
          const ca = nets.find(key(l.id, 'cathode'))
          if (!burnt.has(l.id) && on.get(l.id)) {
            const g = 1 / LED_RS
            stamp.g(an, ca, g)
            stamp.i(an, ca, LED_VF[l.color ?? 'red'] * g)
          } else stamp.g(an, ca, G_OFF)
        }
        for (const s of sources) stamp.src(s.node, s.v, s.g)
      }, index, ground)
      const volt = (n: string) => (ground.has(n) ? 0 : v[index.get(n)!])
      let changed = false
      for (const l of leds) {
        if (burnt.has(l.id)) continue
        const vd = volt(nets.find(key(l.id, 'anode'))) - volt(nets.find(key(l.id, 'cathode')))
        const vf = LED_VF[l.color ?? 'red']
        const now = on.get(l.id) ?? false
        const next = now ? (vd - vf) / LED_RS > -1e-9 : vd > vf + 1e-9
        if (next !== now) {
          on.set(l.id, next)
          changed = true
        }
      }
      if (!changed) break
    }
    const volt = (n: string) => (ground.has(n) ? 0 : v[index.get(n)!])
    const ledI = new Map<string, number>()
    for (const l of leds) {
      const vd = volt(nets.find(key(l.id, 'anode'))) - volt(nets.find(key(l.id, 'cathode')))
      ledI.set(l.id, !burnt.has(l.id) && on.get(l.id) ? Math.max(0, (vd - LED_VF[l.color ?? 'red']) / LED_RS) : 0)
    }
    const srcI = sources.map((s) => ({ s, i: (s.v - volt(s.node)) * s.g }))
    return { volt, ledI, srcI }
  }

  const hi = solveOnce(sourcesAt(true))
  const lo = pwmPins.length ? solveOnce(sourcesAt(false)) : hi
  // PWM: the average of the two levels, weighted by the (largest) duty
  const duty = pwmPins.length ? Math.max(...pwmPins.map((p) => p.duty)) : 1

  const voltage = new Map<string, number>()
  for (const k of allPins) voltage.set(k, lo === hi ? hi.volt(nets.find(k)) : lo.volt(nets.find(k)) + (hi.volt(nets.find(k)) - lo.volt(nets.find(k))) * duty)
  const ledOut = new Map<string, LedState>()
  for (const l of leds) {
    const ih = hi.ledI.get(l.id)!
    const il = lo.ledI.get(l.id)!
    const avg = il + (ih - il) * duty
    ledOut.set(l.id, { current: avg, brightness: Math.min(1, avg / LED_FULL), burning: Math.max(ih, il) > LED_BURN })
  }
  const overloaded = new Set<string>()
  let short = false
  for (const r of [hi, lo]) {
    for (const { s, i } of r.srcI) {
      if (s.rail ? Math.abs(i) > SHORT : Math.abs(i) > PIN_MAX) {
        if (s.rail) short = true
        else overloaded.add(s.pin)
      }
    }
  }
  const builtin = new Map<string, number>()
  for (const a of arduinos) {
    const d = drives.get(a.id)?.get('D13')
    builtin.set(a.id, d && d.mode !== 'input' ? d.duty : 0)
  }
  return { voltage, leds: ledOut, overloaded: [...overloaded], short, builtin, net: (k) => nets.find(k) }
}

interface Stamp {
  /** conductance between two nets */
  g(a: string, b: string, g: number): void
  /** current `i` pushed from b into a (through the element) */
  i(a: string, b: string, i: number): void
  /** a source of `v` volts (against ground) behind conductance `g` on net `n` */
  src(n: string, v: number, g: number): void
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
