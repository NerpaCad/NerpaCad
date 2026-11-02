/**
 * Runs a block program saved by Blockly (its JSON form) step by step. No code is generated and
 * nothing is evaluated: the block tree is walked directly.
 *
 * Every "when start is clicked" block starts its own thread; "when a key is pressed" and "when
 * clicked" start theirs when that happens (unless the same one is still running). Threads run in turn once per tick
 * and give way at every "wait", at the end of every loop pass and after a fixed number of steps,
 * so a loop without a wait can never freeze the app. Time only moves between ticks, which keeps a
 * run exactly repeatable.
 */

import { DEFAULT_TEMPO, NOTE_RANGE, TEMPO_RANGE, soundSpec } from './sounds'

/** "distance to" when there is nothing of that kind on the field, cm */
export const NOTHING_CM = 10000

/** A block in Blockly's JSON save format (only the parts the interpreter reads). */
export interface BlockJson {
  type: string
  id?: string
  fields?: Record<string, unknown>
  inputs?: Record<string, { block?: BlockJson; shadow?: BlockJson } | undefined>
  next?: { block?: BlockJson }
}

/** A move that takes time: true once it is over. */
export type Done = () => boolean

/** What the seal blocks ask for (distances in mm, angles in radians). */
export type TargetKind = 'ROBOT' | 'NERPA' | 'CHEETAH' | 'PIGEON' | 'SHAPE' | 'LIGHT'
export interface NerpaIO {
  walk(mm: number): Done
  turn(rad: number): Done
  turnTo(rad: number): Done
  face(target: TargetKind): Done
  goTo(x: number, y: number): void
  glide(x: number, y: number, seconds: number): Done
  jump(): Done
  say(text: string, seconds?: number): Done
  setColor(color: string): void
  setVisible(on: boolean): void
  setSize(percent: number): void
  x(): number
  y(): number
  /** radians */
  heading(): number
  touching(target: TargetKind): boolean
  /** mm to the nearest thing of that kind (Infinity when there is none) */
  distance(target: TargetKind): number
  /** the cheetah: run, jump forward onto a ledge */
  run(mm: number): Done
  leap(): Done
  /** the cheetah: crawl crouched (under a low bridge) */
  crawl(mm: number): Done
  /** a ledge (something higher than a step) / water right in front */
  ledgeAhead(): boolean
  waterAhead(): boolean
  /** stop walking, gliding or turning (its script started again) */
  stop?(): void
  /** the seal: is it in water */
  inWater(): boolean
  /** the pigeon: take off to `mm` above the ground, fly forward, fly to a point, land, its height (mm) */
  takeOff(mm: number): Done
  fly(mm: number): Done
  flyTo(x: number, y: number): Done
  land(): Done
  altitude(): number
  /** what it stands on / what is right in front, as a surface name ('grass', 'water', 'air'…) */
  under(): string
  aheadKind(): string
  /** a surface's name in the user's language */
  surfaceWord(kind: string): string
}

/** What a lamp's blocks do. */
export interface LampIO {
  setOn(on: boolean): void
  setBrightness(percent: number): void
  setColor(color: string): void
}

/** What the sound blocks do (heroes only). `volume` 0…1. */
export interface SoundIO {
  play(id: string, volume: number): void
  /** a note (MIDI number) for `seconds` of the run's time */
  note(midi: number, seconds: number, volume: number): void
  /** stop every sound on the field */
  stopAll(): void
}

