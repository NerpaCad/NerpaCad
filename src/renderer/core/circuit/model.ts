/**
 * Circuits: parts on a 2D board (millimetres, y down) joined by wires. The circuit lives in the
 * document next to the 3D shapes, so it is saved, undone and redone the same way.
 */

export type PartKind = 'arduino' | 'resistor' | 'led' | 'breadboard' | 'pot' | 'servo'
export type LedColor = 'red' | 'yellow' | 'green' | 'blue' | 'white'
export const LED_COLORS: LedColor[] = ['red', 'yellow', 'green', 'blue', 'white']
export type Rotation = 0 | 90 | 180 | 270

export interface Part {
  id: string
  kind: PartKind
  /** position of the part's origin, mm */
  x: number
  y: number
  rot: Rotation
  /** resistor, potentiometer: resistance, ohms (a potentiometer: end to end) */
  ohms?: number
  /** potentiometer: where the knob is, 0 (at pin 1) … 1 (at pin 2) */
  knob?: number
  /** led: colour */
  color?: LedColor
  /** arduino: the block program (Blockly JSON) */
  program?: unknown
}

/** One end of a wire: a pin of a part. */
export interface PinRef {
  part: string
  pin: string
}

export interface Wire {
  id: string
  a: PinRef
  b: PinRef
  /** bend points between the ends, mm */
  points: [number, number][]
  color: string
}

export interface Circuit {
  parts: Part[]
  wires: Wire[]
}

export const emptyCircuit = (): Circuit => ({ parts: [], wires: [] })

export const WIRE_COLORS = ['#2e9e44', '#d8352a', '#222222', '#2f6fd6', '#e8b10b', '#ef7d1a', '#8a45c7', '#f2f2f2']
