/**
 * The circuit board editor: parts and wires drawn as SVG in millimetres.
 *
 * - drag a part to move it (snapped to half the pin pitch), R turns it, Delete removes it;
 * - click a pin to start a wire, click empty space to add bends, click another pin to finish
 *   (Esc or right click cancels);
 * - the wheel zooms around the cursor, the right or middle button (or left on empty space) pans.
 */
import { signal } from '@preact/signals'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Part, PartKind, PinRef, Room, RoomItem, RoomItemKind, Rotation } from '../core/circuit/model'
import { P, SPECS, formatOhms, partBounds, pinLabel, pinPos, refPos, rotatePoint } from '../core/circuit/parts'
import { contacts, holeSnap, partsOnBoards } from '../core/circuit/nets'
import {
  circuit,
  circuitBurnt,
  circuitJoy,
  circuitKnobs,
  circuitLive,
  circuitPressed,
  circuitResult,
  circuitRoom,
  circuitSelection,
  circuitServos,
  circuitState,
  circuitSwitches
} from '../core/circuit/state'
import { ITEM_SIZE, roomOf } from '../core/circuit/room'
import { RoomItemArt } from './circuitArt2'
import { beginGesture, cancelGesture, doc, endGesture, inGesture, previewGesture } from '../core/doc/store'
import { t } from '../i18n'
import { PartArt } from './circuitArt'
import { CircuitViewToggle } from './Circuit3D'
import { addPart, addRoomItem, addWire, snapMm } from './circuitActions'
import { flipSwitch, pressPart, setRunJoy, setRunKnob, setRunRoom } from './circuitSim'

/** A wire being drawn: where it starts and the bends so far. */
export const wiring = signal<{ from: PinRef; points: [number, number][] } | null>(null)
/** A part being dragged in from the panel. */
const ghost = signal<{ kind: PartKind; x: number; y: number } | null>(null)

interface View {
  ox: number
  oy: number
  /** pixels per millimetre */
  k: number
}

type DropApi = { toWorld(cx: number, cy: number): [number, number] | null; center(): [number, number] }
let api: DropApi | null = null
/** The 3D view takes parts and things dragged in from the panel too: it says where on the table they land. */
export function setDropApi(a: DropApi): void {
  api = a
}
export function dropDropApi(a: DropApi): void {
  if (api === a) api = null
}

const partCenter = (kind: PartKind): [number, number] => {
  const b = SPECS[kind].box
  return [b.x + b.w / 2, b.y + b.h / 2]
}

/** Drag a new part from the panel onto the board (a plain click puts it in the middle of the view). */
export function beginPartDrag(kind: PartKind, e: PointerEvent): void {
  if (e.button !== 0 || circuitState.peek() !== 'idle') return
  e.preventDefault()
  const x0 = e.clientX
  const y0 = e.clientY
  let moved = false
  const [cx, cy] = partCenter(kind)
  const move = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
    moved = true
    document.body.classList.add('shape-dragging')
    const w = api?.toWorld(ev.clientX, ev.clientY)
    if (!w) {
      ghost.value = null
      return
    }
    let x = snapMm(w[0] - cx)
    let y = snapMm(w[1] - cy)
    // over a breadboard the legs drop into the holes already in the preview
    const pull = holeSnap([...circuit.peek().parts, { id: '\u0000ghost', kind, x, y, rot: 0 }], new Set(['\u0000ghost']))
    if (pull) {
      x = round(x + pull[0])
      y = round(y + pull[1])
    }
    ghost.value = { kind, x, y }
  }
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.classList.remove('shape-dragging')
    const g = ghost.peek()
    ghost.value = null
    if (!moved) {
      const c = api?.center() ?? [40, 25]
      addPart(kind, c[0] - cx, c[1] - cy)
    } else if (g && api?.toWorld(ev.clientX, ev.clientY)) addPart(kind, g.x, g.y)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

type Drag =
  | { kind: 'pan'; x: number; y: number; ox: number; oy: number; click: boolean }
  | { kind: 'move'; ids: Set<string>; wx: number; wy: number; moved: boolean }
  | { kind: 'knob'; id: string; angle: number }
  /** a button (or a joystick's switch) held down during the run */
  | { kind: 'press'; id: string }
  /** a joystick's stick pushed during the run (it springs back when let go) */
  | { kind: 'joy'; id: string }
  /** a thing of the room moved (while editing: an undo step; while running: only the run's room) */
  | { kind: 'item'; id: string; wx: number; wy: number; room: Room; moved: boolean; running: boolean }

