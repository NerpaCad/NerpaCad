/**
 * What the characters look like: the seal, the cheetah Читик and the pigeon Геннадий. The models
 * were made in Tripo (tripo3d.ai) and rigged and animated in Blender by the scripts in
 * scripts/heroes/: each has its own clips for every motion (see CLIPS). Each visual is a clone with
 * its own skeleton, materials and animation mixer, with a speech bubble over it.
 *
 * - The models keep their painted textures; a hero's colour tints them (its default colour leaves
 *   them as they are).
 * - The pigeon's wings for flying are feathers of their own, hidden (scaled to nothing) on the
 *   ground; its clips open, beat and fold them. While they are out, the folded wings of its body
 *   are pressed in (the shape key `WingsIn`) and painted over (pigeon-fly.jpg).
 * - Changing from one motion to another blends over a quarter of a second.
 *
 * Model credits: models/*-LICENSE.txt next to the files (CC BY 4.0).
 */
import {
  type AnimationAction,
  Color,
  LoopOnce,
  type AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type Material,
  SkinnedMesh,
  SRGBColorSpace,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Texture,
  TextureLoader,
  Vector3
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { Species } from '../core/doc/model'
import { PROFILES } from '../core/robotics/creatures'
import type { NerpaAnim } from '../core/robotics/nerpa'
import { bubbleTexture, keepTree, loadPlaced, noPick } from './roboVisuals'
import { HEROES, type HeroSpec, heroSpec } from '../core/robotics/mods'
import sealUrl from '../assets/robots/seal.glb?url'
import cheetahUrl from '../assets/robots/cheetah.glb?url'
import pigeonUrl from '../assets/robots/pigeon.glb?url'
import pigeonFlyUrl from '../assets/robots/pigeon-fly.jpg?url'

const X = new Vector3(1, 0, 0)
const Y = new Vector3(0, 1, 0)
const Z = new Vector3(0, 0, 1)

interface Template {
  scene: Object3D
  clips: AnimationClip[]
}

const templates: Partial<Record<Species, Template | null>> = {}
/** the pigeon's body painted without its folded wings (shown while it flies) */
let pigeonFly: Texture | null = null
/** heroes of mods by id: their models once loaded (null: the files could not be loaded) */
const heroTemplates = new Map<string, Template | null>()
const heroLoading = new Map<string, Promise<void>>()

/** Load a mod hero's model (once): fitted to the length of the hero it moves like, standing on z = 0. */
function loadHero(h: HeroSpec): Promise<void> {
  let p = heroLoading.get(h.id)
  if (!p) {
    p = (async () => {
      try {
        const placed = await loadPlaced(h.model)
        const clips = (placed.userData.clips as AnimationClip[] | undefined) ?? []
        const scene = frameModel(placed, new Matrix4(), PROFILES[h.like].length)
        keepTree(scene)
        heroTemplates.set(h.id, { scene, clips })
      } catch (e) {
        console.error(`mod ${h.mod}: hero ${h.id}`, e)
        heroTemplates.set(h.id, null)
      }
    })()
    heroLoading.set(h.id, p)
  }
  return p
}

/** the clips a mod hero's model plays when its mod.json does not say: by their usual names */
const HERO_CLIPS: Partial<Record<NerpaAnim, RegExp>> = { idle: /idle|stand/i, walk: /walk/i, run: /run/i, swim: /swim/i, fly: /fly|flap/i, leap: /jump|leap/i }
let loading: Promise<void> | null = null
let loaded = false

/** World box of the skinned meshes as they are posed now. */
function skinnedBox(root: Object3D): Box3 {
  root.updateMatrixWorld(true)
  const box = new Box3()
  root.traverse((c) => {
    if (c instanceof SkinnedMesh) {
      c.skeleton.update()
      c.computeBoundingBox()
      box.union(c.boundingBox!.clone().applyMatrix4(c.matrixWorld))
    } else if (c instanceof Mesh) {
      c.geometry.computeBoundingBox()
      box.union(c.geometry.boundingBox!.clone().applyMatrix4(c.matrixWorld))
    }
  })
  return box
}

/**
 * Put a model into a character's frame: mm, X forward, Z up, feet on the ground under its middle,
 * `length` long (and, given `height`, no taller than that: the hero's box). `basis` turns the
 * model's axes into ours.
 */
function frameModel(scene: Object3D, basis: Matrix4, length: number, height?: number): Group {
  const inner = new Group()
  inner.name = 'creature-pose'
  inner.add(scene)
  inner.applyMatrix4(basis)
  const root = new Group()
  root.add(inner)
  let box = skinnedBox(root)
  let k = length / Math.max(1e-6, box.max.x - box.min.x)
  if (height) k = Math.min(k, height / Math.max(1e-6, box.max.z - box.min.z))
  inner.scale.multiplyScalar(k)
  box = skinnedBox(root)
  inner.position.set(inner.position.x - (box.min.x + box.max.x) / 2, inner.position.y - (box.min.y + box.max.y) / 2, inner.position.z - box.min.z)
  root.updateMatrixWorld(true)
  return root
}

async function load(url: string): Promise<Template | null> {
  try {
    const g = await new GLTFLoader().loadAsync(url)
    return { scene: g.scene, clips: g.animations }
  } catch (e) {
    console.error('character model', url, e)
    return null
  }
}

/** Load the three models (once). */
export function loadCreatures(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      const [seal, cheetah, pigeon] = await Promise.all([load(sealUrl), load(cheetahUrl), load(pigeonUrl)])
      try {
        pigeonFly = await new TextureLoader().loadAsync(pigeonFlyUrl)
        pigeonFly.flipY = false // as glTF's own textures
        pigeonFly.colorSpace = SRGBColorSpace
      } catch (e) {
        console.error('pigeon texture', e)
      }
      // glTF: Y up, the heroes face +Z; measured as they stand (the first frame of their idle:
      // the pigeon's bind pose has its flying wings out)
      for (const [species, t] of [['seal', seal], ['cheetah', cheetah], ['pigeon', pigeon]] as const) {
        if (!t) continue
        const mixer = new AnimationMixer(t.scene)
        const idle = t.clips.find((c) => /^idle$/i.test(c.name))
        if (idle) {
          mixer.clipAction(idle).play()
          mixer.update(0)
        }
        const p = PROFILES[species]
        templates[species] = { scene: frameModel(t.scene, new Matrix4().makeBasis(Y, Z, X), p.length, p.height), clips: t.clips }
        mixer.stopAllAction()
      }
      for (const t of Object.values(templates)) if (t) keepTree(t.scene)
      await Promise.all(Object.values(HEROES).map((h) => loadHero(h)))
      loaded = true
    })()
    loading.catch((e) => console.error('character models', e))
  }
  return loading
}

