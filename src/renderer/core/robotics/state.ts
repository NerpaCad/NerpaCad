/** Robotics mode state shared by the view and the panels (not part of the document). */
import { computed, effect, signal } from '@preact/signals'
import { type ActorKind, type PrimNode, type SensorType, actorKind } from '../doc/model'
import { doc, selection } from '../doc/store'

/** The third tab: the floor with tiles, robots and the simulator. */
export const roboticsMode = signal(false)

export type SimState = 'idle' | 'running' | 'paused'
export const simState = signal<SimState>('idle')
/** simulation speed factor (1 = real time) */
export const simSpeed = signal(1)
/** seconds of simulated time since Start */
export const simTime = signal(0)
/** latest sensor values: robot id → port → 0…100 */
export const sensorValues = signal<Record<string, Record<number, number>>>({})
/** blocks being run right now, per robot (for highlighting) */
export const activeBlocks = signal<Record<string, string[]>>({})

/** Editing the document is off while a run is on screen. */
export const simActive = computed(() => simState.value !== 'idle')

export const robotNodes = computed(() =>
  doc.value.nodes.filter((n): n is PrimNode => n.kind === 'prim' && n.prim === 'robot')
)

/**
 * The robot whose program is shown: the selected robot, else the one picked last, else the
 * first robot on the field.
 */
const lastRobot = signal<string | null>(null)
export const programRobot = computed<PrimNode | null>(() => {
  const robots = robotNodes.value
  if (robots.length === 0) return null
  const sel = selection.value
  const picked = robots.find((r) => sel.includes(r.id))
  if (picked) return picked
  return robots.find((r) => r.id === lastRobot.value) ?? robots[0]
})
export function rememberRobot(id: string): void {
  lastRobot.value = id
}

/** Which device a click on an empty pad (or on the robot's pad map) puts there. */
export const sensorKind = signal<SensorType>('line')

/**
 * Whose program the block editor shows: the selected robot, seal or lamp; with nothing of that
 * kind selected, the robot shown last (or the first one).
 */
const lastActor = signal<string | null>(null)
export const programActor = computed<{ node: PrimNode; kind: ActorKind } | null>(() => {
  const nodes = doc.value.nodes
  const sel = selection.value
  const pick = (id: string | null) => {
    const n = id ? nodes.find((x) => x.id === id) : undefined
    const k = n ? actorKind(n) : null
    return n && k ? { node: n as PrimNode, kind: k } : null
  }
  for (const id of sel) {
    const a = pick(id)
    if (a) return a
  }
  const last = pick(lastActor.value)
  if (last) return last
  const r = programRobot.value
  return r ? { node: r, kind: 'robot' } : null
})
export function rememberActor(id: string): void {
  lastActor.value = id
}

// the object picked last stays in the block editor when the selection is cleared
effect(() => {
  const sel = selection.value
  const nodes = doc.peek().nodes
  for (const id of sel) {
    const n = nodes.find((x) => x.id === id)
    if (n && actorKind(n)) {
      lastActor.value = id
      if (n.kind === 'prim' && n.prim === 'robot') lastRobot.value = id
      return
    }
  }
})

/**
 * The landscape brush: while on, dragging over the field lays tiles of this kind cell by cell
 * ('erase' takes them away). Null: off.
 */
export const landBrush = signal<import('./terrain').LandKind | 'erase' | null>(null)

// the brush is put away when the field is left or a run starts
effect(() => {
  if ((!roboticsMode.value || simState.value !== 'idle') && landBrush.peek()) landBrush.value = null
})

/**
 * The highest quality the beautiful view may use on this computer: lowered when frames come too
 * slowly during a run, forgotten when the chosen quality is changed. Null: as chosen.
 */
export const prettyCap = signal<import('./look').Quality | null>(null)

/** The volume of the heroes' sounds during a run, 0…100 % (kept between sessions). */
export const simVolume = signal(readVolume())
function readVolume(): number {
  try {
    const v = Number(globalThis.localStorage?.getItem('cad.volume'))
    return globalThis.localStorage?.getItem('cad.volume') !== null && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 80
  } catch {
    return 80
  }
}
effect(() => {
  const v = simVolume.value
  try {
    globalThis.localStorage?.setItem('cad.volume', String(v))
  } catch {
    /* no storage: the volume is just not kept */
  }
})

/**
 * The robot or hero the camera follows during a run (it can still be turned and zoomed); null:
 * the camera stays where it is put. Forgotten when that object is gone.
 */
export const followId = signal<string | null>(null)
effect(() => {
  const id = followId.value
  if (id && !doc.value.nodes.some((n) => n.id === id)) followId.value = null
})

/** A video of the view is being recorded. */
export const recording = signal(false)
