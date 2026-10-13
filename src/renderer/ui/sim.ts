/**
 * Start / pause / stop of a robotics run. The document is never changed by a run: robots and
 * shapes are shown at their simulated poses through the scene's overrides, and Stop puts
 * everything back where it was.
 */
import { batch, effect } from '@preact/signals'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { type DocNode, isRoboNode, transformMatrix } from '../core/doc/model'
import { doc, editLocked } from '../core/doc/store'
import { circuitState } from '../core/circuit/state'
import { geom } from '../core/geom/client'
import { PHYS_DT, RoboWorld } from '../core/robotics/world'
import { type Quat, bodyQuat } from '../core/robotics/lean'
import { EVENT_KEYS } from '../core/robotics/interpreter'
import { ViewProbe } from '../view/idleProbe'
import { soundPlayer } from '../view/soundPlayer'
import { SceneSync } from '../view/SceneSync'
import type { Physics, ShapeBody } from '../core/robotics/physics'
import { activeBlocks, sensorValues, simSpeed, simState, simTime } from '../core/robotics/state'
import { type Key, t } from '../i18n'
import { SURFACE_KINDS } from '../core/robotics/surface'
import type { Viewport } from '../view/Viewport'
import { notify, viewport } from './actions'

interface Run {
  world: RoboWorld
  physics: Physics | null
  /** document transform of every shape in the physics, to put the motion in front of */
  base: Map<string, Matrix4>
  acc: number
  last: number
  raf: number
  uiAt: number
}

let run: Run | null = null
/** bumped by Stop: a Start still loading meshes must not go on */
let startId = 0

effect(() => {
  editLocked.value = simState.value !== 'idle' || circuitState.value !== 'idle'
})

export async function startSim(): Promise<void> {
  const vp = viewport()
  if (!vp) return
  if (run && simState.peek() === 'paused') {
    run.last = performance.now()
    simState.value = 'running'
    soundPlayer.resume()
    loop()
    return
  }
  if (run) return
  const id = ++startId
  const d = doc.peek()
  RoboWorld.waterSay = t('robo.waterSay')
  RoboWorld.surfaceWords = Object.fromEntries(SURFACE_KINDS.map((k) => [k, t(`surf.${k}` as Key)]))
  const world = RoboWorld.fromDoc(d)
  world.sounds = soundPlayer
  if (world.seals.length) soundPlayer.preload()
  if (world.programs().length === 0 && !d.nodes.some((n) => !isRoboNode(n) && !n.isHole)) {
    notify(t('robo.nothingToRun'), 'error')
    return
  }
  simState.value = 'running'
  // physics for the shapes: their meshes in world space and their weights
  let physics: Physics | null = null
  const base = new Map<string, Matrix4>()
  try {
    const shapes: ShapeBody[] = []
    const nodes = d.nodes.filter((n) => !isRoboNode(n) && !n.isHole)
    const [mod] = await Promise.all([import('../core/robotics/physics'), ...nodes.map((n) => geom.request(n))])
    for (const n of nodes) {
      const res = await geom.request(n)
      const m = transformMatrix(n.transform)
      base.set(n.id, m)
      shapes.push({ id: n.id, points: worldPoints(res.positions, m), mass: massOf(n, res.volume), glow: n.material === 'glow' })
    }
    await mod.initPhysics()
    if (id !== startId) return
    physics = new mod.Physics(shapes, world.robots, world.seals, world.terrain)
    const ph = physics
    world.probe = ph
    world.shapes = () => ph.shapes()
    world.refresh()
  } catch (e) {
    console.error(e)
    if (id !== startId) return
    notify(t('robo.physicsFailed'), 'error')
  }
  if (world.robots.some((r) => r.program && r.program.hatCount === 0)) notify(t('robo.noStartBlock'))
  if (vp.sync.tooManyLights) notify(t('robo.tooManyLights', { n: SceneSync.MAX_LIGHTS }))
  run = { world, physics, base, acc: 0, last: performance.now(), raf: 0, uiAt: 0 }
  vp.onSimClick = simClick
  loop()
}

/** default weight: the shape's volume in PLA plastic */
export function massOf(n: DocNode, volume: number): number {
  if (n.mass && n.mass > 0) return n.mass
  const s = n.transform.scale
  return Math.max(0.5, Math.abs(volume * s[0] * s[1] * s[2]) * 1.24e-3)
}

function worldPoints(pos: Float32Array, m: Matrix4): Float32Array {
  const out = new Float32Array(pos.length)
  const v = new Vector3()
  for (let i = 0; i < pos.length; i += 3) {
    v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(m)
    out[i] = v.x
    out[i + 1] = v.y
    out[i + 2] = v.z
  }
  return out
}

function loop(): void {
  if (!run) return
  run.raf = requestAnimationFrame(frame)
}

