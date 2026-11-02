/** Start / stop of a circuit simulation. The document is not changed by a run. */
import { batch } from '@preact/signals'
import { CircuitRun, TICK } from '../core/circuit/runner'
import {
  circuit,
  circuitActive,
  circuitBurnt,
  circuitJoy,
  circuitKnobs,
  circuitLive,
  circuitPressed,
  circuitResult,
  circuitRoom,
  circuitSerial,
  circuitServos,
  circuitState,
  circuitSwitches,
  circuitTime
} from '../core/circuit/state'
import type { Room } from '../core/circuit/model'
import { roomOf } from '../core/circuit/room'
import { buzz, silence } from './circuitSound'
import { t } from '../i18n'
import { notify } from './actions'

let run: CircuitRun | null = null
let raf = 0
let last = 0
let acc = 0
let warned = new Set<string>()
let serialSeen = -1

export function startCircuit(): void {
  if (run) return
  const c = circuit.peek()
  if (!c.parts.some((p) => p.kind === 'arduino' || p.kind === 'battery')) {
    notify(t('ckt.needArduino'), 'error')
    return
  }
  run = new CircuitRun(structuredClone(c))
  circuitKnobs.value = Object.fromEntries(run.knobs)
  circuitPressed.value = new Set()
  circuitSwitches.value = Object.fromEntries(run.switches)
  circuitJoy.value = Object.fromEntries(run.joy)
  if (run.programs.size && [...run.programs.values()].every((p) => p.threadCount === 0)) notify(t('robo.noStartBlock'))
  circuitRoom.value = structuredClone(roomOf(c))
  warned = new Set()
  serialSeen = -1
  circuitSerial.value = []
  last = performance.now()
  acc = 0
  circuitState.value = 'running'
  publish()
  raf = requestAnimationFrame(frame)
}

function frame(now: number): void {
  if (!run) return
  acc += Math.min(0.1, Math.max(0, (now - last) / 1000))
  last = now
  let n = 0
  while (acc >= TICK && n < 12) {
    run.tick(TICK)
    acc -= TICK
    n++
  }
  publish()
  raf = requestAnimationFrame(frame)
}

function publish(): void {
  if (!run) return
  const r = run.result
  const active: Record<string, string[]> = {}
  for (const [id, p] of run.programs) active[id] = p.active()
  const servos = Object.fromEntries([...run.servos].map(([id, s]) => [id, { ...s }]))
  const live = Object.fromEntries([...run.live].map(([id, l]) => [id, { ...l, ...(l.lines ? { lines: [...l.lines] } : {}) }]))
  // buzzers: what they sound now
  buzz(Object.fromEntries(Object.entries(live).filter(([, l]) => l.freq !== undefined).map(([id, l]) => [id, l.freq!])))
  batch(() => {
    if (JSON.stringify(live) !== JSON.stringify(circuitLive.peek())) circuitLive.value = live
    if (circuitResult.peek() !== r) circuitResult.value = r
    if (circuitBurnt.peek().size !== run!.burnt.size) circuitBurnt.value = new Set(run!.burnt)
    circuitActive.value = active
    circuitTime.value = run!.time
    if (JSON.stringify(servos) !== JSON.stringify(circuitServos.peek())) circuitServos.value = servos
    if (run!.serialCount !== serialSeen) {
      serialSeen = run!.serialCount
      circuitSerial.value = [...run!.serial]
    }
  })
  // tell once about what went wrong, like a teacher at the desk would
  const say = (key: string, text: string) => {
    if (warned.has(key)) return
    warned.add(key)
    notify(text, 'error')
  }
  if (run.burnt.size) say('burnt', t('ckt.ledBurnt'))
  if (r.short) say('short', t('ckt.short'))
  for (const p of r.overloaded) say(`pin:${p}`, t('ckt.overload', { pin: p.split(':')[1].replace(/^D/, '') }))
  for (const [id, s] of run.servos) if (s.driven && !s.powered) say(`servo:${id}`, t('ckt.servoNoPower'))
  for (const k of run.timerClash) say(`timer:${k}`, t('ckt.servoTimer', { pin: k.split(':')[1].replace(/^D/, '') }))
}

/** Hold a button (or a joystick's stick) down during the run, or let it go. */
export function pressPart(id: string, down: boolean): void {
  if (!run) return
  run.press(id, down)
  circuitPressed.value = new Set(run.pressed)
  publish()
}

/** Flip a slide switch during the run. */
export function flipSwitch(id: string): void {
  if (!run) return
  run.flip(id)
  circuitSwitches.value = Object.fromEntries(run.switches)
  publish()
}

/** Move a joystick's stick during the run. */
export function setRunJoy(id: string, x: number, y: number): void {
  if (!run) return
  run.setJoy(id, x, y)
  circuitJoy.value = Object.fromEntries(run.joy)
  publish()
}

/** Change the room during the run (things moved, a lamp switched, the sliders). */
export function setRunRoom(room: Room): void {
  if (!run) return
  run.setRoom(room)
  circuitRoom.value = room
  publish()
}

/** Turn a potentiometer's knob during the run (0…1). */
export function setRunKnob(id: string, v: number): void {
  if (!run) return
  run.setKnob(id, v)
  circuitKnobs.value = Object.fromEntries(run.knobs)
  publish()
}

export function stopCircuit(): void {
  cancelAnimationFrame(raf)
  run = null
  silence()
  if (circuitState.peek() === 'idle') return
  batch(() => {
    circuitState.value = 'idle'
    circuitResult.value = null
    circuitBurnt.value = new Set()
    circuitActive.value = {}
    circuitTime.value = 0
    circuitServos.value = {}
    circuitKnobs.value = {}
    circuitLive.value = {}
    circuitPressed.value = new Set()
    circuitSwitches.value = {}
    circuitJoy.value = {}
    circuitRoom.value = null
  })
}

export const toggleCircuit = () => (circuitState.peek() === 'running' ? stopCircuit() : startCircuit())
