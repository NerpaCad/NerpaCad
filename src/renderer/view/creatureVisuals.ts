/**
 * What the characters look like: the animated seal (glTF, clips Idle / Shuffle / Swim), the
 * cheetah Читик and the pigeon Геннадий. Each visual is a clone with its own skeleton, material
 * and animation mixer, with a speech bubble over it.
 *
 * - The cheetah is a low-poly cat (one clip: run) made into a cheetah here: a coat drawn by a
 *   shader in the model's own coordinates (golden back, pale belly, spots, tear lines from the
 *   eyes, rings and a white tip on the tail), longer thinner legs and a smaller head by bone
 *   scales, a standing pose set by aiming the leg bones straight down. Walking is the run slowed
 *   down and pulled half way back to standing; a jump is a stretched frame of the run.
 * - The pigeon has clips for idle, flapping, gliding, takeoff and landing; walking is its idle
 *   with little hops.
 * - Changing from one motion to another blends over a quarter of a second (clips by the mixer's
 *   weights, the cheetah's procedural poses from a snapshot of the pose before).
 *
 * Model credits: models/*-LICENSE.txt next to the files (CC BY 4.0).
 */
import {
  type AnimationAction,
  BufferAttribute,
  LoopOnce,
  type AnimationClip,
  AnimationMixer,
  Box3,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Quaternion,
  SkinnedMesh,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { Species } from '../core/doc/model'
import { PROFILES } from '../core/robotics/creatures'
import type { NerpaAnim } from '../core/robotics/nerpa'
import { bubbleTexture, keepTree, noPick } from './roboVisuals'
import sealUrl from '../assets/robots/seal.glb?url'
import cheetahUrl from '../assets/robots/cheetah.glb?url'
import pigeonUrl from '../assets/robots/pigeon.glb?url'

const X = new Vector3(1, 0, 0)
const Y = new Vector3(0, 1, 0)
const Z = new Vector3(0, 0, 1)
const NEG_Y = new Vector3(0, -1, 0)

interface Template {
  scene: Object3D
  clips: AnimationClip[]
  /** the cheetah's crouch: every bone's pose by name, and how much lower the body goes, mm */
  crouch?: { pose: Map<string, { q: Quaternion; p: Vector3 }>; drop: number }
}

const templates: Partial<Record<Species, Template | null>> = {}
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
 * `length` long. `basis` turns the model's axes into ours.
 */
function frameModel(scene: Object3D, basis: Matrix4, length: number): Group {
  const inner = new Group()
  inner.name = 'creature-pose'
  inner.add(scene)
  inner.applyMatrix4(basis)
  const root = new Group()
  root.add(inner)
  let box = skinnedBox(root)
  const k = length / Math.max(1e-6, box.max.x - box.min.x)
  inner.scale.multiplyScalar(k)
  box = skinnedBox(root)
  inner.position.set(inner.position.x - (box.min.x + box.max.x) / 2, inner.position.y - (box.min.y + box.max.y) / 2, inner.position.z - box.min.z)
  root.updateMatrixWorld(true)
  return root
}

const bone = (root: Object3D, prefix: string): Object3D | null => {
  let found: Object3D | null = null
  root.traverse((c) => {
    if (!found && (c as { isBone?: boolean }).isBone && c.name.startsWith(prefix)) found = c
  })
  return found
}

/** Aim a chain of bones along world directions (the model's own axes: x forward, y up). */
function aim(root: Object3D, chain: string[], dirs: [number, number, number][]): void {
  for (let i = 0; i < chain.length - 1; i++) {
    const b = bone(root, chain[i])
    const c = bone(root, chain[i + 1])
    if (!b || !c || !b.parent) continue
    root.updateMatrixWorld(true)
    const cur = c.getWorldPosition(new Vector3()).sub(b.getWorldPosition(new Vector3())).normalize()
    const want = new Vector3(...dirs[i]).normalize()
    const q = new Quaternion().setFromUnitVectors(cur, want)
    const wq = b.getWorldQuaternion(new Quaternion())
    const pq = b.parent.getWorldQuaternion(new Quaternion())
    b.quaternion.copy(pq.invert().multiply(q).multiply(wq))
  }
}

/** The cat stands: legs straight down, the tail hanging, the head up (its own pose is mid-run). */
function catStand(root: Object3D): void {
  for (const side of ['right', 'left']) {
    const f = `leg_front_${side}_`
    const b = `leg_back_${side}_`
    aim(root, [f + '1', f + '2', f + '3', f + '4', f + '4_end'], [[0.05, -1, 0], [0, -1, 0], [0.02, -1, 0], [1, -0.25, 0]])
    aim(root, [b + '1', b + '2', b + '3', b + '4', b + '4_end'], [[0.35, -1, 0], [-0.45, -1, 0], [0.08, -1, 0], [1, -0.25, 0]])
  }
  aim(root, ['neck', 'head'], [[1, 0.6, 0]])
  aim(root, ['tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_4_end'], [[-1, -0.9, 0], [-0.6, -1, 0], [-0.4, -0.6, 0], [-0.3, 0.6, 0]])
  root.updateMatrixWorld(true)
}

/** The cat crouches to crawl: knees bent, head low and forward, the tail straight back. */
function catCrouch(root: Object3D): void {
  for (const side of ['right', 'left']) {
    const f = `leg_front_${side}_`
    const b = `leg_back_${side}_`
    aim(root, [f + '1', f + '2', f + '3', f + '4', f + '4_end'], [[-1, -0.6, 0], [1, -0.55, 0], [0.35, -1, 0], [1, -0.15, 0]])
    aim(root, [b + '1', b + '2', b + '3', b + '4', b + '4_end'], [[1, -0.35, 0], [-1, -0.35, 0], [0.5, -1, 0], [1, -0.15, 0]])
  }
  aim(root, ['neck', 'head'], [[1, 0, 0]])
  aim(root, ['tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_4_end'], [[-1, -0.1, 0], [-1, 0, 0], [-1, 0, 0], [-1, 0.1, 0]])
  root.updateMatrixWorld(true)
}

/** The lowest foot of the cat (world z of its paw tips). */
function lowestPaw(root: Object3D): number {
  root.updateMatrixWorld(true)
  let low = Infinity
  root.traverse((o) => {
    if ((o as { isBone?: boolean }).isBone && /^leg_.*_4_end/.test(o.name)) low = Math.min(low, o.getWorldPosition(new Vector3()).z)
  })
  return Number.isFinite(low) ? low : 0
}

/**
 * Cheetah proportions from the cat: long thin legs, a slim body, a small head, a long thin tail.
 * Stretching a bone unevenly would skew everything hanging from it once it turns, so each chain
 * is only scaled evenly at its first bone (thinner) and made longer by moving the bones below it
 * further out along it.
 */
const CAT_BODY = 0.88
const CAT_CHAINS: { bones: string[]; scale: number; length: number }[] = [
  { bones: ['body_1', 'body_2', 'neck'], scale: CAT_BODY, length: 1.08 },
  ...['right', 'left'].flatMap((side) => [
    { bones: ['1', '2', '3', '4', '4_end'].map((k) => `leg_front_${side}_${k}`), scale: 0.82, length: 1.3 / CAT_BODY },
    { bones: ['1', '2', '3', '4', '4_end'].map((k) => `leg_back_${side}_${k}`), scale: 0.82, length: 1.3 }
  ]),
  { bones: ['tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_4_end'], scale: 0.75, length: 1.35 },
  // the head: smaller, whatever the body did to it
  { bones: ['head'], scale: 0.8 / CAT_BODY, length: 1 }
]

/** how much further out each moved bone sits, by bone name prefix */
const CAT_STRETCH = new Map(CAT_CHAINS.flatMap((c) => c.bones.slice(1).map((b) => [b, c.length / c.scale] as [string, number])))

function catProportions(root: Object3D): void {
  for (const c of CAT_CHAINS) {
    bone(root, c.bones[0])?.scale.multiplyScalar(c.scale)
    for (const name of c.bones.slice(1)) bone(root, name)?.position.multiplyScalar(c.length / c.scale)
  }
  root.updateMatrixWorld(true)
}

type BonePose = { p: Vector3; q: Quaternion; s: Vector3 }
/** Every bone's local pose now. */
function poseOf(root: Object3D): Map<Object3D, BonePose> {
  const m = new Map<Object3D, BonePose>()
  root.traverse((o) => {
    if ((o as { isBone?: boolean }).isBone) m.set(o, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() })
  })
  return m
}
function setPose(pose: Map<Object3D, BonePose>): void {
  for (const [b, v] of pose) {
    b.position.copy(v.p)
    b.quaternion.copy(v.q)
    b.scale.copy(v.s)
  }
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
      // glTF from Sketchfab: Y up; the seal and the pigeon face +Z, the cat faces +X
      if (seal) templates.seal = { scene: frameModel(seal.scene, new Matrix4().makeBasis(Y, Z, X), PROFILES.seal.length), clips: seal.clips }
      if (cheetah) {
        catProportions(cheetah.scene)
        // the run clip keys some bone positions at the cat's lengths: stretched the same way
        for (const [name, f] of CAT_STRETCH) {
          const b = bone(cheetah.scene, name)
          if (!b) continue
          for (const clip of cheetah.clips)
            for (const t of clip.tracks) if (t.name === `${b.name}.position`) for (let i = 0; i < t.values.length; i++) t.values[i] *= f
        }
        catStand(cheetah.scene)
        coatPositions(cheetah.scene)
        const stand = poseOf(cheetah.scene)
        catCrouch(cheetah.scene)
        const crouch = poseOf(cheetah.scene)
        setPose(stand)
        const framed = frameModel(cheetah.scene, new Matrix4().makeBasis(X, Z, NEG_Y), PROFILES.cheetah.length)
        // how much lower its body goes crouched: its paws come up that much, so it is let down
        setPose(crouch)
        const up = lowestPaw(framed)
        setPose(stand)
        const drop = Math.max(0, up - lowestPaw(framed))
        const byName = new Map([...crouch].map(([b, v]) => [b.name, { q: v.q, p: v.p }]))
        templates.cheetah = { scene: framed, clips: cheetah.clips, crouch: { pose: byName, drop } }
      }
      if (pigeon) {
        // measured standing (its bind pose has the wings out), then back to the bind pose: the
        // clips do not all move the same bones, and a bone one clip leaves alone must be at rest
        const rest = poseOf(pigeon.scene)
        const mixer = new AnimationMixer(pigeon.scene)
        const idle = pigeon.clips.find((c) => /idle/i.test(c.name))
        if (idle) {
          mixer.clipAction(idle).play()
          mixer.update(0)
        }
        templates.pigeon = { scene: frameModel(pigeon.scene, new Matrix4().makeBasis(Y, Z, X), PROFILES.pigeon.length), clips: pigeon.clips }
        mixer.stopAllAction()
        setPose(rest)
      }
      for (const t of Object.values(templates)) if (t) keepTree(t.scene)
      loaded = true
    })()
    loading.catch((e) => console.error('character models', e))
  }
  return loading
}

