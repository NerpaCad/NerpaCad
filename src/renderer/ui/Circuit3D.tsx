/**
 * The circuit on a table in 3D: turn around it with the mouse (left drag turns, right drag
 * moves, the wheel zooms). It is the same circuit as the flat board — parts are put together and
 * wired there — but here it can be played with: during a run a button is pressed by holding it,
 * a switch flips with a click, and the room's things (a box, a lamp, a mug, a hand) are dragged
 * about on the table; a click on a lamp switches it.
 */
import { h, render } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import type { Part, Room } from '../core/circuit/model'
import {
  circuit,
  circuit3d,
  circuitBurnt,
  circuitJoy,
  circuitKnobs,
  circuitLive,
  circuitPressed,
  circuitResult,
  circuitRoom,
  circuitServos,
  circuitState,
  circuitSwitches
} from '../core/circuit/state'
import { roomOf } from '../core/circuit/room'
import { beginGesture, cancelGesture, doc, endGesture, inGesture, previewGesture } from '../core/doc/store'
import { CircuitScene, type DecalSource } from '../view/circuit3d'
import { t } from '../i18n'
import { themeId } from '../themes'
import { PartArt } from './circuitArt'
import { flipSwitch, pressPart, setRunJoy, setRunKnob, setRunRoom } from './circuitSim'
import { dropCircuitFit, dropDropApi, setCircuitFit, setDropApi } from './CircuitView'
import { snapMm } from './circuitActions'

/** parts that are handled with the mouse during a run */
const HANDLED = new Set(['button', 'switch', 'pot', 'joystick'])

/** pixels per millimetre of a part's picture */
const DECAL_PX = 14

/** A part's flat drawing as an image (cached: parts of a kind look the same unless their settings differ). */
const decals = new Map<string, Promise<HTMLImageElement | null>>()
const decalOf: DecalSource = (part: Part, rect) => {
  const key = JSON.stringify([part.kind, part.color, part.volts, part.mode, part.ohms, rect])
  let got = decals.get(key)
  if (!got) {
    got = drawDecal(part, rect)
    decals.set(key, got)
  }
  return got
}

function drawDecal(part: Part, [x0, y0, x1, y1]: [number, number, number, number]): Promise<HTMLImageElement | null> {
  const box = document.createElement('div')
  const w = x1 - x0
  const hgt = y1 - y0
  const k = Math.min(DECAL_PX, 2048 / Math.max(w, hgt))
  render(h('svg', { xmlns: 'http://www.w3.org/2000/svg', width: Math.round(w * k), height: Math.round(hgt * k), viewBox: `${x0} ${y0} ${w} ${hgt}` }, h(PartArt, { part })), box)
  const svg = box.firstElementChild
  if (!svg) return Promise.resolve(null)
  const text = new XMLSerializer().serializeToString(svg)
  render(null, box)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
  })
}

/** The 2D / 3D switch shown over both views. */
export function CircuitViewToggle() {
  const on = circuit3d.value
  return (
    <div class="seg ckt-view-toggle" onPointerDown={(e) => e.stopPropagation()}>
      <button class={on ? '' : 'on'} onClick={() => (circuit3d.value = false)} data-testid="ckt-view-2d" title={t('ckt.view2dHint')}>
        2D
      </button>
      <button class={on ? 'on' : ''} onClick={() => (circuit3d.value = true)} data-testid="ckt-view-3d" title={t('ckt.view3dHint')}>
        3D
      </button>
    </div>
  )
}

/** how far the pointer moves on the table (mm) to push a joystick's stick all the way */
const STICK_REACH = 10
/** pixels of a sideways drag that turn a knob all the way */
const KNOB_PX = 220

type Drag =
  | { kind: 'press'; id: string }
  | { kind: 'stick'; id: string; at: [number, number]; rot: number }
  | { kind: 'knob'; id: string; x: number; k0: number }
  | { kind: 'item'; id: string; at: [number, number]; room: Room; moved: boolean; running: boolean; x: number; y: number }

