/** Circuit editing commands: every change is one undo step in the document. */
import { batch } from '@preact/signals'
import { type Circuit, type LedColor, type Part, type PartKind, type PinRef, type Rotation, WIRE_COLORS } from '../core/circuit/model'
import { blinkCircuit, breadboardCircuit } from '../core/circuit/demo'
import { SPECS, rotatePoint } from '../core/circuit/parts'
import { partsOnBoards } from '../core/circuit/nets'
import { circuit, circuitSelection, circuitsMode } from '../core/circuit/state'
import { newId } from '../core/doc/model'
import { commit, doc } from '../core/doc/store'
import { roboticsMode } from '../core/robotics/state'
import { placingRuler, placingWorkplane, ruler, workplane } from '../core/doc/store'
import { session, sketchPicking } from '../core/sketch/session'
import { t } from '../i18n'
import { leaveSketch, notify } from './actions'
import { stopSim } from './sim'
import { stopCircuit } from './circuitSim'

export function commitCircuit(c: Circuit, sel?: string[]): void {
  commit({ ...doc.value, circuit: c })
  if (sel) circuitSelection.value = sel
}

// ---------------------------------------------------------------- tab

export function circuitsTab(): void {
  if (circuitsMode.value) return
  if (session.value) {
    if (!window.confirm(t('robo.leaveSketch'))) return
    leaveSketch()
  }
  stopSim()
  batch(() => {
    sketchPicking.value = false
    placingWorkplane.value = false
    placingRuler.value = false
    workplane.value = null
    ruler.value = null
    roboticsMode.value = false
    circuitsMode.value = true
  })
}

export function leaveCircuits(): void {
  if (!circuitsMode.value) return
  stopCircuit()
  circuitSelection.value = []
  circuitsMode.value = false
}

// ---------------------------------------------------------------- parts

export function addPart(kind: PartKind, x: number, y: number): string {
  const c = circuit.value
  if (kind === 'arduino' && c.parts.some((p) => p.kind === 'arduino')) {
    notify(t('ckt.oneArduino'), 'error')
    return ''
  }
  const p: Part = { id: newId(), kind, x: snapMm(x), y: snapMm(y), rot: 0 }
  if (kind === 'resistor') p.ohms = 220
  if (kind === 'led') p.color = 'red'
  if (kind === 'pot') {
    p.ohms = 10_000
    p.knob = 0.5
  }
  commitCircuit({ ...c, parts: [...c.parts, p] }, [p.id])
  return p.id
}

/** Parts sit on a 1.27 mm grid (half the pin pitch), so pins line up. */
export const snapMm = (v: number) => Math.round(v / 1.27) * 1.27

