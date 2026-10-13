import { Color, DoubleSide, LineBasicMaterial, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial } from 'three'
import type { MaterialKind } from '../core/doc/model'
import { THEME } from './theme'

const solidCache = new Map<string, MeshStandardMaterial>()

/**
 * The beautiful view is on: solids lose the little self-glow that keeps them bright in the dark
 * editor, glass becomes real (it refracts and reflects), glowing shapes glow strongly enough to
 * get a halo. `glowBoost`: stronger at night.
 */
let pretty: { glowBoost: number } | null = null
export function setPrettyMaterials(p: { glowBoost: number } | null): boolean {
  const changed = (pretty?.glowBoost ?? 0) !== (p?.glowBoost ?? 0)
  pretty = p
  return changed
}

function prettyMaterial(color: string, kind: MaterialKind, glowBoost: number): MeshStandardMaterial {
  if (kind === 'glass') {
    return new MeshPhysicalMaterial({
      color: new Color(color),
      transmission: 1,
      thickness: 6,
      ior: 1.45,
      roughness: 0.04,
      metalness: 0,
      attenuationColor: new Color(color),
      attenuationDistance: 120,
      side: DoubleSide
    })
  }
  if (kind === 'glow') {
    return new MeshStandardMaterial({ color: new Color(color), emissive: new Color(color), emissiveIntensity: 1.2 + 0.6 * glowBoost, roughness: 0.35, metalness: 0 })
  }
  return new MeshStandardMaterial({ color: new Color(color), roughness: 0.55, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
}

/** The look of a solid: its colour, and plain, glowing (lit from inside) or glass (see-through). */
export function solidMaterial(color: string, kind: MaterialKind = 'normal'): MeshStandardMaterial {
  const key = `${color}|${kind}${pretty ? `|p${pretty.glowBoost}` : ''}`
  let m = solidCache.get(key)
  if (!m && pretty) {
    m = prettyMaterial(color, kind, pretty.glowBoost)
    solidCache.set(key, m)
  }
  if (!m && kind === 'glow') {
    m = new MeshStandardMaterial({
      color: new Color(color),
      // bright from inside, but still shaded a little so the form stays readable
      emissive: new Color(color),
      emissiveIntensity: 0.62,
      roughness: 0.35,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    })
    solidCache.set(key, m)
  }
  if (!m && kind === 'glass') {
    m = new MeshStandardMaterial({
      color: new Color(color),
      emissive: new Color(color).multiplyScalar(THEME.emissive * 0.5),
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    })
    solidCache.set(key, m)
  }
  if (!m) {
    m = new MeshStandardMaterial({
      color: new Color(color),
      // a little self-glow keeps neon colors bright against the dark scene
      emissive: new Color(color).multiplyScalar(THEME.emissive),
      roughness: 0.5,
      metalness: 0.08,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    })
    solidCache.set(key, m)
  }
  return m
}

const ghostCache = new Map<string, MeshBasicMaterial>()

/**
 * A faint see-through look for shapes standing between the camera and an open sketch, so the
 * sketch plane stays visible while the shapes still show where they are.
 */
export function ghostMaterial(color: string): MeshBasicMaterial {
  let m = ghostCache.get(color)
  if (!m) {
    m = new MeshBasicMaterial({ color: new Color(color), transparent: true, opacity: 0.18, depthWrite: false, side: DoubleSide })
    ghostCache.set(color, m)
  }
  return m
}

let hole: MeshStandardMaterial | null = null

/** Translucent grey with diagonal screen-space stripes, like Tinkercad's holes. */
export function holeMaterial(): MeshStandardMaterial {
  if (hole) return hole
  hole = new MeshStandardMaterial({
    color: new Color(THEME.hole),
    emissive: new Color(THEME.hole).multiplyScalar(0.25),
    roughness: 0.7,
    metalness: 0,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: DoubleSide
  })
  hole.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       float stripe = mod(gl_FragCoord.x + gl_FragCoord.y, 14.0);
       if (stripe < 5.0) diffuseColor.rgb *= 0.55;`
    )
  }
  hole.customProgramCacheKey = () => 'hole-stripes'
  return hole
}

export const selectionEdgeMaterial = new LineBasicMaterial({
  color: new Color(THEME.select),
  transparent: true,
  opacity: 0.95,
  depthTest: true
})

/** The outline of platforms, ramps and bridges, so pieces standing side by side read apart. */
export const terrainEdgeMaterial = new LineBasicMaterial({ color: new Color('#3d4650'), transparent: true, opacity: 0.8 })

/** Re-read theme colors: holes, selection outline, and solids' glow (rebuilt lazily). */
export function applyThemeToMaterials(): void {
  solidCache.forEach((m) => m.dispose())
  solidCache.clear()
  if (hole) {
    hole.color.set(THEME.hole)
    hole.emissive.set(THEME.hole).multiplyScalar(0.25)
  }
  selectionEdgeMaterial.color.set(THEME.select)
  hoverEdgeMaterial.color.set(THEME.select)
}

export const hoverEdgeMaterial = new LineBasicMaterial({
  color: new Color(THEME.select),
  transparent: true,
  opacity: 0.6
})

/** Not drawn: stand-in shapes that are only there to be picked (the robot shows its 3D model). */
export const proxyMaterial = new MeshBasicMaterial({ visible: false })
