/**
 * A circuit simulation run without any screen: the Arduinos' programs set their pins, the
 * solver works out what lights up. LEDs that got too much current stay burnt until Stop.
 *
 * During the run things can be handled like on a real desk: potentiometer knobs and joysticks
 * turned, buttons held, switches flipped, things moved about the room (a box in front of the
 * ultrasonic sensor, a lamp next to the photoresistor, a hand waved at the motion sensor). The
 * sensors read the room; servos and motors turn; buzzers sound; the LCD shows what it is sent;
 * the programs can print to the serial monitor.
 */
import { Program } from '../robotics/interpreter'
import type { Circuit, Part, Room } from './model'
import { pinKey } from './nets'
import { IO_PINS, PWM_PINS, SPECS, pinPos } from './parts'
import { type Glow, distanceAhead, inView, ldrOhms, lightAt, roomOf, tempAt } from './room'
import { MODULE_MIN_VOLTS, type PinDrive, type SolveInputs, type SolveResult, solveCircuit } from './solver'

export const TICK = 1 / 60
/** how fast a micro servo turns: 60° in 0.1 s */
export const SERVO_SPEED = 600
/** a servo needs at least this between its 5 V and GND wires to move */
export const SERVO_MIN_VOLTS = 4
/** the serial monitor keeps this many lines */
export const SERIAL_LINES = 300
/** where a servo stands before any program has moved it */
export const SERVO_REST = 90
/** a small motor at 5 V: turns per second (shown slowed down: a real one spins ~100/s) */
export const MOTOR_TURNS = 3
/** an active buzzer's own pitch, Hz */
export const ACTIVE_BUZZ = 2300
/** the LCD: characters per line, lines */
export const LCD_COLS = 16
export const LCD_ROWS = 2
/** the ultrasonic sensor sees 2…400 cm in a cone 15° either side */
export const SONAR_MIN_CM = 2
export const SONAR_MAX_CM = 400
export const SONAR_HALF_DEG = 15
/** the IR obstacle sensor: up to 15 cm, a narrow cone */
export const IR_RANGE_MM = 150
export const IR_HALF_DEG = 10
/** the motion sensor: up to 5 m, 110° wide; it stays on this long after the last motion, s */
export const PIR_RANGE_MM = 5000
export const PIR_HALF_DEG = 55
export const PIR_HOLD = 2.5

export interface ServoState {
  angle: number
  /** has 5 V and ground */
  powered: boolean
  /** a program sends it an angle */
  driven: boolean
}

/** A part's state during the run, for the screen. */
export interface PartLive {
  /** motor: the angle of its shaft, degrees, and turns per second (signed) */
  angle?: number
  speed?: number
  /** buzzer: the pitch it sounds now, Hz (none: silent) */
  freq?: number
  /** multimeter: what it shows */
  reading?: number
  /** LCD: its two lines (none: no power or not connected) */
  lines?: string[]
  /** a module has power */
  powered?: boolean
  /** IR and motion sensors: their output is on (the IR one: an obstacle) */
  active?: boolean
  /** sensors: what they sense now (lux, °C, cm) */
  sense?: number
}