export function updatePart(id: string, patch: Partial<Part>): void {
  const c = circuit.value
  commitCircuit({ ...c, parts: c.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
}

export const setOhms = (id: string, ohms: number) => updatePart(id, { ohms: Math.max(1, Math.min(10_000_000, ohms)) })
export const setLedColor = (id: string, color: LedColor) => updatePart(id, { color })
export const setKnob = (id: string, knob: number) => updatePart(id, { knob: Math.max(0, Math.min(1, knob)) })
export const setArduinoProgram = (id: string, program: unknown) => {
  const p = circuit.value.parts.find((x) => x.id === id)
  if (!p || JSON.stringify(p.program ?? null) === JSON.stringify(program ?? null)) return
  updatePart(id, { program })
}

/** R: turn the selected parts by 90° (around their first pin); a breadboard takes its parts along. */
export function rotateSelectedParts(dir: 1 | -1 = 1): void {
  const sel = new Set(circuitSelection.value)
  const c = circuit.value
  if (!c.parts.some((p) => sel.has(p.id))) return
  const turn = (r: Rotation) => ((((r + 90 * dir) % 360) + 360) % 360) as Rotation
  const q: Rotation = dir === 1 ? 90 : 270
  // parts plugged into a turned breadboard swing around the board's origin with it
  const pivot = new Map<string, [number, number]>()
  for (const b of c.parts) {
    if (b.kind !== 'breadboard' || !sel.has(b.id)) continue
    for (const id of partsOnBoards(c, new Set([b.id]))) if (!pivot.has(id)) pivot.set(id, [b.x, b.y])
  }
  const swing = (x: number, y: number, [px, py]: [number, number]): [number, number] => {
    const [dx, dy] = rotatePoint(x - px, y - py, q)
    return [round3(px + dx), round3(py + dy)]
  }
  const parts = c.parts.map((p) => {
    const pv = pivot.get(p.id)
    if (pv) {
      const [x, y] = swing(p.x, p.y, pv)
      return { ...p, x, y, rot: turn(p.rot) }
    }
    return sel.has(p.id) ? { ...p, rot: turn(p.rot) } : p
  })
  // bends of wires between things that swung around the same board swing too
  const anchor = new Map(pivot)
  for (const b of c.parts) if (b.kind === 'breadboard' && sel.has(b.id)) anchor.set(b.id, [b.x, b.y])
  const wires = c.wires.map((w) => {
    const a = anchor.get(w.a.part)
    const b = anchor.get(w.b.part)
    if (!a || !b || a[0] !== b[0] || a[1] !== b[1] || !w.points.length) return w
    return { ...w, points: w.points.map(([x, y]) => swing(x, y, a)) }
  })
  commitCircuit({ parts, wires })
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

export function deleteCircuitSelection(): void {
  const sel = new Set(circuitSelection.value)
  if (!sel.size) return
  const c = circuit.value
  const parts = c.parts.filter((p) => !sel.has(p.id))
  const alive = new Set(parts.map((p) => p.id))
  // wires go with the parts they were attached to
  const wires = c.wires.filter((w) => !sel.has(w.id) && alive.has(w.a.part) && alive.has(w.b.part))
  commitCircuit({ parts, wires }, [])
}

// ---------------------------------------------------------------- wires

/** GND wires are black, power red, the rest green — like on a real desk. */
function wireColor(a: PinRef, b: PinRef): string {
  const pins = [a.pin, b.pin]
  if (pins.some((p) => p.startsWith('GND') || p === 'cathode')) return WIRE_COLORS[2]
  if (pins.some((p) => p === '5V' || p === '3.3V' || p === 'VIN')) return WIRE_COLORS[1]
  return WIRE_COLORS[0]
}

export function addWire(a: PinRef, b: PinRef, points: [number, number][]): string {
  if (a.part === b.part && a.pin === b.pin) return ''
  const c = circuit.value
  const same = c.wires.find(
    (w) => (w.a.part === a.part && w.a.pin === a.pin && w.b.part === b.part && w.b.pin === b.pin) || (w.a.part === b.part && w.a.pin === b.pin && w.b.part === a.part && w.b.pin === a.pin)
  )
  if (same) return same.id
  const w = { id: newId(), a, b, points, color: wireColor(a, b) }
  commitCircuit({ ...c, wires: [...c.wires, w] }, [w.id])
  return w.id
}

export function setWireColor(id: string, color: string): void {
  const c = circuit.value
  commitCircuit({ ...c, wires: c.wires.map((w) => (w.id === id ? { ...w, color } : w)) })
}

// ---------------------------------------------------------------- demo

/** Put the "Blink" circuit on the board (replaces the circuit; one undo step brings it back). */
export function loadBlinkDemo(): void {
  if (circuit.value.parts.length && !window.confirm(t('ckt.replaceConfirm'))) return
  stopCircuit()
  commitCircuit(blinkCircuit(), [])
  circuitsMode.value = true
}

/** Put the breadboard example on the board: a potentiometer turns a servo and dims an LED. */
export function loadBreadboardDemo(): void {
  if (circuit.value.parts.length && !window.confirm(t('ckt.replaceConfirm'))) return
  stopCircuit()
  commitCircuit(breadboardCircuit(), [])
  circuitsMode.value = true
}

export const partName = (kind: PartKind) => t(`ckt.part.${kind}` as never)
export { SPECS }
