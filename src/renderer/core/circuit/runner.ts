/**
 * A circuit simulation run without any screen: the Arduinos' programs set their pins, the
 * solver works out what lights up. LEDs that got too much current stay burnt until Stop.
 * Potentiometer knobs can be turned during the run, servos turn toward the angle their pin asks
 * for (only when they have power), and the programs can print to the serial monitor.
 */
import { Program } from '../robotics/interpreter'
import type { Circuit } from './model'
import { pinKey } from './nets'
import { IO_PINS, PWM_PINS } from './parts'
import { type PinDrive, type SolveResult, solveCircuit } from './solver'

export const TICK = 1 / 60
/** how fast a micro servo turns: 60° in 0.1 s */
export const SERVO_SPEED = 600
/** a servo needs at least this between its 5 V and GND wires to move */
export const SERVO_MIN_VOLTS = 4
/** the serial monitor keeps this many lines */
export const SERIAL_LINES = 300
/** where a servo stands before any program has moved it */
export const SERVO_REST = 90

export interface ServoState {
  angle: number
  /** has 5 V and ground */
  powered: boolean
  /** a program sends it an angle */
  driven: boolean
}

export class CircuitRun {
  time = 0
  readonly burnt = new Set<string>()
  readonly programs = new Map<string, Program>()
  /** knob positions of the potentiometers during the run (the document keeps its own) */
  readonly knobs = new Map<string, number>()
  readonly servos = new Map<string, ServoState>()
  /** lines printed to the serial monitor, oldest first */
  readonly serial: string[] = []
  /** grows with every printed line (lets the screen notice new lines even when old ones drop off) */
  serialCount = 0
  private drives = new Map<string, Map<string, PinDrive>>()
  /** per Arduino: pin → the angle its servo signal asks for */
  private servoTargets = new Map<string, Map<string, number>>()
  /**
   * Arduinos that use the Servo library: on the Uno it takes the timer behind pins 9 and 10, so
   * analogWrite there no longer dims (it only switches). These are the pins it happened on.
   */
  readonly timerClash = new Set<string>()
  private dirty = true
  result: SolveResult

  constructor(readonly circuit: Circuit) {
    for (const p of circuit.parts) {
      if (p.kind === 'pot') this.knobs.set(p.id, clamp01(p.knob ?? 0.5))
      if (p.kind === 'servo') this.servos.set(p.id, { angle: SERVO_REST, powered: false, driven: false })
    }
    for (const p of circuit.parts) {
      if (p.kind !== 'arduino') continue
      const pins = new Map<string, PinDrive>()
      const targets = new Map<string, number>()
      let servoLib = false
      this.drives.set(p.id, pins)
      this.servoTargets.set(p.id, targets)
      const set = (pin: string, d: PinDrive) => {
        if (!IO_PINS.includes(pin)) return
        const old = pins.get(pin)
        if (old && old.mode === d.mode && (old.mode === 'input' || d.mode === 'input' || old.duty === d.duty)) return
        pins.set(pin, d)
        this.dirty = true
      }
      /** the voltage on one of this board's pins, from an up-to-date solve */
      const volts = (pin: string) => {
        if (this.dirty) this.result = this.solve()
        return this.result.voltage.get(pinKey(p.id, pin)) ?? 0
      }
      this.programs.set(
        p.id,
        new Program(p.program, {
          digitalWrite: (pin, high) => {
            targets.delete(pin)
            set(pin, { mode: 'output', duty: high ? 1 : 0 })
          },
          analogWrite: (pin, v) => {
            targets.delete(pin)
            // analogWrite on a pin without PWM behaves like digitalWrite at the halfway point
            const n = Number(pin.replace('D', ''))
            const timerTaken = servoLib && (n === 9 || n === 10)
            if (timerTaken) this.timerClash.add(pinKey(p.id, pin))
            const duty = PWM_PINS.includes(n) && !timerTaken ? v / 255 : v >= 128 ? 1 : 0
            set(pin, { mode: 'output', duty })
          },
          analogRead: (pin) => {
            if (!/^A[0-5]$/.test(pin)) return 0
            // the Uno's converter measures against its own supply (5 V is 1024 steps, the top reads
            // 1023), so a slightly loaded 5 V rail still reads full scale at the rail
            const ref = volts('5V') > 0.5 ? volts('5V') : 5
            return Math.max(0, Math.min(1023, Math.floor((volts(pin) / ref) * 1024 + 1e-6)))
          },
          digitalRead: (pin) => volts(pin) > 2.5,
          servo: (pin, angle) => {
            if (!IO_PINS.includes(pin)) return
            const a = Math.max(0, Math.min(180, angle))
            targets.set(pin, a)
            servoLib = true
            // the servo signal: a 1…2 ms pulse every 20 ms
            set(pin, { mode: 'servo', duty: (1 + a / 180) / 20 })
          },
          serialPrint: (text) => {
            this.serial.push(text)
            if (this.serial.length > SERIAL_LINES) this.serial.splice(0, this.serial.length - SERIAL_LINES)
            this.serialCount++
          }
        })
      )
    }
    this.result = this.solve()
    this.updateServos(0)
  }

  private solve(): SolveResult {
    let r = solveCircuit(this.circuit, this.drives, this.burnt, this.knobs)
    // an LED over its limit burns out at once; solve again without it
    for (let i = 0; i < 5; i++) {
      const burning = [...r.leds].filter(([id, s]) => s.burning && !this.burnt.has(id)).map(([id]) => id)
      if (!burning.length) break
      burning.forEach((id) => this.burnt.add(id))
      r = solveCircuit(this.circuit, this.drives, this.burnt, this.knobs)
    }
    this.dirty = false
    return r
  }

  /** Turn a potentiometer's knob (0…1) while the circuit runs. */
  setKnob(id: string, v: number): void {
    if (!this.knobs.has(id)) return
    const k = clamp01(v)
    if (k === this.knobs.get(id)) return
    this.knobs.set(id, k)
    this.dirty = true
    this.result = this.solve()
  }

  /** Servos: find the pin that drives each one's signal wire, check its power, turn it. */
  private updateServos(dt: number): void {
    const r = this.result
    for (const part of this.circuit.parts) {
      if (part.kind !== 'servo') continue
      const st = this.servos.get(part.id)!
      const v = (pin: string) => r.voltage.get(pinKey(part.id, pin)) ?? 0
      st.powered = v('5V') - v('GND') >= SERVO_MIN_VOLTS
      const sig = r.net(pinKey(part.id, 'SIG'))
      let target: number | undefined
      for (const [board, targets] of this.servoTargets) {
        for (const [pin, a] of targets) if (r.net(pinKey(board, pin)) === sig) target = a
      }
      st.driven = target !== undefined
      if (target === undefined || !st.powered) continue
      const step = SERVO_SPEED * dt
      st.angle = Math.abs(target - st.angle) <= step ? target : st.angle + Math.sign(target - st.angle) * step
    }
  }

  /** One program tick; the circuit is solved again when a pin changed. */
  tick(dt = TICK): SolveResult {
    this.time += dt
    for (const p of this.programs.values()) p.tick(dt)
    if (this.dirty) this.result = this.solve()
    this.updateServos(dt)
    return this.result
  }

  run(seconds: number, each?: (r: SolveResult, t: number) => void): void {
    const n = Math.round(seconds / TICK)
    for (let i = 0; i < n; i++) {
      const r = this.tick()
      each?.(r, this.time)
    }
  }
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5)