/** What a program can do with its device: a robot's motors and sensors, an Arduino's pins… */
export interface RobotIO {
  /** motor power −100…100 % */
  setMotors?(left: number, right: number): void
  /**
   * The device on a port: line and light sensors 0…100, ultrasonic distance in cm, touch 0/1,
   * a flashlight its brightness; NaN when nothing is plugged in
   */
  sensor?(port: number): number
  /** flashlight on a port: switch it (`on`), or set its brightness 0…100 % */
  flashlight?(port: number, on: boolean | null, brightness?: number): void
  nerpa?: NerpaIO
  lamp?: LampIO
  sound?: SoundIO
  /**
   * Send a message to every program on the field (this one too). The check returned is true
   * once every script it started is over (for "broadcast and wait").
   */
  broadcast?(name: string): Done
  /** Arduino: set a pin (`D13`, `A0`…) HIGH or LOW */
  digitalWrite?(pin: string, high: boolean): void
  /** Arduino: PWM on a pin, 0…255 */
  analogWrite?(pin: string, value: number): void
  /** Arduino: the voltage on an analog pin (`A0`…) as 0…1023 */
  analogRead?(pin: string): number
  /** Arduino: is a pin HIGH (above half the supply)? */
  digitalRead?(pin: string): boolean
  /** Arduino: a servo on a pin to an angle 0…180° */
  servo?(pin: string, angle: number): void
  /** Arduino: a line to the serial monitor */
  serialPrint?(text: string): void
  /** Arduino: a pin as an input (perhaps with its pull-up) or an output */
  pinMode?(pin: string, mode: 'INPUT' | 'INPUT_PULLUP' | 'OUTPUT'): void
  /** Arduino: a square wave of `freq` Hz on a pin (for `ms` milliseconds, or until noTone) */
  tone?(pin: string, freq: number, ms?: number): void
  noTone?(pin: string): void
  /** Arduino: text on the I2C character display, at a row (0 or 1) from a column */
  lcdPrint?(row: number, text: string, col?: number): void
  lcdClear?(): void
  /** Arduino: the ultrasonic sensor on these pins: the distance, cm (0: no echo) */
  ultrasonic?(trig: string, echo: string): number
}

/** statements a thread may run in one tick before it has to give way */
export const STEP_BUDGET = 5000

/** Top-level blocks of a saved workspace. */
export function topBlocks(program: unknown): BlockJson[] {
  const p = program as { blocks?: { blocks?: unknown } } | null
  const list = p?.blocks?.blocks
  return Array.isArray(list) ? (list.filter((b) => b && typeof b === 'object' && typeof b.type === 'string') as BlockJson[]) : []
}

interface Thread {
  gen: Generator<void, void, void>
  /** the statement block being run (for highlighting) */
  current: string | null
  done: boolean
  /** the creature's move it waits for (a walk, a glide…): stopped if the thread is */
  moving?: Done | null
}

/** Event blocks: what starts a thread. */
export const HATS = ['robo_start', 'robo_when_key', 'robo_when_clicked', 'msg_when']

/** A message's name as blocks hold it (names match exactly, without spaces around). */
export const msgName = (v: unknown): string => String(v ?? '').trim()

/** Keys a "when key pressed" block can wait for (Space is the run's start/pause key). */
export const EVENT_KEYS = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')
]

