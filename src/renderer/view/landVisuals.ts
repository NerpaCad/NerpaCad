/**
 * What landscape tiles look like: a slab of earth with a grass, sand, stone or road top (a road
 * can carry a black line), and water tiles — a shallow pool with a sandy bottom and a gently
 * moving surface. Where land meets water a strip of sand runs along the shore.
 *
 * The pictures are drawn on canvases (seeded, so a scene always looks the same). A visual is
 * turned back to the world axes (`rotation.z = −angle`), so the pictures of neighbouring tiles
 * and the shore strips line up whatever way a tile was turned; a road's line is drawn turned
 * instead.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2
} from 'three'
import type { Surface, TileKind } from '../core/doc/model'
import { GROUND_HEIGHT, LAND_COLOR, type PlacedTerrain, WATER_FLOOR, WATER_LEVEL } from '../core/robotics/terrain'
import { TILE_SIZE, drawTile } from '../core/robotics/tiles'
import { keep, noPick } from './roboVisuals'

/** Neighbours (world directions) as bits of a mask: north (+Y), east (+X), south, west. */
export const N = 1
export const E = 2
export const S = 4
export const W = 8
const SIDES: [number, number, number][] = [
  [N, 0, 1],
  [E, 1, 0],
  [S, 0, -1],
  [W, -1, 0]
]

/** The grid cell of a floor point (cells are `TILE_SIZE` wide, their corners on multiples of it). */
export const cellOf = (x: number, y: number) => `${Math.floor(x / TILE_SIZE)},${Math.floor(y / TILE_SIZE)}`

/**
 * For every landscape tile, which of its four sides touch water and which touch land
 * (`shore`: water next to a ground tile; `closed`: anything but water next to a water tile —
 * there its pool needs no glass side).
 */
export function landNeighbours(pieces: PlacedTerrain[]): Map<string, { shore: number; closed: number; variant: number }> {
  const at = new Map<string, PlacedTerrain>()
  for (const t of pieces) if (t.kind === 'ground' || t.kind === 'water') at.set(cellOf(t.x, t.y), t)
  const out = new Map<string, { shore: number; closed: number; variant: number }>()
  for (const t of at.values()) {
    const cx = Math.floor(t.x / TILE_SIZE)
    const cy = Math.floor(t.y / TILE_SIZE)
    let shore = 0
    let closed = 0
    for (const [bit, dx, dy] of SIDES) {
      const nb = at.get(`${cx + dx},${cy + dy}`)
      if (nb?.kind === 'water' && t.kind === 'ground') shore |= bit
      if (nb && t.kind === 'water') closed |= bit
    }
    out.set(t.id, { shore, closed, variant: (((cx * 7 + cy * 13) % 4) + 4) % 4 })
  }
  return out
}

// ---------------------------------------------------------------- pictures

/** Small fast seeded random numbers. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The flat colour of each top (also what the panel's buttons show). */
export const SURFACE_COLOR = LAND_COLOR

function speckle(g: CanvasRenderingContext2D, px: number, r: () => number, colors: string[], count: number, size: number): void {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)]
    g.beginPath()
    g.arc(r() * px, r() * px, size * (0.5 + r()), 0, Math.PI * 2)
    g.fill()
  }
}

