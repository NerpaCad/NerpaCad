/**
 * Part descriptions: where the pins are (part-local mm, y down) and how big the part is.
 * The Arduino Uno layout follows the real board closely enough for wiring by eye.
 */
import type { Part, PartKind, PinRef, Rotation } from './model'

export interface PinSpec {
  id: string
  /** short label printed on the board */
  label: string
  x: number
  y: number
}

export interface PartSpec {
  kind: PartKind
  /** outline for hit testing and selection, part-local */
  box: { x: number; y: number; w: number; h: number }
  pins: PinSpec[]
  /** pins joined inside the part (the strips of a breadboard, the GND pins of a board) */
  bus?: string[][]
}

export const P = 2.54

function arduinoPins(): PinSpec[] {
  const pins: PinSpec[] = []
  const row = (labels: string[], x0: number, y: number) =>
    labels.forEach((l, i) => {
      if (!l) return
      const id = /^\d+$/.test(l) ? `D${l}` : l
      pins.push({ id, label: l.replace(/\.\d$/, ''), x: x0 + i * P, y })
    })
  row(['SCL', 'SDA', 'AREF', 'GND.1', '13', '12', '11', '10', '9', '8'], 17.5, 2.54)
  row(['7', '6', '5', '4', '3', '2', '1', '0'], 44.2, 2.54)
  row(['', 'IOREF', 'RESET', '3.3V', '5V', 'GND.2', 'GND.3', 'VIN'], 26.7, 50.8)
  row(['A0', 'A1', 'A2', 'A3', 'A4', 'A5'], 49.8, 50.8)
  return pins
}

// ---------------------------------------------------------------- breadboard

/** A 400-point breadboard: 30 columns of 2 × 5 holes and two power rails on each side. */
export const BB_COLS = 30
export const BB_ROWS_TOP = ['a', 'b', 'c', 'd', 'e']
export const BB_ROWS_BOTTOM = ['f', 'g', 'h', 'i', 'j']
/** rails: top outer −, top inner +, bottom inner +, bottom outer − (y in pitches) */
export const BB_RAILS: { id: string; y: number; plus: boolean }[] = [
  { id: 'tn', y: 0, plus: false },
  { id: 'tp', y: 1, plus: true },
  { id: 'bp', y: 16, plus: true },
  { id: 'bn', y: 17, plus: false }
]
const BB_ROW_Y: Record<string, number> = { a: 3, b: 4, c: 5, d: 6, e: 7, f: 10, g: 11, h: 12, i: 13, j: 14 }
/** 25 holes per rail line, in 5 groups of 5 with a gap between groups */
export const railColumn = (k: number) => Math.floor(k / 5) * 6 + (k % 5) + 0.5

function breadboardSpec(): PartSpec {
  const pins: PinSpec[] = []
  const bus: string[][] = []
  for (let c = 1; c <= BB_COLS; c++) {
    for (const rows of [BB_ROWS_TOP, BB_ROWS_BOTTOM]) {
      const group: string[] = []
      for (const r of rows) {
        pins.push({ id: `${r}${c}`, label: `${r}${c}`, x: (c - 1) * P, y: BB_ROW_Y[r] * P })
        group.push(`${r}${c}`)
      }
      bus.push(group)
    }
  }
  for (const rail of BB_RAILS) {
    const group: string[] = []
    for (let k = 0; k < 25; k++) {
      const id = `${rail.id}${k + 1}`
      pins.push({ id, label: rail.plus ? '+' : '−', x: railColumn(k) * P, y: rail.y * P })
      group.push(id)
    }
    bus.push(group)
  }
  return { kind: 'breadboard', box: { x: -3.3, y: -3.3, w: (BB_COLS - 1) * P + 6.6, h: 17 * P + 6.6 }, pins, bus }
}

/** Parts whose legs go into breadboard holes (a board has sockets, not legs). */
export const hasLegs = (kind: PartKind) => kind !== 'breadboard' && kind !== 'arduino'

