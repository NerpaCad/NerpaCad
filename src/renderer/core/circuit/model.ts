/**
 * Circuits: parts on a 2D board (millimetres, y down) joined by wires. The circuit lives in the
 * document next to the 3D shapes, so it is saved, undone and redone the same way.
 */

export type PartKind =
  | 'arduino'
  | 'resistor'
  | 'led'
  | 'breadboard'
  | 'pot'
  | 'servo'
  // wave 1: the starter kit
  | 'button'
  | 'switch'
  | 'buzzer'
  | 'rgb'
  | 'ldr'
  | 'battery'
  | 'meter'
  | 'seg7'
  // wave 2: motors and screens
  | 'motor'
  | 'npn'
  | 'diode'
  | 'lcd'
  | 'joystick'
  | 'tmp36'
  // wave 3: sensors
  | 'hcsr04'
  | 'ir'
  | 'pir'

/** every part kind, in the order the panel offers them */
export const PART_KINDS: PartKind[] = [
  'arduino',
  'breadboard',
  'resistor',
  'led',
  'rgb',
  'button',
  'switch',
  'pot',
  'ldr',
  'buzzer',
  'seg7',
  'battery',
  'meter',
  'servo',
  'motor',
  'npn',
  'diode',
  'lcd',
  'joystick',
  'tmp36',
  'hcsr04',
  'ir',
  'pir'
]
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
  /** battery: 9 V (a "Krona") or 3 V (two AA cells) */
  volts?: 9 | 3
  /** multimeter: what it measures */
  mode?: MeterMode
  /** switch: which side the slider is on (false: pin 1 to C, true: pin 2 to C) */
  on?: boolean
  /** buzzer: an active one beeps by itself on DC; a passive one needs `tone` */
  active?: boolean
}

export type MeterMode = 'V' | 'A'

/**
 * The room around the table: its temperature and light, and things on the table that the
 * sensors notice (they are not electrical and have no pins).
 */
export type RoomItemKind = 'box' | 'lamp' | 'heater' | 'hand'
export const ROOM_ITEM_KINDS: RoomItemKind[] = ['box', 'lamp', 'heater', 'hand']
export interface RoomItem {
  id: string
  kind: RoomItemKind
  /** centre on the table, mm */
  x: number
  y: number
  /** a lamp: switched on */
  on?: boolean
}
export interface Room {
  /** °C */
  temp: number
  /** light of the room, lux (night ~1, a dim room ~50, a lit room ~300, daylight ~1000) */
  light: number
  items: RoomItem[]
}
export const DEFAULT_ROOM: Room = { temp: 22, light: 300, items: [] }

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
  /** the room (missing: the default one) */
  room?: Room
}

export const emptyCircuit = (): Circuit => ({ parts: [], wires: [] })

export const WIRE_COLORS = ['#2e9e44', '#d8352a', '#222222', '#2f6fd6', '#e8b10b', '#ef7d1a', '#8a45c7', '#f2f2f2']