function frame(now: number): void {
  const r = run
  const vp = viewport()
  if (!r || !vp || simState.peek() !== 'running') return
  const dt = Math.min(0.1, Math.max(0, (now - r.last) / 1000))
  r.last = now
  r.acc += dt * simSpeed.peek()
  let n = 0
  while (r.acc >= PHYS_DT && n < 100) {
    r.world.step()
    r.physics?.step(PHYS_DT, r.world.robots, r.world.seals)
    r.acc -= PHYS_DT
    n++
  }
  if (n === 100) r.acc = 0
  vp.sync.animate(n * PHYS_DT)
  show(r, vp)
  if (now - r.uiAt > 100) {
    r.uiAt = now
    publish(r)
  }
  loop()
}


function show(r: Run, vp: Viewport): void {
  for (const rb of r.world.robots) {
    const q = bodyQuat(rb.pose.theta, rb.pitch, rb.roll)
    const m = new Matrix4().compose(new Vector3(rb.pose.x, rb.pose.y, rb.z), new Quaternion(q.x, q.y, q.z, q.w), new Vector3(1, 1, 1))
    vp.sync.setOverride(rb.id, m)
    vp.sync.setLook(rb.id, { flash: [...rb.flash].map(([port, f]) => [port, f.on ? f.brightness : 0] as [number, number]) })
  }
  for (const { seal } of r.world.seals) {
    vp.sync.setOverride(
      seal.id,
      new Matrix4().compose(new Vector3(seal.x, seal.y, seal.z), quat(bodyQuat(seal.theta, seal.pitch, seal.roll)), new Vector3(1, 1, 1))
    )
    vp.sync.setLook(seal.id, {
      seal: { color: seal.color, visible: seal.visible, size: seal.size, say: seal.say, anim: seal.anim, lift: seal.lift }
    })
  }
  for (const l of r.world.lights) vp.sync.setLook(l.id, { lamp: { on: l.on, brightness: l.brightness, color: l.color } })
  if (r.physics) {
    for (const [id, delta] of r.physics.deltas()) {
      const b = r.base.get(id)
      if (b) vp.sync.setOverride(id, delta.multiply(b))
    }
  }
  vp.invalidate()
}

function publish(r: Run): void {
  const values: Record<string, Record<number, number>> = {}
  const active: Record<string, string[]> = {}
  for (const rb of r.world.robots) values[rb.id] = Object.fromEntries(rb.readings)
  for (const p of r.world.programs()) active[p.id] = p.program.active()
  batch(() => {
    sensorValues.value = values
    activeBlocks.value = active
    simTime.value = r.world.time
  })
}

export function pauseSim(): void {
  if (simState.peek() !== 'running' || !run) return
  cancelAnimationFrame(run.raf)
  simState.value = 'paused'
  soundPlayer.pause()
  publish(run)
}

/** Stop and put everything back where the document has it. */
export function stopSim(): void {
  startId++
  soundPlayer.end()
  if (run) {
    cancelAnimationFrame(run.raf)
    run.physics?.dispose()
    run = null
  }
  if (simState.peek() === 'idle') return
  batch(() => {
    simState.value = 'idle'
    activeBlocks.value = {}
    simTime.value = 0
  })
  viewport()?.sync.clearOverrides()
}

/**
 * A key pressed while a run is on: "when key pressed" blocks. Returns true when some key block
 * could use it (the arrows and letters, not Space or Esc).
 */
export function simKey(e: KeyboardEvent): boolean {
  if (!run || simState.peek() !== 'running' || e.ctrlKey || e.metaKey || e.altKey) return false
  let key = e.key.length === 1 ? e.key.toUpperCase() : e.key
  // letters by the physical key, so a Russian layout works too
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5)
  if (!EVENT_KEYS.includes(key)) return false
  return run.world.pressKey(key)
}

/** An object was clicked during a run: "when clicked" blocks. */
export function simClick(id: string): void {
  if (run && simState.peek() === 'running') run.world.click(id)
}

/** Live sensor values while nothing runs: where the robots stand now. */
export function idleReadings(): void {
  if (simState.peek() !== 'idle') return
  const d = doc.peek()
  const w = RoboWorld.fromDoc(d)
  // this also runs while the modules are still loading (the first effect run): no view yet then
  let vp: Viewport | null = null
  try {
    vp = viewport()
  } catch {
    vp = null
  }
  if (vp && w.robots.some((r) => r.sensors.some((s) => s.type === 'ultrasonic' || s.type === 'touch' || s.type === 'light'))) {
    const probe = new ViewProbe(vp.sync, d)
    w.probe = probe
    w.shapes = () => probe.shapes()
    w.refresh()
  }
  const values: Record<string, Record<number, number>> = {}
  for (const rb of w.robots) values[rb.id] = Object.fromEntries(rb.readings)
  sensorValues.value = values
}

// keep the idle readings current when robots or tiles move (after the view has caught up)
let idleTimer = 0
effect(() => {
  void doc.value
  if (simState.value !== 'idle') return
  idleReadings()
  window.clearTimeout(idleTimer)
  idleTimer = window.setTimeout(idleReadings, 350)
})


const quat = (q: Quat) => new Quaternion(q.x, q.y, q.z, q.w)