export const creaturesReady = () => loaded

// ---------------------------------------------------------------- visuals

export interface SealLook {
  color: string
  visible: boolean
  size: number
  say: string | null
  anim: NerpaAnim
  lift: number
  /** nothing runs: stand still in the first frame of the idle pose (no half-finished stride) */
  rest?: boolean
}

/** which clip plays for each animation state (missing: a procedural pose, see `animateCreature`) */
const CLIPS: Record<Species, Partial<Record<NerpaAnim, RegExp>>> = {
  seal: { idle: /^idle$/i, walk: /^walk$/i, run: /^walk$/i, leap: /^walk$/i, swim: /^swim$/i },
  cheetah: { idle: /^idle$/i, walk: /^walk$/i, run: /^run$/i, leap: /^leap$/i, fall: /^fall$/i, crouch: /^crouch$/i, crawl: /^crawl$/i },
  pigeon: { idle: /^idle$/i, walk: /^walk$/i, fly: /^flapping$/i, takeoff: /^takeoff$/i, land: /^gliding$/i, touchdown: /^landing$/i, fall: /^gliding$/i }
}

interface State {
  species: Species
  /** a mod's hero: its clips only */
  generic: boolean
  mixer: AnimationMixer | null
  actions: Partial<Record<NerpaAnim, AnimationAction>>
  anim: NerpaAnim
  /** the pigeon: how far its folded wings are pressed in (0 on the ground, 1 flying) */
  wingsIn: number
  wingMeshes: { mesh: Mesh; index: number }[]
  /** its painted materials with their ground map and the flying one */
  maps: { mat: MeshStandardMaterial; ground: Texture | null; fly: Texture }[]
}

/** motions in which the pigeon's feather wings are out */
const WINGS_OUT: ReadonlySet<NerpaAnim> = new Set(['fly', 'takeoff', 'land', 'touchdown', 'fall'])