export const SPECS: Record<PartKind, PartSpec> = {
  arduino: {
    kind: 'arduino',
    box: { x: -6.5, y: 0, w: 75.1, h: 53.3 },
    pins: arduinoPins(),
    bus: [
      ['GND.1', 'GND.2', 'GND.3'],
      ['SDA', 'A4'],
      ['SCL', 'A5']
    ]
  },
  breadboard: breadboardSpec(),
  // a trimmer potentiometer seen from above: three legs in a row, the knob over them
  pot: {
    kind: 'pot',
    box: { x: -2.6, y: -10.4, w: 2 * P + 5.2, h: 11.8 },
    pins: [
      { id: '1', label: '1', x: 0, y: 0 },
      { id: 'W', label: 'W', x: P, y: 0 },
      { id: '2', label: '2', x: 2 * P, y: 0 }
    ]
  },
  // a micro servo (SG90) seen from above; its three-wire plug: brown GND, red 5 V, orange signal
  servo: {
    kind: 'servo',
    box: { x: -11.5, y: -34, w: 2 * P + 23, h: 35.6 },
    pins: [
      { id: 'GND', label: 'GND', x: 0, y: 0 },
      { id: '5V', label: '5V', x: P, y: 0 },
      { id: 'SIG', label: 'SIG', x: 2 * P, y: 0 }
    ]
  },
  // pins 0.4" apart, the body between them
  resistor: {
    kind: 'resistor',
    box: { x: -1, y: -1.8, w: 12.16, h: 3.6 },
    pins: [
      { id: '1', label: '1', x: 0, y: 0 },
      { id: '2', label: '2', x: 4 * P, y: 0 }
    ]
  },
  // 5 mm LED seen from above: the dome over two legs; the anode is the bent (longer) leg
  led: {
    kind: 'led',
    box: { x: -1.8, y: -9, w: 6.2, h: 10 },
    pins: [
      { id: 'cathode', label: '−', x: 0, y: 0 },
      { id: 'anode', label: '+', x: P, y: 0 }
    ]
  }
}

/** Digital pins that can do PWM (analogWrite) on the Uno. */
export const PWM_PINS = [3, 5, 6, 9, 10, 11]
/** Pins a program can drive: D0–D13 and A0–A5 (as digital 14–19). */
export const IO_PINS = [...Array.from({ length: 14 }, (_, i) => `D${i}`), 'A0', 'A1', 'A2', 'A3', 'A4', 'A5']

/** Pins with the analog-to-digital converter (analogRead). */
export const ANALOG_PINS = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']

/** Pin number as the Arduino code knows it (13, A0…). */
export const pinNumber = (id: string): string => (id.startsWith('D') ? id.slice(1) : id)

export function rotatePoint(x: number, y: number, rot: Rotation): [number, number] {
  switch (rot) {
    case 90:
      return [-y, x]
    case 180:
      return [-x, -y]
    case 270:
      return [y, -x]
    default:
      return [x, y]
  }
}

/** pins of each kind by id (a breadboard has 400) */
const PIN_INDEX = new Map<PartKind, Map<string, PinSpec>>()
function pinSpec(kind: PartKind, pin: string): PinSpec | undefined {
  let m = PIN_INDEX.get(kind)
  if (!m) {
    m = new Map(SPECS[kind].pins.map((p) => [p.id, p]))
    PIN_INDEX.set(kind, m)
  }
  return m.get(pin)
}

/** A pin's position on the board, mm. */
export function pinPos(part: Part, pin: string): [number, number] | null {
  const p = pinSpec(part.kind, pin)
  if (!p) return null
  const [dx, dy] = rotatePoint(p.x, p.y, part.rot)
  return [part.x + dx, part.y + dy]
}

export function refPos(parts: Part[], r: PinRef): [number, number] | null {
  const part = parts.find((p) => p.id === r.part)
  return part ? pinPos(part, r.pin) : null
}

/** The part's outline on the board (axis-aligned after rotation). */
export function partBounds(part: Part): { x0: number; y0: number; x1: number; y1: number } {
  const b = SPECS[part.kind].box
  const corners = [
    rotatePoint(b.x, b.y, part.rot),
    rotatePoint(b.x + b.w, b.y, part.rot),
    rotatePoint(b.x, b.y + b.h, part.rot),
    rotatePoint(b.x + b.w, b.y + b.h, part.rot)
  ]
  const xs = corners.map((c) => c[0] + part.x)
  const ys = corners.map((c) => c[1] + part.y)
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

export const pinLabel = (part: Part, pin: string): string => SPECS[part.kind].pins.find((p) => p.id === pin)?.label ?? pin

/** Resistor colour bands (4-band code) for a value in ohms. */
export function resistorBands(ohms: number): string[] {
  const COL = ['#1b1b1b', '#7b4a21', '#d8352a', '#ef7d1a', '#f2d40b', '#2e9e44', '#2f6fd6', '#8a45c7', '#8f8f8f', '#f4f4f4']
  let v = Math.max(1, Math.round(ohms))
  let exp = 0
  while (v >= 100) {
    v = Math.round(v / 10)
    exp++
  }
  if (v < 10) {
    // 1…9.9 Ω: gold multiplier
    return [COL[v], COL[0], '#c9a227', '#c9a227']
  }
  return [COL[Math.floor(v / 10)], COL[v % 10], COL[Math.min(9, exp)], '#c9a227']
}

/** "220 Ом", "4.7 кОм" */
export function formatOhms(ohms: number, k: string, m: string, unit: string): string {
  if (ohms >= 1e6) return `${trim(ohms / 1e6)} ${m}`
  if (ohms >= 1e3) return `${trim(ohms / 1e3)} ${k}`
  return `${trim(ohms)} ${unit}`
}
const trim = (v: number) => String(Math.round(v * 100) / 100)