function drawGrass(g: CanvasRenderingContext2D, px: number, r: () => number): void {
  g.fillStyle = SURFACE_COLOR.grass
  g.fillRect(0, 0, px, px)
  const k = px / 256
  // soft patches, then little blades
  for (let i = 0; i < 26; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(80,150,50,0.35)' : 'rgba(130,200,90,0.3)'
    g.beginPath()
    g.ellipse(r() * px, r() * px, (14 + r() * 30) * k, (10 + r() * 20) * k, r() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  g.lineCap = 'round'
  g.lineWidth = 1.6 * k
  const blades = ['#5ca63a', '#78c453', '#4f9a33', '#86cf5f', '#62ad40']
  for (let i = 0; i < 1500; i++) {
    const x = r() * px
    const y = r() * px
    const a = -Math.PI / 2 + (r() - 0.5) * 1.2
    const l = (3 + r() * 4) * k
    g.strokeStyle = blades[Math.floor(r() * blades.length)]
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
    g.stroke()
  }
}

function drawSand(g: CanvasRenderingContext2D, px: number, r: () => number): void {
  g.fillStyle = SURFACE_COLOR.sand
  g.fillRect(0, 0, px, px)
  const k = px / 256
  for (let i = 0; i < 18; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(220,190,130,0.35)' : 'rgba(250,236,196,0.4)'
    g.beginPath()
    g.ellipse(r() * px, r() * px, (16 + r() * 34) * k, (8 + r() * 14) * k, r() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  speckle(g, px, r, ['#dcc488', '#f6e7bd', '#cfb57a', '#e2cd95'], 1600, 0.8 * k)
}

function drawStone(g: CanvasRenderingContext2D, px: number, r: () => number): void {
  g.fillStyle = '#80868c'
  g.fillRect(0, 0, px, px)
  const n = 6
  const c = px / n
  const tones = ['#a9afb5', '#b6bcc1', '#9fa5ab', '#b0b5b0', '#a3a8ae']
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // rows shifted by half a stone, like a paved path
      const off = j % 2 ? c / 2 : 0
      for (const dx of off ? [-c, 0] : [0]) {
        const x = i * c + off + dx + c * 0.06
        const y = j * c + c * 0.06
        const w = c * 0.88
        const h = c * 0.88
        g.fillStyle = tones[Math.floor(r() * tones.length)]
        g.beginPath()
        g.roundRect(x, y, w, h, c * 0.18)
        g.fill()
        g.fillStyle = 'rgba(255,255,255,0.12)'
        g.beginPath()
        g.roundRect(x + w * 0.1, y + h * 0.08, w * 0.6, h * 0.25, c * 0.1)
        g.fill()
      }
    }
  }
  speckle(g, px, r, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.1)'], 500, 0.8 * (px / 256))
}

function drawRoad(g: CanvasRenderingContext2D, px: number, r: () => number): void {
  g.fillStyle = SURFACE_COLOR.road
  g.fillRect(0, 0, px, px)
  speckle(g, px, r, ['#c6c7c3', '#e6e7e3', '#cfd0cc'], 2200, 0.7 * (px / 256))
}

function drawWaterBottom(g: CanvasRenderingContext2D, px: number, r: () => number): void {
  g.fillStyle = '#b8a477'
  g.fillRect(0, 0, px, px)
  speckle(g, px, r, ['#a8946a', '#c9b689', '#9c8960'], 900, 1.1 * (px / 256))
  // a few pebbles
  speckle(g, px, r, ['#9a9c96', '#b4b2aa', '#8c8a82'], 16, 4 * (px / 256))
}

const DRAW: Record<Surface, (g: CanvasRenderingContext2D, px: number, r: () => number) => void> = {
  grass: drawGrass,
  sand: drawSand,
  stone: drawStone,
  road: drawRoad
}

/** A strip of sand along the sides in `mask` (the shore), with a wavy inner edge. */
function drawShore(g: CanvasRenderingContext2D, px: number, mask: number, r: () => number): void {
  const k = px / 256
  const depth = 26 * k
  for (const [bit] of SIDES) {
    if (!(mask & bit)) continue
    g.save()
    // draw it along the top edge, turned to its side (canvas top = north)
    g.translate(px / 2, px / 2)
    g.rotate(bit === N ? 0 : bit === E ? Math.PI / 2 : bit === S ? Math.PI : -Math.PI / 2)
    g.translate(-px / 2, -px / 2)
    g.fillStyle = SURFACE_COLOR.sand
    g.beginPath()
    g.moveTo(0, 0)
    for (let x = 0; x <= px; x += 8 * k) g.lineTo(x, depth + Math.sin(x / (19 * k) + bit) * 5 * k + Math.sin(x / (7 * k)) * 2 * k)
    g.lineTo(px, 0)
    g.closePath()
    g.fill()
    g.clip()
    speckle(g, px, r, ['#dcc488', '#f6e7bd', '#cfb57a'], 260, 0.8 * k)
    // the wet edge
    g.fillStyle = 'rgba(190,160,100,0.45)'
    g.fillRect(0, 0, px, 4 * k)
    g.restore()
  }
}

/** Draw a top into a canvas (the panel's buttons use this too). */
export function drawLand(g: CanvasRenderingContext2D, px: number, kind: Surface | 'water', opt: { line?: TileKind | null; quarter?: number; shore?: number; variant?: number } = {}): void {
  const r = rng(1 + (opt.variant ?? 0) * 97 + kind.length * 13)
  if (kind === 'water') {
    drawWaterBottom(g, px, r)
    g.fillStyle = 'rgba(47,143,214,0.72)'
    g.fillRect(0, 0, px, px)
    return
  }
  DRAW[kind](g, px, r)
  if (opt.shore && kind !== 'sand') drawShore(g, px, opt.shore, r)
  if (kind === 'road' && opt.line) {
    // the line is turned with the tile (tile → world turns counter-clockwise; canvas Y points down)
    g.save()
    g.translate(px / 2, px / 2)
    g.rotate(-(opt.quarter ?? 0) * (Math.PI / 2))
    g.translate(-px / 2, -px / 2)
    drawTile(g, opt.line, px, '#151515', 'rgba(0,0,0,0)', false)
    g.restore()
  }
}

const textures = new Map<string, CanvasTexture>()
function landTexture(key: string, size: number, draw: (g: CanvasRenderingContext2D, px: number) => void): CanvasTexture {
  let t = textures.get(key)
  if (!t) {
    const c = document.createElement('canvas')
    c.width = c.height = size
    draw(c.getContext('2d')!, size)
    t = new CanvasTexture(c)
    t.colorSpace = SRGBColorSpace
    t.anisotropy = 8
    textures.set(key, keep(t))
  }
  return t
}

const topMats = new Map<string, MeshStandardMaterial>()
function topMaterial(key: string, size: number, draw: (g: CanvasRenderingContext2D, px: number) => void): MeshStandardMaterial {
  let m = topMats.get(key)
  if (!m) {
    m = keep(new MeshStandardMaterial({ map: landTexture(key, size, draw), roughness: 0.95, metalness: 0 }))
    topMats.set(key, m)
  }
  return m
}

// ---------------------------------------------------------------- materials

/** The earth under a landscape tile (the tile's own clickable slab wears it). */
export const soilMaterial = keep(new MeshStandardMaterial({ color: new Color('#8a5a35'), roughness: 1, metalness: 0 }))

/** The top layer seen on a tile's sides (grass over earth, and so on). */
const LIP: Record<Surface, MeshStandardMaterial> = {
  grass: keep(new MeshStandardMaterial({ color: new Color('#58a03a'), roughness: 1 })),
  sand: keep(new MeshStandardMaterial({ color: new Color('#dcc488'), roughness: 1 })),
  stone: keep(new MeshStandardMaterial({ color: new Color('#8f959b'), roughness: 0.9 })),
  road: keep(new MeshStandardMaterial({ color: new Color('#b9bab6'), roughness: 0.9 }))
}
const LIP_DEPTH = 3

/** A ripple normal map that tiles seamlessly (sums of waves with whole periods across it). */
function rippleNormals(): CanvasTexture {
  const n = 128
  const c = document.createElement('canvas')
  c.width = c.height = n
  const g = c.getContext('2d')!
  const img = g.createImageData(n, n)
  const waves = [
    [1, 2, 0.5, 0.3],
    [3, -1, 0.35, 1.7],
    [-2, 3, 0.3, 4.1],
    [5, 4, 0.15, 2.2],
    [-6, 5, 0.12, 0.9]
  ]
  const h = (u: number, v: number) => waves.reduce((s, [a, b, amp, ph]) => s + amp * Math.sin(2 * Math.PI * (a * u + b * v) + ph), 0)
  const d = 1 / n
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / n
      const v = j / n
      const dx = (h(u + d, v) - h(u - d, v)) * 1.6
      const dy = (h(u, v + d) - h(u, v - d)) * 1.6
      const len = Math.hypot(dx, dy, 1)
      const o = (j * n + i) * 4
      img.data[o] = ((-dx / len) * 0.5 + 0.5) * 255
      img.data[o + 1] = ((dy / len) * 0.5 + 0.5) * 255
      img.data[o + 2] = ((1 / len) * 0.5 + 0.5) * 255
      img.data[o + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  const t = new CanvasTexture(c)
  t.wrapS = t.wrapT = RepeatWrapping
  return keep(t)
}

let water: { surface: MeshStandardMaterial; side: MeshStandardMaterial; normals: CanvasTexture } | null = null
function waterMaterials() {
  if (!water) {
    const normals = rippleNormals()
    water = {
      normals,
      surface: keep(
        new MeshStandardMaterial({
          color: new Color(SURFACE_COLOR.water),
          transparent: true,
          opacity: 0.74,
          roughness: 0.1,
          metalness: 0.05,
          normalMap: normals,
          normalScale: new Vector2(0.45, 0.45),
          depthWrite: false
        })
      ),
      side: keep(new MeshStandardMaterial({ color: new Color('#5aaee6'), transparent: true, opacity: 0.45, roughness: 0.2, depthWrite: false, side: DoubleSide }))
    }
  }
  return water
}

/** Move the ripples on by `dt` seconds (during a run). */
export function animateWater(dt: number): void {
  if (!water) return
  water.normals.offset.x = (water.normals.offset.x + dt * 0.035) % 1
  water.normals.offset.y = (water.normals.offset.y + dt * 0.02) % 1
}

// ---------------------------------------------------------------- visuals

const plane = keep(new PlaneGeometry(TILE_SIZE, TILE_SIZE))
const lipBox = keep(new BoxGeometry(TILE_SIZE, TILE_SIZE, LIP_DEPTH))
/** a face that is not drawn */
const HIDDEN = keep(new MeshBasicMaterial({ visible: false }))
const soilBox = keep(new BoxGeometry(TILE_SIZE, TILE_SIZE, GROUND_HEIGHT - LIP_DEPTH))
const wallLow = keep(new PlaneGeometry(TILE_SIZE, WATER_FLOOR))
const wallHigh = keep(new PlaneGeometry(TILE_SIZE, WATER_LEVEL - WATER_FLOOR))
const bottomSide = keep(new MeshStandardMaterial({ color: new Color('#c9b07a'), roughness: 1, side: DoubleSide }))

/** Quarter turns of a piece's angle (0..3). */
export const quarterOf = (angle: number) => (((Math.round(angle / (Math.PI / 2)) % 4) + 4) % 4)

/** What decides a landscape tile's look (its visual is rebuilt when this changes). */
export function landKey(t: PlacedTerrain, nb: { shore: number; closed: number; variant: number } | undefined): string {
  const q = quarterOf(t.angle)
  if (t.kind === 'water') return `water:${nb?.closed ?? 0}:${q}`
  return `ground:${t.surface}:${t.line ?? ''}:${q}:${nb?.shore ?? 0}:${nb?.variant ?? 0}`
}

/** The visual of a landscape tile in its node's frame (the node is turned by `t.angle`). */
export function landVisual(t: PlacedTerrain, nb: { shore: number; closed: number; variant: number } | undefined): Group {
  const g = new Group()
  g.name = 'land-visual'
  g.rotation.z = -quarterOf(t.angle) * (Math.PI / 2)
  if (t.kind === 'water') {
    const m = waterMaterials()
    const bottom = new Mesh(plane, topMaterial('water-bottom', 256, (c, px) => drawWaterBottom(c, px, rng(5))))
    bottom.position.z = WATER_FLOOR + 0.05
    const top = new Mesh(plane, m.surface)
    top.position.z = WATER_LEVEL
    top.renderOrder = 6
    g.add(bottom, top)
    // glass sides where nothing stands next to the pool
    for (const [bit, dx, dy] of SIDES) {
      if ((nb?.closed ?? 0) & bit) continue
      for (const [geo, mat, z0, h] of [
        [wallLow, bottomSide, 0, WATER_FLOOR],
        [wallHigh, m.side, WATER_FLOOR, WATER_LEVEL - WATER_FLOOR]
      ] as const) {
        // a wall drawn on the north side, turned to its own side
        const w = new Mesh(geo, mat)
        w.rotation.x = Math.PI / 2
        w.position.set(0, TILE_SIZE / 2, z0 + h / 2)
        if (mat === m.side) w.renderOrder = 6
        const side = new Group()
        side.rotation.z = -Math.atan2(dx, dy)
        side.add(w)
        g.add(side)
      }
    }
  } else {
    const surface = t.surface ?? 'grass'
    const q = quarterOf(t.angle)
    const shore = nb?.shore ?? 0
    const variant = surface === 'grass' || surface === 'sand' ? (nb?.variant ?? 0) : 0
    const key = `top:${surface}:${t.line ?? ''}:${q}:${shore}:${variant}`
    const top = topMaterial(key, t.line ? 512 : 256, (c, px) => drawLand(c, px, surface, { line: t.line, quarter: q, shore, variant }))
    // the top layer (its upper face wears the picture) over a block of earth; no faces lie on
    // top of each other, so nothing flickers from afar
    // faces nobody sees (the lip's bottom on the earth, the earth's top under the lip) are not
    // drawn: from afar they would flicker through the top
    const lip = new Mesh(lipBox, [LIP[surface], LIP[surface], LIP[surface], LIP[surface], top, HIDDEN])
    lip.position.z = GROUND_HEIGHT - LIP_DEPTH / 2
    const soil = new Mesh(soilBox, [soilMaterial, soilMaterial, soilMaterial, soilMaterial, HIDDEN, soilMaterial])
    soil.position.z = (GROUND_HEIGHT - LIP_DEPTH) / 2
    g.add(lip, soil)
  }
  noPick(g)
  return g
}