/** seconds over which one motion turns into the next */
const BLEND = 0.25
/** Clips played once (and how fast): the takeoff opens the wings into flight, the touchdown folds them. */
const ONCE: Partial<Record<NerpaAnim, { from: number; speed: number }>> = {
  takeoff: { from: 0, speed: 1 },
  touchdown: { from: 0, speed: 1 }
}

/**
 * A character's visual (null while the models load). `hero`: a hero of a mod (it moves like
 * `species`); while its mod is missing or its files are broken it looks like `species`.
 */
export function creatureModel(species: Species, color: string, hero?: string): Object3D | null {
  if (!loaded) return null
  const h = heroSpec(hero)
  if (h && !heroTemplates.has(h.id)) {
    void loadHero(h)
    return null
  }
  const own = h ? (heroTemplates.get(h.id) ?? null) : null
  // a model that failed to load: a plain egg instead
  const tpl = own ?? templates[species] ?? null
  const p = PROFILES[species]
  const g = new Group()
  g.name = 'seal-visual'
  const holder = new Group()
  g.add(holder)
  let body: MeshStandardMaterial | undefined
  const st: State = { species, generic: !!own, mixer: null, actions: {}, anim: 'idle', wingsIn: 0, wingMeshes: [], maps: [] }
  let paint: Paint | undefined
  if (tpl) {
    const m = cloneSkinned(tpl.scene)
    if (own) {
      // the mod's own colours; the parts it names (`tint`) in the hero's colour
      const tint = h!.tint ? new RegExp(h!.tint, 'i') : null
      if (tint) body = new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 })
      m.traverse((o) => {
        if (!(o instanceof Mesh)) return
        if (tint && body && tint.test(o.name)) o.material = body
        o.frustumCulled = false
        o.castShadow = true
      })
    } else {
      // its own painted materials (copies: each hero is tinted on its own)
      const mats = new Map<Material, MeshStandardMaterial>()
      m.traverse((o) => {
        if (!(o instanceof Mesh)) return
        const src = o.material as MeshStandardMaterial
        let own = mats.get(src)
        if (!own) {
          own = src.clone()
          own.metalness = 0
          mats.set(src, own)
        }
        o.material = own
        o.frustumCulled = false
        o.castShadow = true
      })
      paint = { mats: [...mats.values()].map((mat) => ({ mat, base: mat.color.clone() })), plain: new Color(PROFILES[species].color) }
      if (species === 'pigeon') {
        m.traverse((o) => {
          const i = (o as Mesh).morphTargetDictionary?.WingsIn
          if (o instanceof Mesh && i !== undefined) st.wingMeshes.push({ mesh: o, index: i })
        })
        if (pigeonFly) for (const mat of mats.values()) if (mat.map) st.maps.push({ mat, ground: mat.map, fly: pigeonFly })
      }
    }
    st.mixer = new AnimationMixer(m)
    const clipRules: Partial<Record<NerpaAnim, RegExp>> = own
      ? { ...HERO_CLIPS, ...Object.fromEntries(Object.entries(h!.clips).map(([k, v]) => [k, new RegExp(v as string, 'i')])) }
      : CLIPS[species]
    for (const [anim, re] of Object.entries(clipRules) as [NerpaAnim, RegExp][]) {
      const clip = tpl.clips.find((c) => re.test(c.name.replace(/^.*\|/, '')))
      if (!clip) continue
      const a = st.mixer.clipAction(clip)
      if (ONCE[anim]) {
        a.setLoop(LoopOnce, 1)
        a.clampWhenFinished = true
      }
      st.actions[anim] = a
    }
    st.actions.idle?.play()
    st.mixer.update(0)
    holder.add(m)
  } else {
    // no model file: a simple rounded body
    body = new MeshStandardMaterial({ color, roughness: 0.6 })
    const e = new Mesh(new SphereGeometry(1, 24, 16), body)
    e.scale.set(p.length / 2, p.width / 2, p.height / 2)
    e.position.z = p.height / 2
    holder.add(e)
  }
  g.userData.body = body
  g.userData.paint = paint
  g.userData.state = st
  const bubble = new Sprite(new SpriteMaterial({ transparent: true, depthTest: false, sizeAttenuation: false }))
  bubble.visible = false
  bubble.renderOrder = 999
  bubble.center.set(0.15, 0)
  g.add(bubble)
  g.userData.bubble = bubble
  g.userData.say = null
  noPick(g)
  setCreatureLook(g, { color, visible: true, size: 100, say: null, anim: 'idle', lift: 0, rest: true })
  return g
}