/** A room thing being dragged in from the panel. */
const ghostItem = signal<{ kind: RoomItemKind; x: number; y: number } | null>(null)

/** Drag a new thing of the room from the panel onto the table (a click puts it in the middle). */
export function beginItemDrag(kind: RoomItemKind, e: PointerEvent): void {
  if (e.button !== 0) return
  e.preventDefault()
  const x0 = e.clientX
  const y0 = e.clientY
  let moved = false
  const move = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
    moved = true
    document.body.classList.add('shape-dragging')
    const w = api?.toWorld(ev.clientX, ev.clientY)
    ghostItem.value = w ? { kind, x: snapMm(w[0]), y: snapMm(w[1]) } : null
  }
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.classList.remove('shape-dragging')
    const g = ghostItem.peek()
    ghostItem.value = null
    if (!moved) {
      const c = api?.center() ?? [40, -60]
      addRoomItem(kind, c[0], c[1])
    } else if (g && api?.toWorld(ev.clientX, ev.clientY)) addRoomItem(kind, g.x, g.y)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/** A point in a part's own frame (undoing its position and turn). */
function toLocal(p: Part, w: [number, number]): [number, number] {
  return rotatePoint(w[0] - p.x, w[1] - p.y, ((360 - p.rot) % 360) as Rotation)
}

/** the middle of a joystick's stick in its own frame, and how far it goes either way (mm) */
const JOY_CENTER: [number, number] = [2 * P, -17]
const JOY_TRAVEL = 5

/** Where a potentiometer's knob is on the board (its turning centre), mm. */
function knobCenter(p: Part): [number, number] {
  const [dx, dy] = rotatePoint(P, -5.8, p.rot)
  return [p.x + dx, p.y + dy]
}

/** Where the pointer is around the knob: degrees clockwise from "up". */
function pointerAngle(p: Part, w: [number, number]): number {
  const [cx, cy] = knobCenter(p)
  return (Math.atan2(w[0] - cx, -(w[1] - cy)) * 180) / Math.PI
}

/** The potentiometer whose knob is under the pointer (wires lying over it do not get in the way). */
function potAt(parts: Part[], w: [number, number]): Part | undefined {
  let best: Part | undefined
  let bd = 5.5
  for (const p of parts) {
    if (p.kind !== 'pot') continue
    const [cx, cy] = knobCenter(p)
    const d = Math.hypot(w[0] - cx, w[1] - cy)
    if (d < bd) {
      bd = d
      best = p
    }
  }
  return best
}

/** the knob turns through 270° from one end to the other */
const KNOB_TRAVEL = 270