export class CircuitRun {
  time = 0
  readonly burnt = new Set<string>()
  readonly programs = new Map<string, Program>()
  /** knob positions of the potentiometers during the run (the document keeps its own) */
  readonly knobs = new Map<string, number>()
  readonly servos = new Map<string, ServoState>()
  /** buttons and joystick sticks held down */
  readonly pressed = new Set<string>()
  /** slide switches: their side during the run */
  readonly switches = new Map<string, boolean>()
  /** joysticks: the stick 0…1 on each axis */
  readonly joy = new Map<string, [number, number]>()
  /** what the screen shows of each part */
  readonly live = new Map<string, PartLive>()
  /** lines printed to the serial monitor, oldest first */
  readonly serial: string[] = []
  /** grows with every printed line (lets the screen notice new lines even when old ones drop off) */
  serialCount = 0
  /** the room during the run (things are moved about in it; the document keeps its own) */
  room: Room
  private drives = new Map<string, Map<string, PinDrive>>()
  /** per Arduino: pin → the angle its servo signal asks for */
  private servoTargets = new Map<string, Map<string, number>>()
  /** tones that stop by themselves: pin key → the run time they end */
  private toneEnds = new Map<string, number>()
  /** what each LCD shows */
  private lcdText = new Map<string, string[]>()
  /** hands: where each was, and when one last moved in front of each motion sensor */
  private handsAt = new Map<string, [number, number]>()
  private motionAt = new Map<string, number>()
  /**
   * Arduinos that use the Servo library: on the Uno it takes the timer behind pins 9 and 10, so
   * analogWrite there no longer dims (it only switches). These are the pins it happened on.
   */
  readonly timerClash = new Set<string>()
  private dirty = true
  result: SolveResult

