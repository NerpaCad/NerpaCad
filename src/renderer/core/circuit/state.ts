/** Circuits tab state shared by the editor and the panels (not part of the document). */
import { computed, signal } from '@preact/signals'
import { doc } from '../doc/store'
import { type Circuit, emptyCircuit } from './model'
import type { SolveResult } from './solver'
import type { PartLive, ServoState } from './runner'
import type { Room } from './model'

export const circuitsMode = signal(false)
/** the circuit seen in 3D (on a table) instead of the flat board */
export const circuit3d = signal(false)
/** selected parts and wires (ids) */
export const circuitSelection = signal<string[]>([])
export const circuitState = signal<'idle' | 'running'>('idle')
/** the latest solve while running (LED brightness, pin voltages) */
export const circuitResult = signal<SolveResult | null>(null)
export const circuitBurnt = signal<Set<string>>(new Set())
/** blocks being run, per Arduino */
export const circuitActive = signal<Record<string, string[]>>({})
export const circuitTime = signal(0)
/** servos while running: angle, power */
export const circuitServos = signal<Record<string, ServoState>>({})
/** potentiometer knobs while running (0…1) */
export const circuitKnobs = signal<Record<string, number>>({})
/** what each part shows while running (motors, buzzers, meters, the LCD, sensors) */
export const circuitLive = signal<Record<string, PartLive>>({})
/** buttons and joystick sticks held down, switches' sides, joysticks' sticks, while running */
export const circuitPressed = signal<Set<string>>(new Set())
export const circuitSwitches = signal<Record<string, boolean>>({})
export const circuitJoy = signal<Record<string, [number, number]>>({})
/** the room while running (things are moved about in it without changing the document) */
export const circuitRoom = signal<Room | null>(null)
/** the serial monitor: lines printed in this run (kept after Stop until the next run) */
export const circuitSerial = signal<string[]>([])

const EMPTY = emptyCircuit()
export const circuit = computed<Circuit>(() => doc.value.circuit ?? EMPTY)

/** The Arduino whose program is shown: the selected one, else the first. */
export const programArduino = computed(() => {
  const parts = circuit.value.parts.filter((p) => p.kind === 'arduino')
  if (!parts.length) return null
  const sel = circuitSelection.value
  return parts.find((p) => sel.includes(p.id)) ?? parts[0]
})