type Value = number | boolean | string

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const round1 = (v: number) => Math.round(v * 10) / 10
const TARGETS: TargetKind[] = ['ROBOT', 'NERPA', 'CHEETAH', 'PIGEON', 'SHAPE', 'LIGHT']
const target = (v: unknown): TargetKind => (TARGETS.includes(v as TargetKind) ? (v as TargetKind) : 'ROBOT')
/** A variable block's variable: saved as `{ id }` (or a bare id in hand-written programs). */
function varId(b: BlockJson): string | null {
  const v = b.fields?.VAR as { id?: unknown } | string | undefined
  if (typeof v === 'string') return v
  return typeof v?.id === 'string' ? v.id : null
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export class Program {
  time = 0
  /** block types the interpreter does not know (they are skipped) */
  readonly unknown = new Set<string>()
  private threads: Thread[] = []
  private steps = 0
  /** event blocks and the thread each one runs now */
  private hats: { block: BlockJson; thread: Thread | null }[] = []
  /** variables by id (Blockly keeps names and ids in the workspace) */
  readonly vars = new Map<string, Value>()
  /** the sound blocks' volume, 0…100 %, and the notes' tempo (beats per minute) */
  volume = 100
  tempo = DEFAULT_TEMPO

  constructor(
    program: unknown,
    private io: RobotIO
  ) {
    const p = program as { variables?: { id?: unknown }[] } | null
    for (const v of Array.isArray(p?.variables) ? p!.variables! : []) if (typeof v?.id === 'string') this.vars.set(v.id, 0)
    for (const b of topBlocks(program)) {
      if (!HATS.includes(b.type)) continue
      const hat = { block: b, thread: null as Thread | null }
      this.hats.push(hat)
      if (b.type === 'robo_start') this.startHat(hat)
    }
  }

  /** the thread running right now (inside `tick`) */
  private running: Thread | null = null

  /** Stop a thread (one running right now stops at its next pause). */
  private kill(th: Thread): void {
    // a script started again stops the walk or glide it was making (as in Scratch)
    if (th.moving && !th.moving()) this.io.nerpa?.stop?.()
    th.moving = null
    th.done = true
    th.current = null
    if (th !== this.running) th.gen.return()
  }

  private startHat(hat: { block: BlockJson; thread: Thread | null }, restart = false): Thread | null {
    if (hat.thread && !hat.thread.done) {
      if (!restart) return null
      this.kill(hat.thread)
    }
    const th: Thread = { gen: null as unknown as Generator<void, void, void>, current: null, done: false }
    th.gen = this.runChain(hat.block.next?.block, th)
    hat.thread = th
    this.threads.push(th)
    return th
  }

  /**
   * A message came: every "when I receive" block for it starts its script — from the top again
   * if it is still running (as in Scratch). Returns a check that is true once they are all over
   * (a script started again by the same message meanwhile is waited for to its new end).
   */
  receive(name: string): Done {
    const started: Thread[] = []
    const hats: { thread: Thread | null }[] = []
    for (const h of this.hats) {
      if (h.block.type !== 'msg_when' || msgName(h.block.fields?.MSG) !== name) continue
      const th = this.startHat(h, true)
      if (!th) continue
      started.push(th)
      hats.push(h)
    }
    if (!started.length) return () => true
    this.threads = this.threads.filter((t) => !t.done || started.includes(t))
    return () => hats.every((h) => !h.thread || h.thread.done)
  }

  /**
   * Something happened: a key was pressed (`key` as in `EVENT_KEYS`) or the object was clicked.
   * Returns true when some event block of the program waits for it.
   */
  fire(event: 'key' | 'click', key?: string): boolean {
    let any = false
    for (const h of this.hats) {
      if (event === 'click' && h.block.type === 'robo_when_clicked') {
        any = true
        this.startHat(h)
      }
      if (event === 'key' && h.block.type === 'robo_when_key') {
        const want = String(h.block.fields?.KEY ?? '')
        if (want === 'ANY' || want === key) {
          any = true
          this.startHat(h)
        }
      }
    }
    this.threads = this.threads.filter((t) => !t.done)
    return any
  }

  /** Threads started by "when start is clicked" (the ones that run from the start). */
  get threadCount(): number {
    return this.hats.filter((h) => h.block.type === 'robo_start').length
  }

  /** Has the program any event block at all? */
  get hatCount(): number {
    return this.hats.length
  }

  get finished(): boolean {
    return this.threads.every((t) => t.done)
  }

  /** Ids of the blocks being run right now. */
  active(): string[] {
    const out: string[] = []
    for (const t of this.threads) if (!t.done && t.current) out.push(t.current)
    return out
  }

  /** Advance time by `dt` seconds and let every thread run until it gives way. */
  tick(dt: number): void {
    this.time += dt
    // a list of its own: a message sent now may start threads (they run from the next tick)
    for (const th of [...this.threads]) {
      if (th.done) continue
      this.steps = 0
      this.running = th
      const r = th.gen.next()
      this.running = null
      if (th.done) {
        // stopped while it ran (its script was started again by a message)
        th.gen.return()
        continue
      }
      if (r.done) {
        th.done = true
        th.current = null
      }
    }
    this.threads = this.threads.filter((t) => !t.done)
  }

  // ------------------------------------------------------------ statements

  private *runChain(first: BlockJson | undefined, th: Thread): Generator<void, void, void> {
    for (let b = first; b; b = b.next?.block) {
      th.current = b.id ?? null
      if (++this.steps > STEP_BUDGET) {
        yield
        this.steps = 0
      }
      yield* this.run(b, th)
      // its script was started again (a message it sent to itself): stop here
      if (th.done) return
    }
  }

  /** Wait until a move is over. */
  private *until(done: Done | undefined): Generator<void, void, void> {
    if (!done) return
    while (!done()) yield
  }

  /** Wait for the creature's walk, glide or turn (stopped if this thread is). */
  private *move(th: Thread, done: Done | undefined): Generator<void, void, void> {
    th.moving = done ?? null
    yield* this.until(done)
    th.moving = null
  }

  private *waitFor(seconds: number): Generator<void, void, void> {
    const end = this.time + Math.max(0, seconds)
    // a small tolerance so 1 s at 60 ticks/s is exactly 60 ticks
    while (this.time < end - 1e-6) yield
  }

  private *run(b: BlockJson, th: Thread): Generator<void, void, void> {
    const io = this.io
    switch (b.type) {
      case 'robo_motors':
        io.setMotors?.(this.value(b, 'LEFT'), this.value(b, 'RIGHT'))
        return
      case 'robo_forward': {
        const p = this.value(b, 'POWER')
        io.setMotors?.(p, p)
        return
      }
      case 'robo_backward': {
        const p = this.value(b, 'POWER')
        io.setMotors?.(-p, -p)
        return
      }
      case 'robo_turn': {
        const p = this.value(b, 'POWER')
        if (b.fields?.DIR === 'RIGHT') io.setMotors?.(p, -p)
        else io.setMotors?.(-p, p)
        return
      }
      case 'robo_motors_for': {
        io.setMotors?.(this.value(b, 'LEFT'), this.value(b, 'RIGHT'))
        yield* this.waitFor(this.value(b, 'SECONDS'))
        io.setMotors?.(0, 0)
        return
      }
      case 'robo_stop':
        io.setMotors?.(0, 0)
        return
      case 'robo_flashlight':
        io.flashlight?.(num(b.fields?.PORT), b.fields?.STATE !== 'OFF')
        return
      case 'robo_flashlight_brightness':
        io.flashlight?.(num(b.fields?.PORT), null, clamp(this.value(b, 'VALUE'), 0, 100))
        return
      // the seal
      case 'nerpa_walk':
        yield* this.move(th, io.nerpa?.walk(this.value(b, 'CM') * 10))
        return
      case 'nerpa_turn': {
        const deg = this.value(b, 'DEG') * (b.fields?.DIR === 'RIGHT' ? -1 : 1)
        yield* this.move(th, io.nerpa?.turn((deg * Math.PI) / 180))
        return
      }
      case 'nerpa_heading':
        yield* this.move(th, io.nerpa?.turnTo((this.value(b, 'DEG') * Math.PI) / 180))
        return
      case 'nerpa_face':
        yield* this.move(th, io.nerpa?.face(target(b.fields?.TARGET)))
        return
      case 'nerpa_goto':
        io.nerpa?.goTo(this.value(b, 'X') * 10, this.value(b, 'Y') * 10)
        return
      case 'nerpa_glide':
        yield* this.move(th, io.nerpa?.glide(this.value(b, 'X') * 10, this.value(b, 'Y') * 10, this.value(b, 'SECONDS')))
        return
      case 'nerpa_jump':
        yield* this.until(io.nerpa?.jump())
        return
      case 'cheetah_run':
        yield* this.move(th, io.nerpa?.run(this.value(b, 'CM') * 10))
        return
      case 'cheetah_crawl':
        yield* this.move(th, io.nerpa?.crawl(this.value(b, 'CM') * 10))
        return
      case 'cheetah_leap':
        yield* this.until(io.nerpa?.leap())
        return
      case 'pigeon_takeoff':
        yield* this.until(io.nerpa?.takeOff(this.value(b, 'CM') * 10))
        return
      case 'pigeon_fly':
        yield* this.move(th, io.nerpa?.fly(this.value(b, 'CM') * 10))
        return
      case 'pigeon_fly_to':
        yield* this.move(th, io.nerpa?.flyTo(this.value(b, 'X') * 10, this.value(b, 'Y') * 10))
        return
      case 'pigeon_land':
        yield* this.until(io.nerpa?.land())
        return
      case 'nerpa_say':
        io.nerpa?.say(this.text(b, 'TEXT'))
        return
      case 'nerpa_say_for':
        yield* this.until(io.nerpa?.say(this.text(b, 'TEXT'), Math.max(0, this.value(b, 'SECONDS'))))
        return
      case 'nerpa_color':
        io.nerpa?.setColor(String(b.fields?.COLOR ?? '#8f9aa6'))
        return
      case 'nerpa_show':
        io.nerpa?.setVisible(true)
        return
      case 'nerpa_hide':
        io.nerpa?.setVisible(false)
        return
      case 'nerpa_size':
        io.nerpa?.setSize(clamp(this.value(b, 'PERCENT'), 10, 300))
        return
      // messages
      case 'msg_send':
        io.broadcast?.(msgName(b.fields?.MSG))
        return
      case 'msg_send_wait': {
        const done = io.broadcast?.(msgName(b.fields?.MSG))
        // the scripts it started run from the next tick: look at them from then on
        yield
        yield* this.until(done)
        return
      }
      // sounds
      case 'sound_play':
        io.sound?.play(String(b.fields?.SOUND ?? ''), this.volume / 100)
        return
      case 'sound_play_wait': {
        const id = String(b.fields?.SOUND ?? '')
        io.sound?.play(id, this.volume / 100)
        yield* this.waitFor(soundSpec(id)?.dur ?? 0)
        return
      }
      case 'sound_note': {
        const secs = this.beats(b)
        const midi = clamp(this.value(b, 'NOTE'), NOTE_RANGE[0], NOTE_RANGE[1])
        if (secs > 0) io.sound?.note(midi, secs, this.volume / 100)
        yield* this.waitFor(secs)
        return
      }
      case 'sound_rest':
        yield* this.waitFor(this.beats(b))
        return
      case 'sound_tempo':
        this.tempo = clamp(this.value(b, 'BPM'), TEMPO_RANGE[0], TEMPO_RANGE[1])
        return
      case 'sound_volume':
        this.volume = clamp(this.value(b, 'PERCENT'), 0, 100)
        return
      case 'sound_change_volume':
        this.volume = clamp(this.volume + this.value(b, 'DELTA'), 0, 100)
        return
      case 'sound_stop':
        io.sound?.stopAll()
        return
      // lamps
      case 'light_on':
        io.lamp?.setOn(true)
        return
      case 'light_off':
        io.lamp?.setOn(false)
        return
      case 'light_brightness':
        io.lamp?.setBrightness(clamp(this.value(b, 'VALUE'), 0, 100))
        return
      case 'light_color':
        io.lamp?.setColor(String(b.fields?.COLOR ?? '#ffffff'))
        return
      // variables
      case 'variables_set': {
        const id = varId(b)
        if (id) this.vars.set(id, this.any(b, 'VALUE'))
        return
      }
      case 'math_change': {
        const id = varId(b)
        if (id) this.vars.set(id, num(this.vars.get(id)) + this.value(b, 'DELTA'))
        return
      }
      case 'ard_digital_write':
        io.digitalWrite?.(String(b.fields?.PIN ?? 'D13'), b.fields?.STATE !== 'LOW')
        return
      case 'ard_servo':
        io.servo?.(String(b.fields?.PIN ?? 'D9'), clamp(this.value(b, 'ANGLE'), 0, 180))
        return
      case 'ard_serial_println': {
        // as Serial.println does: a condition prints 1 or 0
        const v = this.any(b, 'TEXT')
        io.serialPrint?.(typeof v === 'boolean' ? (v ? '1' : '0') : this.text(b, 'TEXT'))
        return
      }
      case 'ard_builtin_led':
        io.digitalWrite?.('D13', b.fields?.STATE !== 'OFF')
        return
      case 'ard_pin_mode': {
        const m = String(b.fields?.MODE ?? 'INPUT')
        io.pinMode?.(String(b.fields?.PIN ?? 'D2'), m === 'OUTPUT' ? 'OUTPUT' : m === 'INPUT_PULLUP' ? 'INPUT_PULLUP' : 'INPUT')
        return
      }
      case 'ard_tone':
        io.tone?.(String(b.fields?.PIN ?? 'D8'), clamp(this.value(b, 'FREQ'), 31, 20000))
        return
      case 'ard_tone_for': {
        const ms = clamp(this.value(b, 'MS'), 0, 600000)
        io.tone?.(String(b.fields?.PIN ?? 'D8'), clamp(this.value(b, 'FREQ'), 31, 20000), ms)
        return
      }
      case 'ard_no_tone':
        io.noTone?.(String(b.fields?.PIN ?? 'D8'))
        return
      case 'ard_lcd_print': {
        // as lcd.print does: a condition prints 1 or 0
        const v = this.any(b, 'TEXT')
        io.lcdPrint?.(num(b.fields?.ROW), typeof v === 'boolean' ? (v ? '1' : '0') : this.text(b, 'TEXT'), clamp(Math.round(this.value(b, 'COL')), 0, 15))
        return
      }
      case 'ard_lcd_clear':
        io.lcdClear?.()
        return
      case 'ard_analog_write':
        io.analogWrite?.(String(b.fields?.PIN ?? 'D9'), Math.max(0, Math.min(255, Math.round(this.value(b, 'VALUE')))))
        return
      case 'robo_wait':
        yield* this.waitFor(this.value(b, 'SECONDS'))
        return
      case 'robo_wait_until':
        while (!this.bool(b, 'COND')) yield
        return
      case 'robo_forever':
        for (;;) {
          yield* this.runChain(this.child(b, 'DO'), th)
          th.current = b.id ?? null
          yield
        }
      case 'robo_repeat': {
        const n = Math.min(1e9, Math.max(0, Math.round(this.value(b, 'TIMES'))))
        for (let i = 0; i < n; i++) {
          yield* this.runChain(this.child(b, 'DO'), th)
          th.current = b.id ?? null
          yield
        }
        return
      }
      case 'robo_repeat_until':
        while (!this.bool(b, 'COND')) {
          yield* this.runChain(this.child(b, 'DO'), th)
          th.current = b.id ?? null
          yield
        }
        return
      case 'robo_if':
        if (this.bool(b, 'COND')) yield* this.runChain(this.child(b, 'DO'), th)
        return
      case 'robo_if_else':
        yield* this.runChain(this.child(b, this.bool(b, 'COND') ? 'DO' : 'ELSE'), th)
        return
      default:
        this.unknown.add(b.type)
    }
  }

  // ------------------------------------------------------------ values

  private child(b: BlockJson, name: string): BlockJson | undefined {
    const inp = b.inputs?.[name]
    return inp?.block ?? inp?.shadow
  }

  private value(b: BlockJson, name: string): number {
    const c = this.child(b, name)
    const v = c ? this.evalNum(c) : 0
    // overflowing maths (±Infinity) or NaN would break moves and timers: count it as 0
    return Number.isFinite(v) ? v : 0
  }

  /** seconds of a block's BEATS at the current tempo */
  private beats(b: BlockJson): number {
    return (clamp(this.value(b, 'BEATS'), 0, 100) * 60) / this.tempo
  }

  private bool(b: BlockJson, name: string): boolean {
    const c = this.child(b, name)
    return c ? this.evalBool(c) : false
  }

  /** A value of any type (for variables and what the seal says). */
  private any(b: BlockJson, name: string): Value {
    const c = this.child(b, name)
    return c ? this.evaluate(c) : 0
  }

  /** A value as text: numbers without float noise, yes/no for conditions. */
  private text(b: BlockJson, name: string): string {
    const v = this.any(b, name)
    if (typeof v === 'number') return String(Math.round(v * 1000) / 1000)
    if (typeof v === 'boolean') return v ? '✔' : '✘'
    return v
  }

  private evalNum(b: BlockJson): number {
    const v = this.evaluate(b)
    return typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'string' ? num(v) : v
  }

  private evalBool(b: BlockJson): boolean {
    const v = this.evaluate(b)
    return typeof v === 'boolean' ? v : typeof v === 'string' ? v !== '' : v !== 0
  }

  private evaluate(b: BlockJson): Value {
    const f = b.fields ?? {}
    switch (b.type) {
      case 'robo_number':
      case 'math_number':
        return num(f.NUM)
      case 'robo_text':
        return String(f.TEXT ?? '')
      case 'variables_get': {
        const id = varId(b)
        return id ? (this.vars.get(id) ?? 0) : 0
      }
      case 'ard_analog_read': {
        const v = this.io.analogRead?.(String(f.PIN ?? 'A0')) ?? 0
        return Number.isFinite(v) ? v : 0
      }
      case 'ard_digital_read':
        return this.io.digitalRead?.(String(f.PIN ?? 'D2')) ?? false
      case 'ard_ultrasonic': {
        const v = this.io.ultrasonic?.(String(f.TRIG ?? 'D9'), String(f.ECHO ?? 'D10')) ?? 0
        return Number.isFinite(v) ? v : 0
      }
      case 'robo_distance':
      case 'robo_light': {
        const v = this.io.sensor?.(num(f.PORT)) ?? NaN
        return Number.isFinite(v) ? v : 0
      }
      case 'robo_touch': {
        const v = this.io.sensor?.(num(f.PORT)) ?? NaN
        return Number.isFinite(v) && v >= 1
      }
      case 'nerpa_x':
        return round1((this.io.nerpa?.x() ?? 0) / 10)
      case 'nerpa_y':
        return round1((this.io.nerpa?.y() ?? 0) / 10)
      case 'nerpa_dir': {
        const deg = ((this.io.nerpa?.heading() ?? 0) * 180) / Math.PI
        return round1((((deg + 180) % 360) + 360) % 360 - 180)
      }
      case 'nerpa_touching':
        return this.io.nerpa?.touching(target(f.TARGET)) ?? false
      case 'creature_ledge':
        return this.io.nerpa?.ledgeAhead() ?? false
      case 'creature_water':
        return this.io.nerpa?.waterAhead() ?? false
      case 'nerpa_in_water':
        return this.io.nerpa?.inWater() ?? false
      case 'creature_under': {
        const k = this.io.nerpa?.under()
        return k ? this.io.nerpa!.surfaceWord(k) : ''
      }
      case 'creature_on':
        return !!this.io.nerpa && this.io.nerpa.under() === String(f.SURF ?? '')
      case 'creature_ahead_is':
        return !!this.io.nerpa && this.io.nerpa.aheadKind() === String(f.SURF ?? '')
      case 'pigeon_altitude':
        return round1((this.io.nerpa?.altitude() ?? 0) / 10)
      case 'nerpa_distance': {
        const d = this.io.nerpa?.distance(target(f.TARGET)) ?? Infinity
        // nothing of that kind on the field: very far away (as in Scratch)
        return Number.isFinite(d) ? round1(d / 10) : NOTHING_CM
      }
      case 'robo_line_sensor': {
        const v = this.io.sensor?.(num(f.PORT)) ?? NaN
        return Number.isFinite(v) ? v : 0
      }
      case 'robo_line_black': {
        const v = this.io.sensor?.(num(f.PORT)) ?? NaN
        return Number.isFinite(v) && v < 50
      }
      case 'sound_note_pick':
        return num(f.NOTE)
      case 'sound_volume_get':
        return round1(this.volume)
      case 'robo_timer':
        return Math.round(this.time * 1000) / 1000
      case 'robo_compare': {
        const a = this.value(b, 'A')
        const c = this.value(b, 'B')
        switch (f.OP) {
          case 'LT':
            return a < c
          case 'GT':
            return a > c
          case 'LE':
            return a <= c
          case 'GE':
            return a >= c
          case 'NE':
            return a !== c
          default:
            return a === c
        }
      }
      case 'robo_arith': {
        const a = this.value(b, 'A')
        const c = this.value(b, 'B')
        switch (f.OP) {
          case 'SUB':
            return a - c
          case 'MUL':
            return a * c
          case 'DIV':
            return c === 0 ? 0 : a / c
          default:
            return a + c
        }
      }
      case 'robo_logic': {
        const a = this.bool(b, 'A')
        // "and" does not look at the right side when the left is false (and "or" when it is true)
        if (f.OP === 'OR') return a || this.bool(b, 'B')
        return a && this.bool(b, 'B')
      }
      case 'robo_not':
        return !this.bool(b, 'A')
      default:
        this.unknown.add(b.type)
        return 0
    }
  }
}