  constructor(readonly circuit: Circuit) {
    this.room = structuredClone(roomOf(circuit))
    for (const it of this.room.items) if (it.kind === 'hand') this.handsAt.set(it.id, [it.x, it.y])
    for (const p of circuit.parts) {
      if (p.kind === 'pot') this.knobs.set(p.id, clamp01(p.knob ?? 0.5))
      if (p.kind === 'servo') this.servos.set(p.id, { angle: SERVO_REST, powered: false, driven: false })
      if (p.kind === 'switch') this.switches.set(p.id, !!p.on)
      if (p.kind === 'joystick') this.joy.set(p.id, [0.5, 0.5])
      if (p.kind === 'motor') this.live.set(p.id, { angle: 0, speed: 0 })
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
        if (old && JSON.stringify(old) === JSON.stringify(d)) return
        pins.set(pin, d)
        this.dirty = true
      }
      /** the voltage on one of this board's pins, from an up-to-date solve */
      const volts = (pin: string) => {
        if (this.dirty) this.result = this.solve()
        return this.result.voltage.get(pinKey(p.id, pin)) ?? 0
      }
      const net = (pin: string) => {
        if (this.dirty) this.result = this.solve()
        return this.result.net(pinKey(p.id, pin))
      }
      this.programs.set(
        p.id,
        new Program(p.program, {
          digitalWrite: (pin, high) => {
            targets.delete(pin)
            this.toneEnds.delete(pinKey(p.id, pin))
            set(pin, { mode: 'output', duty: high ? 1 : 0 })
          },
          analogWrite: (pin, v) => {
            targets.delete(pin)
            this.toneEnds.delete(pinKey(p.id, pin))
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
          pinMode: (pin, mode) => {
            const old = pins.get(pin)
            if (mode === 'OUTPUT') {
              // as on a real board: a pin already driven keeps its level; a pulled-up input becomes high
              if (old && old.mode !== 'input' && old.mode !== 'pullup') return
              set(pin, { mode: 'output', duty: old?.mode === 'pullup' ? 1 : 0 })
              return
            }
            targets.delete(pin)
            this.toneEnds.delete(pinKey(p.id, pin))
            set(pin, { mode: mode === 'INPUT_PULLUP' ? 'pullup' : 'input' })
          },
          tone: (pin, freq, ms) => {
            targets.delete(pin)
            const f = Math.max(31, Math.min(20_000, Math.round(freq)))
            set(pin, { mode: 'tone', duty: 0.5, freq: f })
            if (ms !== undefined && ms > 0) this.toneEnds.set(pinKey(p.id, pin), this.time + ms / 1000)
            else this.toneEnds.delete(pinKey(p.id, pin))
          },
          noTone: (pin) => {
            this.toneEnds.delete(pinKey(p.id, pin))
            const old = pins.get(pin)
            if (old?.mode === 'tone') set(pin, { mode: 'output', duty: 0 })
          },
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
          },
          // the LCD on the I2C pins (SDA = A4, SCL = A5)
          lcdPrint: (row, text, col = 0) => {
            for (const lcd of this.lcdsOf(net)) {
              const lines = this.lcdText.get(lcd.id) ?? Array(LCD_ROWS).fill(' '.repeat(LCD_COLS))
              const r = Math.max(0, Math.min(LCD_ROWS - 1, Math.round(row)))
              const c = Math.max(0, Math.min(LCD_COLS - 1, Math.round(col)))
              const line = lines[r].padEnd(LCD_COLS, ' ')
              lines[r] = (line.slice(0, c) + text + line.slice(c + text.length)).slice(0, LCD_COLS)
              this.lcdText.set(lcd.id, lines)
            }
          },
          lcdClear: () => {
            for (const lcd of this.lcdsOf(net)) this.lcdText.set(lcd.id, Array(LCD_ROWS).fill(' '.repeat(LCD_COLS)))
          },
          // the ultrasonic sensor whose Trig and Echo are on these pins: the distance, cm (0: no echo)
          ultrasonic: (trig, echo) => {
            const r = this.dirty ? (this.result = this.solve()) : this.result
            for (const s of this.circuit.parts) {
              if (s.kind !== 'hcsr04' || !this.powered(s, 'VCC', 'GND')) continue
              if (r.net(pinKey(s.id, 'TRIG')) !== net(trig) || r.net(pinKey(s.id, 'ECHO')) !== net(echo)) continue
              const d = distanceAhead(this.room, s, SONAR_MAX_CM * 10, SONAR_HALF_DEG)
              return d === null ? 0 : Math.max(SONAR_MIN_CM, Math.round(d / 10))
            }
            return 0
          }
        })
      )
    }
    this.result = this.solve()
    this.update(0)
  }

  /** LCDs with power whose SDA and SCL go to this board's A4 and A5. */
  private lcdsOf(net: (pin: string) => string): Part[] {
    const r = this.result
    return this.circuit.parts.filter(
      (l) => l.kind === 'lcd' && this.powered(l, 'VCC', 'GND') && r.net(pinKey(l.id, 'SDA')) === net('A4') && r.net(pinKey(l.id, 'SCL')) === net('A5')
    )
  }

  private powered(p: Part, vcc: string, gnd: string): boolean {
    const v = (pin: string) => this.result.voltage.get(pinKey(p.id, pin)) ?? 0
    return v(vcc) - v(gnd) >= MODULE_MIN_VOLTS
  }

  /** What the room does to the sensors now. */
  private inputs(): SolveInputs {
    const ldr = new Map<string, number>()
    const temps = new Map<string, number>()
    const outputs = new Map<string, boolean>()
    // the circuit's own LEDs light up what is next to them (as of the last solve)
    const glows: Glow[] = []
    const prev = this.result as SolveResult | undefined
    if (prev) {
      for (const p of this.circuit.parts) {
        if (p.kind !== 'led' && p.kind !== 'rgb' && p.kind !== 'seg7') continue
        let b = 0
        for (const [id, s] of prev.leds) if (id === p.id || id.startsWith(`${p.id}:`)) b = Math.max(b, s.brightness)
        if (b <= 0 || this.burnt.has(p.id)) continue
        const [x, y] = partMiddle(p)
        glows.push({ x, y, brightness: b })
      }
    }
    for (const p of this.circuit.parts) {
      const [x, y] = partMiddle(p)
      if (p.kind === 'ldr') {
        const lux = lightAt(this.room, x, y, glows)
        ldr.set(p.id, ldrOhms(lux))
        this.liveOf(p.id).sense = lux
      } else if (p.kind === 'tmp36') {
        const t = tempAt(this.room, x, y)
        temps.set(p.id, t)
        this.liveOf(p.id).sense = t
      } else if (p.kind === 'ir') {
        // its output goes low when something is close in front of it
        const d = distanceAhead(this.room, p, IR_RANGE_MM, IR_HALF_DEG)
        outputs.set(p.id, d === null)
        this.liveOf(p.id).active = d !== null
      } else if (p.kind === 'pir') {
        const on = this.time - (this.motionAt.get(p.id) ?? -Infinity) <= PIR_HOLD
        outputs.set(p.id, on)
        this.liveOf(p.id).active = on
      } else if (p.kind === 'hcsr04') {
        const d = distanceAhead(this.room, p, SONAR_MAX_CM * 10, SONAR_HALF_DEG)
        this.liveOf(p.id).sense = d === null ? undefined : Math.max(SONAR_MIN_CM, d / 10)
      }
    }
    return { knobs: this.knobs, pressed: this.pressed, switches: this.switches, joy: this.joy, ldr, temps, outputs }
  }

  private liveOf(id: string): PartLive {
    let l = this.live.get(id)
    if (!l) this.live.set(id, (l = {}))
    return l
  }

  private solve(): SolveResult {
    const inputs = this.inputs()
    let r = solveCircuit(this.circuit, this.drives, this.burnt, inputs)
    // an LED over its limit burns out at once; solve again without it
    for (let i = 0; i < 5; i++) {
      const burning = [...r.leds].filter(([id, s]) => s.burning && !this.burnt.has(id)).map(([id]) => id)
      if (!burning.length) break
      burning.forEach((id) => this.burnt.add(id))
      r = solveCircuit(this.circuit, this.drives, this.burnt, inputs)
    }
    this.dirty = false
    return r
  }

  private resolve(): void {
    this.dirty = true
    this.result = this.solve()
    this.update(0)
  }

  /** Turn a potentiometer's knob (0…1) while the circuit runs. */
  setKnob(id: string, v: number): void {
    if (!this.knobs.has(id)) return
    const k = clamp01(v)
    if (k === this.knobs.get(id)) return
    this.knobs.set(id, k)
    this.resolve()
  }

  /** Hold a button (or a joystick's stick) down, or let it go. */
  press(id: string, down: boolean): void {
    if (this.pressed.has(id) === down) return
    if (down) this.pressed.add(id)
    else this.pressed.delete(id)
    this.resolve()
  }

  /** Flip a slide switch to the other side. */
  flip(id: string): void {
    if (!this.switches.has(id)) return
    this.switches.set(id, !this.switches.get(id))
    this.resolve()
  }

  /** Move a joystick's stick (each axis 0…1). */
  setJoy(id: string, x: number, y: number): void {
    if (!this.joy.has(id)) return
    this.joy.set(id, [clamp01(x), clamp01(y)])
    this.resolve()
  }

  /** The room changed during the run (a thing moved, a lamp switched, the sliders). */
  setRoom(room: Room): void {
    // a hand that moved in front of a motion sensor sets it off
    for (const it of room.items) {
      if (it.kind !== 'hand') continue
      const was = this.handsAt.get(it.id)
      if (was && Math.hypot(was[0] - it.x, was[1] - it.y) > 2) {
        for (const p of this.circuit.parts)
          if (p.kind === 'pir' && (inView(p, it.x, it.y, PIR_RANGE_MM, PIR_HALF_DEG) || inView(p, was[0], was[1], PIR_RANGE_MM, PIR_HALF_DEG))) this.motionAt.set(p.id, this.time)
      }
      this.handsAt.set(it.id, [it.x, it.y])
    }
    this.room = structuredClone(room)
    this.resolve()
  }

  /** Servos, motors, buzzers, meters, displays: what they do after a solve. */
  private update(dt: number): void {
    const r = this.result
    const v = (part: Part, pin: string) => r.voltage.get(pinKey(part.id, pin)) ?? 0
    /** tones by net: what a buzzer on that net hears */
    const tones = new Map<string, number>()
    for (const [board, pins] of this.drives) for (const [pin, d] of pins) if (d.mode === 'tone') tones.set(r.net(pinKey(board, pin)), d.freq)
    for (const part of this.circuit.parts) {
      switch (part.kind) {
        case 'servo': {
          const st = this.servos.get(part.id)!
          st.powered = v(part, '5V') - v(part, 'GND') >= SERVO_MIN_VOLTS
          const sig = r.net(pinKey(part.id, 'SIG'))
          let target: number | undefined
          for (const [board, targets] of this.servoTargets) {
            for (const [pin, a] of targets) if (r.net(pinKey(board, pin)) === sig) target = a
          }
          st.driven = target !== undefined
          if (target === undefined || !st.powered) break
          const step = SERVO_SPEED * dt
          st.angle = Math.abs(target - st.angle) <= step ? target : st.angle + Math.sign(target - st.angle) * step
          break
        }
        case 'motor': {
          const l = this.liveOf(part.id)
          // turns as fast as the voltage across it says (the PWM average), either way
          const volts = v(part, '1') - v(part, '2')
          l.speed = Math.abs(volts) < 0.3 ? 0 : (MOTOR_TURNS * volts) / 5
          l.angle = (((l.angle ?? 0) + l.speed * 360 * dt) % 360 + 360) % 360
          break
        }
        case 'buzzer': {
          const l = this.liveOf(part.id)
          const across = v(part, '+') - v(part, '-')
          const tone = tones.get(r.net(pinKey(part.id, '+'))) ?? tones.get(r.net(pinKey(part.id, '-')))
          // a passive buzzer only makes a tone it is given; an active one beeps on its own when powered
          l.freq = part.active ? (across > 2.5 ? ACTIVE_BUZZ : undefined) : tone !== undefined && Math.abs(across) > 0.5 ? tone : undefined
          break
        }
        case 'meter': {
          const l = this.liveOf(part.id)
          l.reading = part.mode === 'A' ? (r.currents.get(part.id) ?? 0) : v(part, 'V') - v(part, 'COM')
          break
        }
        case 'lcd': {
          const l = this.liveOf(part.id)
          l.powered = this.powered(part, 'VCC', 'GND')
          if (!l.powered) this.lcdText.delete(part.id)
          l.lines = l.powered ? (this.lcdText.get(part.id) ?? Array(LCD_ROWS).fill(' '.repeat(LCD_COLS))) : undefined
          break
        }
        case 'hcsr04':
          this.liveOf(part.id).powered = this.powered(part, 'VCC', 'GND')
          break
        case 'ir':
        case 'pir': {
          const l = this.liveOf(part.id)
          l.powered = this.powered(part, 'VCC', 'GND')
          if (!l.powered) l.active = false
          break
        }
        case 'tmp36':
          this.liveOf(part.id).powered = this.powered(part, 'VS', 'GND')
          break
      }
    }
  }

  /** One program tick; the circuit is solved again when a pin changed or a sensor's reading did. */
  tick(dt = TICK): SolveResult {
    this.time += dt
    for (const p of this.programs.values()) p.tick(dt)
    // tones with a length end by themselves
    for (const [k, end] of this.toneEnds) {
      if (this.time + 1e-9 < end) continue
      this.toneEnds.delete(k)
      const [board, pin] = k.split(':')
      const pins = this.drives.get(board)
      if (pins?.get(pin)?.mode === 'tone') {
        pins.set(pin, { mode: 'output', duty: 0 })
        this.dirty = true
      }
    }
    // the motion sensor turns itself off after a while; LEDs next to photoresistors change them
    if (this.circuit.parts.some((p) => p.kind === 'pir' || p.kind === 'ldr')) this.dirty = true
    if (this.dirty) this.result = this.solve()
    this.update(dt)
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

/** The middle of a part's pins on the table (where a sensor senses from). */
export function partMiddle(p: Part): [number, number] {
  const pins = SPECS[p.kind].pins
  let x = 0
  let y = 0
  for (const q of pins) {
    const at = pinPos(p, q.id)!
    x += at[0]
    y += at[1]
  }
  return [x / pins.length, y / pins.length]
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5)