export const creaturesReady = () => loaded

// ---------------------------------------------------------------- the cheetah's coat

/**
 * Where each vertex is on the finished cheetah (longer legs, standing): spots are drawn at these
 * points, so they stay round on the stretched legs and still stick to the skin as it moves.
 */
function coatPositions(root: Object3D): void {
  root.updateMatrixWorld(true)
  const v = new Vector3()
  root.traverse((o) => {
    if (!(o instanceof SkinnedMesh)) return
    const pos = o.geometry.getAttribute('position')
    const out = new Float32Array(pos.count * 3)
    o.skeleton.update()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      o.applyBoneTransform(i, v)
      v.toArray(out, i * 3)
    }
    o.geometry.setAttribute('coat', new BufferAttribute(out, 3))
  })
}

/** The cheetah's coat: `color` is the golden back; spots, belly and face marks are drawn over it. */
function coatMaterial(color: string): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, flatShading: true })
  m.customProgramCacheKey = () => 'cheetah-coat'
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 coat;\nvarying vec3 vObj;\nvarying vec3 vObjN;\nvarying vec3 vCoat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;\nvObjN = normal;\nvCoat = coat;')
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vObj;
varying vec3 vObjN;
varying vec3 vCoat;
vec3 coatHash(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
float coatCells(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d = 9.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = coatHash(i + g) * 0.7 + 0.15;
    d = min(d, length(g + o - f));
  }
  return d;
}
float coatSeg(vec3 p, vec3 a, vec3 b) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 gold = diffuseColor.rgb;
  vec3 cream = mix(gold, vec3(0.98, 0.93, 0.82), 0.8);
  float belly = smoothstep(-0.15, -0.6, vObjN.y);
  vec3 col = mix(gold, cream, belly);
  float head = smoothstep(0.17, 0.2, vObj.x);
  float spot = (1.0 - smoothstep(0.22, 0.27, coatCells(vCoat * 48.0))) * (1.0 - belly);
  spot *= mix(1.0, 0.5, head);
  col = mix(col, vec3(0.12, 0.09, 0.07), spot);
  float side = step(0.008, abs(vObj.z));
  float tear = 1.0 - smoothstep(0.0028, 0.0045, coatSeg(vec3(vObj.xy, 0.0), vec3(0.251, 0.236, 0.0), vec3(0.271, 0.199, 0.0)));
  col = mix(col, vec3(0.08, 0.06, 0.05), tear * side * step(0.235, vObj.x));
  float tail = step(vObj.x, -0.32);
  float ring = step(0.6, fract(vObj.x * 38.0));
  col = mix(col, vec3(0.1, 0.08, 0.06), tail * ring);
  col = mix(col, cream, step(vObj.x, -0.372));
  diffuseColor.rgb = col;
}`
      )
  }
  return m
}

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
  seal: { idle: /^idle$/i, walk: /^shuffle$/i, run: /^shuffle$/i, leap: /^shuffle$/i, swim: /^swim$/i },
  cheetah: { walk: /run/i, run: /run/i, leap: /run/i, fall: /run/i, crawl: /run/i },
  pigeon: { idle: /idle/i, walk: /idle/i, fly: /flapping/i, takeoff: /takeoff/i, land: /gliding/i, touchdown: /landing/i, fall: /gliding/i }
}

interface State {
  species: Species
  mixer: AnimationMixer | null
  actions: Partial<Record<NerpaAnim, AnimationAction>>
  anim: NerpaAnim
  /** the cheetah's standing pose of every bone */
  stand: Map<Object3D, { q: Quaternion; p: Vector3 }>
  /** the model under the scale/lift group (for the pigeon's hops) */
  pose: Object3D | null
  hop: number
  /** the cheetah's pose when its motion changed, blended away over BLEND seconds */
  from: Map<Object3D, { q: Quaternion; p: Vector3 }> | null
  blend: number
  /** the cheetah crouched: every bone's pose, and how low the body goes (mm); `low` is how low it is now */
  crouch: Map<Object3D, { q: Quaternion; p: Vector3 }>
  drop: number
  low: number
}

/** seconds over which one motion turns into the next */
const BLEND = 0.25
/**
 * Clips played once (and how): the takeoff faster to match the climb; the touchdown from its
 * braking part (the glide before it is the `land` clip) over the last TOUCHDOWN mm.
 */
const ONCE: Partial<Record<NerpaAnim, { from: number; speed: number }>> = {
  takeoff: { from: 0, speed: 1.5 },
  touchdown: { from: 0.45, speed: 1.8 }
}

/** A character's visual (null while the models load). */
export function creatureModel(species: Species, color: string): Object3D | null {
  if (!loaded) return null
  // a model that failed to load: a plain egg instead
  const tpl = templates[species] ?? null
  const p = PROFILES[species]
  const g = new Group()
  g.name = 'seal-visual'
  const holder = new Group()
  g.add(holder)
  let body: MeshStandardMaterial
  const st: State = { species, mixer: null, actions: {}, anim: 'idle', stand: new Map(), pose: null, hop: 0, from: null, blend: 1, crouch: new Map(), drop: 0, low: 0 }
  if (tpl) {
    const m = cloneSkinned(tpl.scene)
    body =
      species === 'cheetah'
        ? coatMaterial(color)
        : species === 'pigeon'
          ? pigeonMaterial(m, color)
          : new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, flatShading: true })
    m.traverse((o) => {
      if (o instanceof Mesh) {
        o.material = body
        o.frustumCulled = false
        o.castShadow = true
      }
    })
    st.mixer = new AnimationMixer(m)
    for (const [anim, re] of Object.entries(CLIPS[species]) as [NerpaAnim, RegExp][]) {
      const clip = tpl.clips.find((c) => re.test(c.name.replace(/^.*\|/, '')))
      if (!clip) continue
      const a = st.mixer.clipAction(clip)
      if (ONCE[anim]) {
        a.setLoop(LoopOnce, 1)
        a.clampWhenFinished = true
      }
      st.actions[anim] = a
    }
    if (species === 'cheetah') {
      m.traverse((o) => {
        if (!(o as { isBone?: boolean }).isBone) return
        st.stand.set(o, { q: o.quaternion.clone(), p: o.position.clone() })
        const c = tpl.crouch?.pose.get(o.name)
        if (c) st.crouch.set(o, { q: c.q.clone(), p: c.p.clone() })
      })
      st.drop = tpl.crouch?.drop ?? 0
    }
    st.actions.idle?.play()
    st.mixer.update(0)
    st.pose = m
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

/** The pigeon keeps its feather texture, tinted by its colour. */
function pigeonMaterial(m: Object3D, color: string): MeshStandardMaterial {
  let src: MeshStandardMaterial | null = null
  m.traverse((o) => {
    if (!src && o instanceof Mesh) src = o.material as MeshStandardMaterial
  })
  const out = src ? (src as MeshStandardMaterial).clone() : new MeshStandardMaterial()
  out.color.set(color)
  out.roughness = 0.8
  out.metalness = 0
  return out
}

/** Put a character's look (colour, size, bubble, animation, hop) on its model. */
export function setCreatureLook(g: Object3D, look: SealLook): void {
  const st = g.userData.state as State
  const p = PROFILES[st.species]
  ;(g.userData.body as MeshStandardMaterial | undefined)?.color.set(look.color)
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
    st.from = null
    st.blend = 1
    st.anim = 'idle'
    animateCreature(g, 0)
  } else if (st.anim !== want) {
    if (st.species === 'cheetah') {
      // its poses are made here, not by the mixer: blend from the pose shown now
      st.from = new Map([...st.stand.keys()].map((b) => [b, { q: b.quaternion.clone(), p: b.position.clone() }]))
      st.blend = 0
    }
    switchTo(st, want)
    st.anim = want
    animateCreature(g, 0)
  }
}

/** Fade the clip of `want` in and every other playing clip out (the same clip just goes on). */
function switchTo(st: State, want: NerpaAnim): void {
  // the cheetah's own blend does it (the mixer fading would pass through its bind pose)
  const fade = st.species === 'cheetah' ? 0 : BLEND
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

/** Move a character's animation on by `dt` seconds (and its procedural poses). */
export function animateCreature(g: Object3D, dt: number): void {
  const st = g.userData.state as State | undefined
  if (!st?.mixer) return
  if (st.species === 'cheetah') return animateCheetah(st, dt)
  st.mixer.update(dt)
  // the takeoff clip is over but it still climbs: on into flapping
  const tk = st.actions.takeoff
  if (st.anim === 'takeoff' && tk && !tk.isRunning() && st.actions.fly && !st.actions.fly.isRunning()) {
    st.actions.fly.reset().play()
    st.actions.fly.crossFadeFrom(tk, BLEND, false)
  }
  if (st.species === 'pigeon' && st.pose) {
    // walking: little hops
    st.hop = st.anim === 'walk' ? st.hop + dt * 14 : 0
    st.pose.position.z = st.anim === 'walk' ? Math.abs(Math.sin(st.hop)) * 10 : 0
  }
}

function animateCheetah(st: State, dt: number): void {
  const mixer = st.mixer!
  const run = st.actions.run
  switch (st.anim) {
    case 'run':
      if (run) run.timeScale = 1.4
      mixer.update(dt)
      break
    case 'walk':
      // the run slowed down and half way back to standing
      if (run) run.timeScale = 0.75
      mixer.update(dt)
      for (const [b, s] of st.stand) {
        b.quaternion.copy(s.q.clone().slerp(b.quaternion, 0.45))
        b.position.lerpVectors(s.p, b.position, 0.45)
      }
      break
    case 'crawl':
      // crouched, with a little of the run in the legs
      if (run) run.timeScale = 0.55
      mixer.update(dt)
      for (const [b, c] of st.crouch) {
        b.quaternion.copy(c.q.clone().slerp(b.quaternion, 0.3))
        b.position.lerpVectors(c.p, b.position, 0.3)
      }
      break
    case 'crouch':
      mixer.stopAllAction()
      for (const [b, c] of st.crouch) {
        b.quaternion.copy(c.q)
        b.position.copy(c.p)
      }
      break
    case 'leap':
    case 'fall':
      // a stretched frame of the run
      if (run) {
        run.timeScale = 0
        run.time = 0.62
      }
      mixer.update(0)
      break
    default:
      mixer.stopAllAction()
      for (const [b, s] of st.stand) {
        b.quaternion.copy(s.q)
        b.position.copy(s.p)
      }
  }
  // crouched the body goes down as far as the bent legs let it
  const low = st.anim === 'crouch' || st.anim === 'crawl' ? st.drop : 0
  st.low += (low - st.low) * Math.min(1, dt / 0.12)
  if (dt === 0 && st.blend >= 1) st.low = low
  if (st.pose) st.pose.position.z = -st.low
  if (st.from && st.blend < 1) {
    st.blend = Math.min(1, st.blend + dt / BLEND)
    const k = st.blend * st.blend * (3 - 2 * st.blend)
    for (const [b, f] of st.from) {
      b.quaternion.copy(f.q.clone().slerp(b.quaternion, k))
      b.position.lerpVectors(f.p, b.position, k)
    }
    if (st.blend >= 1) st.from = null
  }
}