export function CircuitView() {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [view, setView] = useState<View>({ ox: -40, oy: -60, k: 7 })
  const [cursor, setCursor] = useState<[number, number] | null>(null)
  const [hoverPin, setHoverPin] = useState<{ ref: PinRef; x: number; y: number } | null>(null)
  const drag = useRef<Drag | null>(null)
  const viewRef = useRef(view)
  viewRef.current = view
  const c = circuit.value
  const running = circuitState.value === 'running'
  const result = circuitResult.value
  const burnt = circuitBurnt.value
  const sel = new Set(circuitSelection.value)

  const toWorld = (cx: number, cy: number): [number, number] | null => {
    const r = host.current?.getBoundingClientRect()
    if (!r || cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null
    const v = viewRef.current
    return [v.ox + (cx - r.left) / v.k, v.oy + (cy - r.top) / v.k]
  }

  useEffect(() => {
    const el = host.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 600 }))
    ro.observe(el)
    const mine: DropApi = (api = {
      toWorld,
      center: () => {
        const v = viewRef.current
        return [v.ox + el.clientWidth / v.k / 2, v.oy + el.clientHeight / v.k / 2]
      }
    })
    // first view: everything on the board, or the empty board around the origin
    requestAnimationFrame(() => fit())
    return () => {
      ro.disconnect()
      if (api === mine) api = null
      wiring.value = null
      gestureCircuit = null
      if (inGesture()) cancelGesture()
    }
  }, [])

  const fit = () => {
    const el = host.current
    if (!el) return
    const parts = circuit.peek().parts
    const items = roomOf(circuit.peek()).items
    const w = el.clientWidth || 800
    const h = el.clientHeight || 600
    if (!parts.length && !items.length) return setView({ ox: -30, oy: -40, k: Math.min(w / 150, h / 110) })
    // the parts and the things of the room on the table
    const bs = [
      ...parts.map(partBounds),
      ...items.map((it) => {
        const s = ITEM_SIZE[it.kind]
        return { x0: it.x - s.hw, y0: it.y - s.hh, x1: it.x + s.hw, y1: it.y + s.hh }
      })
    ]
    const x0 = Math.min(...bs.map((b) => b.x0)) - 15
    const y0 = Math.min(...bs.map((b) => b.y0)) - 15
    const x1 = Math.max(...bs.map((b) => b.x1)) + 15
    const y1 = Math.max(...bs.map((b) => b.y1)) + 15
    const k = Math.min(w / (x1 - x0), h / (y1 - y0), 14)
    setView({ ox: (x0 + x1) / 2 - w / k / 2, oy: (y0 + y1) / 2 - h / k / 2, k })
  }
  fitRef = fit

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const p = toWorld(e.clientX, e.clientY)
    if (!p) return
    if (circuitState.peek() === 'running') {
      const pot = potAt(circuit.peek().parts, p)
      if (pot) {
        if (!e.deltaY) return
        const k = circuitKnobs.peek()[pot.id] ?? pot.knob ?? 0.5
        // a wheel notch (~100) turns it 4 %; trackpads send many small steps
        setRunKnob(pot.id, k + Math.max(-0.04, Math.min(0.04, -e.deltaY * 0.0004)))
        return
      }
    }
    const v = viewRef.current
    const k = Math.max(1.5, Math.min(40, v.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
    const r = host.current!.getBoundingClientRect()
    setView({ k, ox: p[0] - (e.clientX - r.left) / k, oy: p[1] - (e.clientY - r.top) / k })
  }

  const hit = (e: PointerEvent) => {
    let el = e.target as Element | null
    while (el && el !== host.current) {
      const d = (el as HTMLElement).dataset
      if (d?.pin) {
        const [part, pin] = d.pin.split('|')
        return { pin: { part, pin } as PinRef }
      }
      if (d?.part) return { part: d.part }
      if (d?.item) return { item: d.item }
      if (d?.wire) return { wire: d.wire }
      el = el.parentElement
    }
    return {}
  }

  const onDown = (e: PointerEvent) => {
    const el = host.current!
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    el.setPointerCapture(e.pointerId)
    const v = viewRef.current
    const w = toWorld(e.clientX, e.clientY)
    if (e.button === 2 && wiring.peek()) {
      wiring.value = null
      return
    }
    const pot = running && e.button === 0 && w ? potAt(circuit.peek().parts, w) : undefined
    if (pot && w) {
      // during a run the knob of a potentiometer is turned by moving the mouse around it
      // (it turns as much as the pointer does, so a click alone changes nothing)
      drag.current = { kind: 'knob', id: pot.id, angle: pointerAngle(pot, w) }
      circuitSelection.value = [pot.id]
      return
    }
    if (running && e.button === 0 && w) {
      // during a run: buttons are held, switches flipped, joysticks pushed, things of the room moved
      const h = hit(e)
      const part = h.part ? circuit.peek().parts.find((p) => p.id === h.part) : undefined
      if (part?.kind === 'button') {
        pressPart(part.id, true)
        drag.current = { kind: 'press', id: part.id }
        return
      }
      if (part?.kind === 'switch') {
        flipSwitch(part.id)
        drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy, click: false }
        return
      }
      if (part?.kind === 'joystick') {
        const [lx, ly] = toLocal(part, w)
        if (Math.hypot(lx - JOY_CENTER[0], ly - JOY_CENTER[1]) <= 7.5) {
          drag.current = { kind: 'joy', id: part.id }
          moveStick(part, w)
        } else {
          // the board around the stick: its push switch
          pressPart(part.id, true)
          drag.current = { kind: 'press', id: part.id }
        }
        return
      }
      if (h.item) {
        drag.current = { kind: 'item', id: h.item, wx: w[0], wy: w[1], room: circuitRoom.peek() ?? roomOf(circuit.peek()), moved: false, running: true }
        return
      }
    }
    if (e.button !== 0 || running || !w) {
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy, click: false }
      return
    }
    const h = hit(e)
    const wire = wiring.peek()
    if (wire) {
      if (h.pin) {
        addWire(wire.from, h.pin, wire.points)
        wiring.value = null
      } else wiring.value = { ...wire, points: [...wire.points, [snapMm(w[0]), snapMm(w[1])]] }
      return
    }
    if (h.pin) {
      wiring.value = { from: h.pin, points: [] }
      circuitSelection.value = []
      return
    }
    if (h.part) {
      const s = circuitSelection.peek()
      if (e.shiftKey) circuitSelection.value = s.includes(h.part) ? s.filter((x) => x !== h.part) : [...s, h.part]
      else if (!s.includes(h.part)) circuitSelection.value = [h.part]
      beginGesture()
      const ids = new Set(circuitSelection.peek())
      // parts plugged into a breadboard travel with it
      const boards = new Set(circuit.peek().parts.filter((p) => ids.has(p.id) && p.kind === 'breadboard').map((p) => p.id))
      if (boards.size) for (const id of partsOnBoards(circuit.peek(), boards)) ids.add(id)
      drag.current = { kind: 'move', ids, wx: w[0], wy: w[1], moved: false }
      return
    }
    if (h.wire) {
      circuitSelection.value = e.shiftKey ? [...circuitSelection.peek(), h.wire] : [h.wire]
      return
    }
    if (h.item) {
      circuitSelection.value = [h.item]
      beginGesture()
      drag.current = { kind: 'item', id: h.item, wx: w[0], wy: w[1], room: roomOf(circuit.peek()), moved: false, running: false }
      return
    }
    drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy, click: true }
  }

  const onMove = (e: PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY)
    setCursor(w)
    const d = drag.current
    if (!d) {
      const h = hit(e)
      if (h.pin) {
        const r = host.current!.getBoundingClientRect()
        setHoverPin({ ref: h.pin, x: e.clientX - r.left, y: e.clientY - r.top })
      } else if (hoverPin) setHoverPin(null)
      return
    }
    if (d.kind === 'joy') {
      const p = circuit.peek().parts.find((x) => x.id === d.id)
      if (p && w) moveStick(p, w)
      return
    }
    if (d.kind === 'press') return
    if (d.kind === 'item') {
      if (!w) return
      const dx = round(w[0] - d.wx)
      const dy = round(w[1] - d.wy)
      if (!d.moved && Math.hypot(dx, dy) < 0.8) return
      d.moved = true
      const room = { ...d.room, items: d.room.items.map((it) => (it.id === d.id ? { ...it, x: round(it.x + dx), y: round(it.y + dy) } : it)) }
      if (d.running) setRunRoom(room)
      else previewGesture({ ...doc.peek(), circuit: { ...(gestureCircuit ??= circuit.peek()), room } })
      return
    }
    if (d.kind === 'knob') {
      const p = circuit.peek().parts.find((x) => x.id === d.id)
      if (p && w) {
        const a = pointerAngle(p, w)
        const turn = ((((a - d.angle + 180) % 360) + 360) % 360) - 180
        d.angle = a
        const prev = circuitKnobs.peek()[p.id] ?? p.knob ?? 0.5
        if (turn) setRunKnob(p.id, prev + turn / KNOB_TRAVEL)
      }
      return
    }
    if (d.kind === 'pan') {
      const k = viewRef.current.k
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) d.click = false
      setView({ k, ox: d.ox - (e.clientX - d.x) / k, oy: d.oy - (e.clientY - d.y) / k })
      return
    }
    if (!w) return
    const dx = snapMm(w[0] - d.wx)
    const dy = snapMm(w[1] - d.wy)
    if (!dx && !dy && !d.moved) return
    d.moved = true
    const cur = doc.peek()
    // positions are measured from where the drag started
    const src = (gestureCircuit ??= circuit.peek())
    let parts = src.parts.map((p) => (d.ids.has(p.id) ? { ...p, x: round(p.x + dx), y: round(p.y + dy) } : p))
    // legs near breadboard holes drop into them
    const pull = holeSnap(parts, d.ids)
    let sx = 0
    let sy = 0
    if (pull && (pull[0] || pull[1])) {
      sx = pull[0]
      sy = pull[1]
      parts = parts.map((p) => (d.ids.has(p.id) ? { ...p, x: round(p.x + sx), y: round(p.y + sy) } : p))
    }
    // bends of wires between moved parts move along
    const wires = src.wires.map((wr) =>
      d.ids.has(wr.a.part) && d.ids.has(wr.b.part) ? { ...wr, points: wr.points.map(([x, y]) => [round(x + dx + sx), round(y + dy + sy)] as [number, number]) } : wr
    )
    previewGesture({ ...cur, circuit: { ...src, parts, wires } })
  }

  /** Push a joystick's stick toward the pointer (as far as it goes). */
  const moveStick = (p: Part, w: [number, number]) => {
    const [lx, ly] = toLocal(p, w)
    let dx = lx - JOY_CENTER[0]
    let dy = ly - JOY_CENTER[1]
    const len = Math.hypot(dx, dy)
    if (len > JOY_TRAVEL) {
      dx *= JOY_TRAVEL / len
      dy *= JOY_TRAVEL / len
    }
    setRunJoy(p.id, 0.5 + dx / (2 * JOY_TRAVEL), 0.5 + dy / (2 * JOY_TRAVEL))
  }

  const onUp = (e: PointerEvent) => {
    const el = host.current!
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    const d = drag.current
    drag.current = null
    gestureCircuit = null
    if (!d) return
    if (d.kind === 'move') {
      if (d.moved) endGesture()
      else cancelGesture()
    } else if (d.kind === 'press') pressPart(d.id, false)
    else if (d.kind === 'joy') setRunJoy(d.id, 0.5, 0.5)
    else if (d.kind === 'item') {
      // a click on a lamp switches it
      const it = d.room.items.find((x) => x.id === d.id)
      const flip = !d.moved && it?.kind === 'lamp'
      const room = flip ? { ...d.room, items: d.room.items.map((x) => (x.id === d.id ? { ...x, on: !x.on } : x)) } : null
      if (d.running) {
        if (room) setRunRoom(room)
      } else if (room) {
        previewGesture({ ...doc.peek(), circuit: { ...circuit.peek(), room } })
        endGesture()
      } else if (d.moved) endGesture()
      else cancelGesture()
    } else if (d.kind === 'pan' && d.click && !wiring.peek()) circuitSelection.value = []
  }

  /** the pointer is lost (another window, a touch cancelled): let go, take back an unfinished move */
  const onLost = () => {
    const d = drag.current
    drag.current = null
    gestureCircuit = null
    if (!d) return
    if (d.kind === 'press') pressPart(d.id, false)
    else if (d.kind === 'joy') setRunJoy(d.id, 0.5, 0.5)
    else if (d.kind === 'move' || (d.kind === 'item' && !d.running)) cancelGesture()
  }

  const v = view
  const vb = `${v.ox} ${v.oy} ${size.w / v.k} ${size.h / v.k}`
  const wirePath = (pts: [number, number][]) => pts.map((p) => p.join(',')).join(' ')
  const w = wiring.value
  const from = w ? refPos(c.parts, w.from) : null
  const tip = hoverPin ? tooltip(c.parts, hoverPin.ref, result?.voltage.get(`${hoverPin.ref.part}:${hoverPin.ref.pin}`)) : null
  const boards = c.parts.filter((p) => p.kind === 'breadboard')
  const others = c.parts.filter((p) => p.kind !== 'breadboard')
  /** holes with a leg in them */
  const plugged = new Set(boards.length ? contacts(c).map(([, hole]) => hole) : [])
  const knobs = circuitKnobs.value
  const servos = circuitServos.value
  const g = ghost.value
  const gi = ghostItem.value
  const live = circuitLive.value
  const pressed = circuitPressed.value
  const switches = circuitSwitches.value
  const joys = circuitJoy.value
  const room = running ? (circuitRoom.value ?? roomOf(c)) : roomOf(c)
  const litOf = (id: string) => (pin: string) => (burnt.has(`${id}:${pin}`) ? 0 : (result?.leds.get(`${id}:${pin}`)?.brightness ?? 0))

  return (
    <div
      class={`circuit-view${w ? ' wiring' : ''}${running ? ' running' : ''}`}
      ref={host}
      data-testid="circuit-view"
      onWheel={(e) => onWheel(e as unknown as WheelEvent)}
      onPointerDown={(e) => onDown(e as unknown as PointerEvent)}
      onPointerMove={(e) => onMove(e as unknown as PointerEvent)}
      onPointerUp={(e) => onUp(e as unknown as PointerEvent)}
      onPointerCancel={onLost}
      onLostPointerCapture={onLost}
      onPointerLeave={() => (setCursor(null), setHoverPin(null))}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg width={size.w} height={size.h} viewBox={vb} class="circuit-svg">
        <defs>
          <pattern id="ckt-grid" width="2.54" height="2.54" patternUnits="userSpaceOnUse">
            <circle cx="0" cy="0" r="0.16" class="ckt-dot" />
          </pattern>
          <radialGradient id="lamp-glow">
            <stop offset="0" stop-color="#fff2a8" stop-opacity="0.55" />
            <stop offset="1" stop-color="#fff2a8" stop-opacity="0" />
          </radialGradient>
        </defs>
        <rect x={v.ox} y={v.oy} width={size.w / v.k} height={size.h / v.k} fill="url(#ckt-grid)" />
        {/* breadboards lie under everything, their holes can be wired to */}
        {boards.map((p) => (
          <g transform={`translate(${p.x} ${p.y}) rotate(${p.rot})`} data-part={p.id} class={`ckt-part${sel.has(p.id) ? ' sel' : ''}`} data-testid="part-breadboard">
            <PartArt part={p} />
          </g>
        ))}
        {/* the things of the room lie on the table under the parts */}
        {room.items.map((it: RoomItem) => {
          const s = ITEM_SIZE[it.kind]
          return (
            <g transform={`translate(${it.x} ${it.y})`} data-item={it.id} class={`ckt-item${sel.has(it.id) ? ' sel' : ''}`} data-testid={`item-${it.kind}`}>
              <RoomItemArt item={it} />
              {sel.has(it.id) && <rect x={-s.hw - 2} y={-s.hh - 2} width={2 * s.hw + 4} height={2 * s.hh + 4} class="ckt-sel" />}
            </g>
          )
        })}
        {boards.flatMap((p) =>
          SPECS.breadboard.pins.map((pin) => {
            const pos = pinPos(p, pin.id)!
            const k = `${p.id}:${pin.id}`
            return (
              <rect
                x={pos[0] - 0.95}
                y={pos[1] - 0.95}
                width="1.9"
                height="1.9"
                rx="0.3"
                data-pin={`${p.id}|${pin.id}`}
                class={`ckt-pin ckt-hole${plugged.has(k) ? ' plugged' : ''}`}
                data-testid={`hole-${pin.id}`}
              />
            )
          })
        )}
        {others.map((p) => {
          const led = result?.leds.get(p.id)
          const sv = servos[p.id]
          return (
            <g transform={`translate(${p.x} ${p.y}) rotate(${p.rot})`} data-part={p.id} class={`ckt-part${sel.has(p.id) ? ' sel' : ''}${running && HANDLED.has(p.kind) ? ' knob' : ''}`} data-testid={`part-${p.kind}`}>
              <PartArt
                part={p}
                l13={result?.builtin.get(p.id) ?? 0}
                on={running}
                brightness={led?.brightness ?? 0}
                burnt={burnt.has(p.id)}
                knob={running ? knobs[p.id] : undefined}
                angle={sv?.angle}
                alarm={!!sv && sv.driven && !sv.powered}
                show={{ live: live[p.id], lit: litOf(p.id), pressed: pressed.has(p.id), on: running ? switches[p.id] : undefined, joy: joys[p.id], running }}
              />
            </g>
          )
        })}
        {c.parts
          .filter((p) => sel.has(p.id))
          .map((p) => {
            const b = partBounds(p)
            return <rect x={b.x0 - 1} y={b.y0 - 1} width={b.x1 - b.x0 + 2} height={b.y1 - b.y0 + 2} class="ckt-sel" />
          })}
        {c.wires.map((wr) => {
          const a = refPos(c.parts, wr.a)
          const b = refPos(c.parts, wr.b)
          if (!a || !b) return null
          const pts = wirePath([a, ...wr.points, b])
          return (
            <g data-wire={wr.id} class="ckt-wire" data-testid="wire">
              <polyline points={pts} class="ckt-wire-hit" />
              {sel.has(wr.id) && <polyline points={pts} class="ckt-wire-sel" />}
              <polyline points={pts} fill="none" stroke="#00000055" stroke-width="1.25" stroke-linejoin="round" stroke-linecap="round" />
              <polyline points={pts} fill="none" stroke={wr.color} stroke-width="0.85" stroke-linejoin="round" stroke-linecap="round" />
              <circle cx={a[0]} cy={a[1]} r="0.7" fill={wr.color} stroke="#00000066" stroke-width="0.2" />
              <circle cx={b[0]} cy={b[1]} r="0.7" fill={wr.color} stroke="#00000066" stroke-width="0.2" />
            </g>
          )
        })}
        {/* pins on top, so they can always be clicked */}
        {others.flatMap((p) =>
          SPECS[p.kind].pins.map((pin) => {
            const pos = pinPos(p, pin.id)!
            return <rect x={pos[0] - 1} y={pos[1] - 1} width="2" height="2" rx="0.3" data-pin={`${p.id}|${pin.id}`} class="ckt-pin" data-testid={`pin-${p.kind}-${pin.id}`} />
          })
        )}
        {w && from && (
          <polyline points={wirePath([from, ...w.points, ...(cursor ? [cursor] : [])])} class="ckt-rubber" />
        )}
        {gi && (
          <g transform={`translate(${gi.x} ${gi.y})`} opacity="0.6" pointer-events="none">
            <RoomItemArt item={{ id: 'ghost', kind: gi.kind, x: 0, y: 0 }} />
          </g>
        )}
        {g && (
          <g transform={`translate(${g.x} ${g.y})`} opacity="0.6" pointer-events="none">
            <PartArt part={{ id: 'ghost', kind: g.kind, x: 0, y: 0, rot: 0, ohms: g.kind === 'pot' ? 10_000 : 220, color: 'red', knob: 0.5 }} />
          </g>
        )}
      </svg>
      {tip && (
        <div class="ckt-tip" style={{ left: `${hoverPin!.x + 14}px`, top: `${hoverPin!.y + 12}px` }}>
          {tip}
        </div>
      )}
      <CircuitViewToggle />
      {c.parts.length === 0 && !g && <div class="empty-hint">{t('ckt.emptyHint')}</div>}
      {w && <div class="mode-hint">{t('ckt.wiringHint')}</div>}
    </div>
  )
}