let sceneRef: CircuitScene | null = null
/** the open 3D scene (for the tests) */
export const circuitScene = () => sceneRef

export function Circuit3D() {
  const host = useRef<HTMLDivElement>(null)
  const scene = useRef<CircuitScene | null>(null)
  const drag = useRef<Drag | null>(null)
  const running = circuitState.value === 'running'
  const c = circuit.value
  const room = running ? (circuitRoom.value ?? roomOf(c)) : roomOf(c)
  const live = {
    running,
    result: circuitResult.value,
    burnt: circuitBurnt.value,
    live: circuitLive.value,
    servos: circuitServos.value,
    knobs: circuitKnobs.value,
    pressed: circuitPressed.value,
    switches: circuitSwitches.value,
    joy: circuitJoy.value
  }

  useEffect(() => {
    const el = host.current!
    const s = new CircuitScene(el, decalOf)
    scene.current = sceneRef = s
    const ro = new ResizeObserver(() => s.resize())
    ro.observe(el)
    const fit = () => {
      const cc = circuit.peek()
      s.fit(cc, circuitState.peek() === 'running' ? (circuitRoom.peek() ?? roomOf(cc)) : roomOf(cc))
    }
    setCircuitFit(fit)
    // parts and things dragged in from the panel land on the table where the pointer is
    const drop = {
      toWorld: (cx: number, cy: number): [number, number] | null => {
        const r = el.getBoundingClientRect()
        if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null
        return s.tableAt(cx, cy)
      },
      center: (): [number, number] => [s.controls.target.x, -s.controls.target.y]
    }
    setDropApi(drop)

    // presses and drags are caught before the camera's controls see them
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      const hit = s.pick(e.clientX, e.clientY)
      const run = circuitState.peek() === 'running'
      const cc = circuit.peek()
      if (hit.item && hit.at) {
        const r = run ? (circuitRoom.peek() ?? roomOf(cc)) : roomOf(cc)
        const it = r.items.find((x) => x.id === hit.item)
        if (!it) return
        e.stopPropagation()
        el.setPointerCapture(e.pointerId)
        if (!run) beginGesture()
        drag.current = { kind: 'item', id: it.id, at: hit.at, room: r, moved: false, running: run, x: e.clientX, y: e.clientY }
        return
      }
      if (!run || !hit.part) return
      const p = cc.parts.find((x) => x.id === hit.part)
      if (p?.kind === 'joystick' && hit.handle === 'stick' && hit.at) {
        e.stopPropagation()
        el.setPointerCapture(e.pointerId)
        drag.current = { kind: 'stick', id: p.id, at: hit.at, rot: p.rot }
      } else if (p?.kind === 'pot') {
        e.stopPropagation()
        el.setPointerCapture(e.pointerId)
        drag.current = { kind: 'knob', id: p.id, x: e.clientX, k0: circuitKnobs.peek()[p.id] ?? p.knob ?? 0.5 }
      } else if (p?.kind === 'button' || p?.kind === 'joystick') {
        e.stopPropagation()
        el.setPointerCapture(e.pointerId)
        pressPart(p.id, true)
        drag.current = { kind: 'press', id: p.id }
      } else if (p?.kind === 'switch') {
        e.stopPropagation()
        flipSwitch(p.id)
      }
    }
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (d?.kind === 'knob') {
        e.stopPropagation()
        setRunKnob(d.id, Math.max(0, Math.min(1, d.k0 + (e.clientX - d.x) / KNOB_PX)))
        return
      }
      if (d?.kind === 'stick') {
        e.stopPropagation()
        const at = s.tableAt(e.clientX, e.clientY)
        if (!at) return
        // the push in the joystick's own frame (it may be turned on the table)
        const a = (-d.rot * Math.PI) / 180
        const wx = at[0] - d.at[0]
        const wy = at[1] - d.at[1]
        let dx = wx * Math.cos(a) - wy * Math.sin(a)
        let dy = wx * Math.sin(a) + wy * Math.cos(a)
        const len = Math.hypot(dx, dy)
        if (len > STICK_REACH) {
          dx *= STICK_REACH / len
          dy *= STICK_REACH / len
        }
        setRunJoy(d.id, 0.5 + dx / (2 * STICK_REACH), 0.5 + dy / (2 * STICK_REACH))
        return
      }
      if (d?.kind !== 'item') {
        if (d) return
        const hit = s.pick(e.clientX, e.clientY)
        const run = circuitState.peek() === 'running'
        const kind = hit.part && run ? circuit.peek().parts.find((x) => x.id === hit.part)?.kind : undefined
        el.style.cursor = hit.item ? 'grab' : kind && HANDLED.has(kind) ? 'pointer' : ''
        return
      }
      e.stopPropagation()
      const at = s.tableAt(e.clientX, e.clientY)
      if (!at) return
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return
      d.moved = true
      const dx = at[0] - d.at[0]
      const dy = at[1] - d.at[1]
      const next = { ...d.room, items: d.room.items.map((it) => (it.id === d.id ? { ...it, x: snapMm(it.x + dx), y: snapMm(it.y + dy) } : it)) }
      if (d.running) setRunRoom(next)
      else previewGesture({ ...doc.peek(), circuit: { ...circuit.peek(), room: next } })
    }
    const up = (e: PointerEvent) => {
      const d = drag.current
      drag.current = null
      if (!d) return
      e.stopPropagation()
      if (d.kind === 'press') return pressPart(d.id, false)
      if (d.kind === 'stick') return setRunJoy(d.id, 0.5, 0.5)
      if (d.kind === 'knob') return
      // a click on a lamp switches it
      const it = d.room.items.find((x) => x.id === d.id)
      const flip = !d.moved && it?.kind === 'lamp' ? { ...d.room, items: d.room.items.map((x) => (x.id === d.id ? { ...x, on: !x.on } : x)) } : null
      if (d.running) {
        if (flip) setRunRoom(flip)
        return
      }
      if (flip) previewGesture({ ...doc.peek(), circuit: { ...circuit.peek(), room: flip } })
      if (flip || d.moved) endGesture()
      else cancelGesture()
    }
    /** the pointer is lost (another window, a touch cancelled): let go of whatever was held */
    const lost = () => {
      const d = drag.current
      drag.current = null
      if (d?.kind === 'press') pressPart(d.id, false)
      else if (d?.kind === 'stick') setRunJoy(d.id, 0.5, 0.5)
      else if (d?.kind === 'item' && !d.running) cancelGesture()
    }
    el.addEventListener('pointerdown', down, true)
    el.addEventListener('pointermove', move, true)
    el.addEventListener('pointerup', up, true)
    el.addEventListener('pointercancel', lost, true)
    el.addEventListener('lostpointercapture', lost, true)
    return () => {
      el.removeEventListener('pointerdown', down, true)
      el.removeEventListener('pointermove', move, true)
      el.removeEventListener('pointerup', up, true)
      el.removeEventListener('pointercancel', lost, true)
      el.removeEventListener('lostpointercapture', lost, true)
      lost()
      if (inGesture()) cancelGesture()
      ro.disconnect()
      dropCircuitFit(fit)
      dropDropApi(drop)
      s.dispose()
      scene.current = sceneRef = null
    }
  }, [])

  useEffect(() => {
    scene.current?.sync(c, room, live)
  })

  // the theme's colours (the scene colour table is updated in place when the theme changes)
  const theme = themeId.value
  useEffect(() => scene.current?.applyTheme(), [theme])

  return (
    <div class={`circuit-view circuit-3d${running ? ' running' : ''}`} data-testid="circuit-3d" onContextMenu={(e) => e.preventDefault()}>
      <div class="ckt-3d-host" ref={host} />
      <CircuitViewToggle />
      <div class="ckt-3d-hint">{t('ckt.hint3d')}</div>
      {c.parts.length === 0 && <div class="empty-hint">{t('ckt.empty3d')}</div>}
    </div>
  )
}
