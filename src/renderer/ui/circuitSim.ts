/** Start / stop of a circuit simulation. The document is not changed by a run. */
import { batch } from '@preact/signals'
import { CircuitRun, TICK } from '../core/circuit/runner'
import {
  circuit,
  circuitActive,
  circuitBurnt,
  circuitKnobs,
  circuitResult,
  circuitSerial,
  circuitServos,
  circuitState,
  circuitTime
} from '../core/circuit/state'
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
  if (!c.parts.some((p) => p.kind === 'arduino')) {
    notify(t('ckt.needArduino'), 'error')
    return
  }
  run = new CircuitRun(structuredClone(c))
  circuitKnobs.value = Object.fromEntries(run.knobs)
  if ([...run.programs.values()].every((p) => p.threadCount === 0)) notify(t('robo.noStartBlock'))
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
  batch(() => {
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
  if (circuitState.peek() === 'idle') return
  batch(() => {
    circuitState.value = 'idle'
    circuitResult.value = null
    circuitBurnt.value = new Set()
    circuitActive.value = {}
    circuitTime.value = 0
    circuitServos.value = {}
    circuitKnobs.value = {}
  })
}

export const toggleCircuit = () => (circuitState.peek() === 'running' ? stopCircuit() : startCircuit())