let gestureCircuit: import('../core/circuit/model').Circuit | null = null
let fitRef: (() => void) | null = null
/** Show the whole circuit. */
export const fitCircuit = () => fitRef?.()
/** The 3D view shows the whole circuit its own way while it is open. */
export function setCircuitFit(fn: () => void): void {
  fitRef = fn
}
/** The 3D view closes: its way of fitting goes too (unless the flat board has put its own already). */
export function dropCircuitFit(fn: () => void): void {
  if (fitRef === fn) fitRef = null
}

const round = (v: number) => Math.round(v * 1000) / 1000
/** parts the mouse works during a run (the pointer shows it) */
const HANDLED = new Set<PartKind>(['pot', 'button', 'switch', 'joystick'])

function tooltip(parts: Part[], ref: PinRef, volts: number | undefined): string | null {
  const p = parts.find((x) => x.id === ref.part)
  if (!p) return null
  const name =
    p.kind === 'led'
      ? t(ref.pin === 'anode' ? 'ckt.anode' : 'ckt.cathode')
      : p.kind === 'resistor'
        ? `${t('ckt.part.resistor')} ${formatOhms(p.ohms ?? 220, t('ckt.kohm'), t('ckt.mohm'), t('ckt.ohm'))}`
        : p.kind === 'breadboard'
          ? holeName(ref.pin)
          : p.kind === 'pot'
            ? t(ref.pin === 'W' ? 'ckt.potWiper' : 'ckt.potEnd', { n: ref.pin })
            : p.kind === 'servo'
              ? t(`ckt.servo.${ref.pin === '5V' ? 'power' : ref.pin === 'GND' ? 'ground' : 'signal'}` as never)
              : pinLabel(p, ref.pin)
  return volts === undefined ? name : `${name} · ${volts.toFixed(2)} ${t('ckt.volt')}`
}

/** "a12", "rail +" … */
function holeName(pin: string): string {
  const m = /^(t|b)(p|n)\d+$/.exec(pin)
  if (m) return t(m[2] === 'p' ? 'ckt.railPlus' : 'ckt.railMinus')
  return t('ckt.hole', { name: pin })
}