/** A hero's painted materials and the colour that leaves them as painted. */
interface Paint {
  mats: { mat: MeshStandardMaterial; base: Color }[]
  plain: Color
}

const tint = new Color()
/** Tint the painted materials: the hero's colour over its default colour, channel by channel. */
function setPaint(paint: Paint, color: string): void {
  tint.set(color)
  const r = Math.min(2, tint.r / Math.max(0.02, paint.plain.r))
  const g = Math.min(2, tint.g / Math.max(0.02, paint.plain.g))
  const b = Math.min(2, tint.b / Math.max(0.02, paint.plain.b))
  for (const { mat, base } of paint.mats) mat.color.setRGB(base.r * r, base.g * g, base.b * b)
}

/** Put a character's look (colour, size, bubble, animation, hop) on its model. */
export function setCreatureLook(g: Object3D, look: SealLook): void {
  const st = g.userData.state as State
  const p = PROFILES[st.species]
  ;(g.userData.body as MeshStandardMaterial | undefined)?.color.set(look.color)
  if (g.userData.paint) setPaint(g.userData.paint as Paint, look.color)
  g.visible = look.visible
  const k = Math.max(0.1, look.size / 100)
  const holder = g.children[0]
  holder.scale.setScalar(k)
  holder.position.z = look.lift
  const bubble = g.userData.bubble as Sprite
  bubble.position.set(p.length * 0.35 * k, 0, p.height * 1.25 * k + look.lift)
  if (look.say !== g.userData.say) {
    g.userData.say = look.say
    if (look.say) {
      const { texture, w, h } = bubbleTexture(look.say)
      const m = bubble.material as SpriteMaterial
      m.map?.dispose()
      m.map = texture
      m.needsUpdate = true
      // a fixed size on screen (the sprite does not shrink with distance)
      bubble.scale.set(w / 1400, h / 1400, 1)
      bubble.visible = true
    } else bubble.visible = false
  }
  if (!st.mixer) return
  const want: NerpaAnim = look.rest ? 'idle' : look.anim
  if (look.rest) {
    st.mixer.stopAllAction()
    st.actions.idle?.reset().play()
    st.anim = 'idle'
    animateCreature(g, 0)
  } else if (st.anim !== want) {
    switchTo(st, want)
    st.anim = want
    animateCreature(g, 0)
  }
}

/** Fade the clip of `want` in and every other playing clip out (the same clip just goes on). */
function switchTo(st: State, want: NerpaAnim): void {
  const fade = BLEND
  const to = st.actions[want] ?? st.actions.idle
  const once = ONCE[want]
  if (to && (once || !to.isRunning() || to.getEffectiveWeight() < 0.99)) {
    to.reset()
    to.setEffectiveTimeScale(once?.speed ?? 1)
    if (once) to.time = once.from * to.getClip().duration
    to.setEffectiveWeight(1)
    to.play()
    if (fade) to.fadeIn(fade)
  }
  for (const a of new Set(Object.values(st.actions))) {
    if (!a || a === to || !a.isRunning()) continue
    if (fade) a.fadeOut(fade)
    else a.stop()
  }
}

/** Move a character's animation on by `dt` seconds. */
export function animateCreature(g: Object3D, dt: number): void {
  const st = g.userData.state as State | undefined
  if (!st?.mixer) return
  st.mixer.update(dt)
  if (st.wingMeshes.length || st.maps.length) wingsIn(st, dt)
  // the takeoff clip is over but it still climbs: on into flapping
  const tk = st.actions.takeoff
  if (st.anim === 'takeoff' && tk && !tk.isRunning() && st.actions.fly && !st.actions.fly.isRunning()) {
    st.actions.fly.reset().play()
    st.actions.fly.crossFadeFrom(tk, BLEND, false)
  }
}

/** The pigeon's folded wings go in as its feather wings come out (and back on landing). */
function wingsIn(st: State, dt: number): void {
  const want = WINGS_OUT.has(st.anim) ? 1 : 0
  st.wingsIn = dt <= 0 ? want : st.wingsIn + Math.sign(want - st.wingsIn) * Math.min(Math.abs(want - st.wingsIn), dt / 0.3)
  for (const { mesh, index } of st.wingMeshes) if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = st.wingsIn
  const fly = st.wingsIn > 0.5
  for (const m of st.maps) {
    const map = fly ? m.fly : m.ground
    if (m.mat.map !== map) {
      m.mat.map = map
      m.mat.needsUpdate = true
    }
  }
}
