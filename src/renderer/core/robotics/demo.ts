/** Ready-made tracks and programs: the demo project and the headless tests use the same ones. */
import type { Doc, DocNode, LightParams, PrimNode, TileKind } from '../doc/model'
import type { DecorKind, Species, TerrainKind, TerrainParams } from '../doc/model'
import { DEFAULT_TERRAIN, LAND_COLOR, landKindOf } from './terrain'
import { PROFILES } from './creatures'
import { standOnTerrain } from './field'
import { DEFAULT_COLORS } from '../doc/shapes'
import { emptyDoc, newId } from '../doc/model'
import type { BlockJson } from './interpreter'
import { TILE_SIZE } from './tiles'
import { DEFAULT_ROBOT } from './robot'

export interface TileSpot {
  kind: TileKind
  x: number
  y: number
  /** rotation around Z, degrees */
  angle: number
}

/** Tile centres sit on the 300 mm grid: 150 + 300·k. */
export const cellCenter = (i: number) => TILE_SIZE / 2 + TILE_SIZE * i

/**
 * A closed rectangular loop `cols` × `rows` tiles (at least 2 × 2) with rounded corners.
 * The bottom-left tile is at cell (0, 0).
 */
export function loopTrack(cols: number, rows: number): TileSpot[] {
  const out: TileSpot[] = []
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const edgeX = i === 0 || i === cols - 1
      const edgeY = j === 0 || j === rows - 1
      if (!edgeX && !edgeY) continue
      const x = cellCenter(i)
      const y = cellCenter(j)
      if (edgeX && edgeY) {
        // the turn picture joins the bottom and right edges; rotate it into each corner
        const angle = i === 0 ? (j === 0 ? 90 : 0) : j === 0 ? 180 : 270
        out.push({ kind: 'turn', x, y, angle })
      } else out.push({ kind: 'straight', x, y, angle: edgeY ? 90 : 0 })
    }
  }
  return out
}

let bid = 0
const id = (p: string) => `${p}${++bid}`
const numIn = (v: number) => ({ shadow: { type: 'robo_number', id: id('n'), fields: { NUM: v } } })
const chain = (blocks: BlockJson[]): BlockJson | undefined => {
  for (let i = blocks.length - 2; i >= 0; i--) blocks[i].next = { block: blocks[i + 1] }
  return blocks[0]
}
export const motors = (l: number, r: number): BlockJson => ({
  type: 'robo_motors',
  id: id('m'),
  inputs: { LEFT: numIn(l), RIGHT: numIn(r) }
})
export const black = (port: number): BlockJson => ({ type: 'robo_line_black', id: id('s'), fields: { PORT: String(port) } })
export const ifElse = (cond: BlockJson, yes: BlockJson[], no: BlockJson[]): BlockJson => ({
  type: 'robo_if_else',
  id: id('if'),
  inputs: { COND: { block: cond }, DO: { block: chain(yes) }, ELSE: { block: chain(no) } }
})
export const forever = (body: BlockJson[]): BlockJson => ({ type: 'robo_forever', id: id('f'), inputs: { DO: { block: chain(body) } } })
export const start = (body: BlockJson[], x = 20, y = 20): BlockJson =>
  ({ type: 'robo_start', id: id('st'), x, y, next: { block: chain(body) } }) as BlockJson

/** Wrap top-level blocks the way Blockly saves a workspace. */
export const workspaceJson = (tops: BlockJson[]) => ({ blocks: { languageVersion: 0, blocks: tops } })

/** Two sensors (ports 1 and 3, left and right of the line): steer toward the side that sees black. */
export function lineFollowerProgram(fast = 55, slow = 5) {
  return workspaceJson([
    start([
      forever([
        ifElse(black(1), [motors(slow, fast)], [ifElse(black(3), [motors(fast, slow)], [motors(fast, fast)])])
      ])
    ])
  ])
}

export function tileNode(t: TileSpot, name: string): PrimNode {
  return {
    id: newId(),
    kind: 'prim',
    prim: 'tile',
    name,
    color: DEFAULT_COLORS.tile,
    isHole: false,
    params: { tile: t.kind },
    transform: { position: [t.x, t.y, 0], rotation: [0, 0, t.angle], scale: [1, 1, 1] }
  }
}

/** A platform, a ramp or a bridge; `angleDeg` turns it (a ramp rises toward its local +Y). */
export function terrainNode(kind: TerrainKind, x: number, y: number, angleDeg: number, name: string, params: Partial<TerrainParams> = {}): PrimNode {
  const p = { ...DEFAULT_TERRAIN[kind], ...params, kind }
  const land = landKindOf(p)
  return {
    id: newId(),
    kind: 'prim',
    prim: 'terrain',
    name,
    color: land ? LAND_COLOR[land] : DEFAULT_COLORS.terrain,
    isHole: false,
    params: { terrain: p },
    transform: { position: [x, y, 0], rotation: [0, 0, angleDeg], scale: [1, 1, 1] }
  }
}

export function robotNode(x: number, y: number, headingDeg: number, name: string, program?: unknown): PrimNode {
  return {
    id: newId(),
    kind: 'prim',
    prim: 'robot',
    name,
    color: DEFAULT_COLORS.robot,
    isHole: false,
    params: {
      robot: {
        model: DEFAULT_ROBOT,
        sensors: [
          { port: 1, type: 'line' },
          { port: 3, type: 'line' }
        ],
        ...(program !== undefined ? { program } : {})
      }
    },
    transform: { position: [x, y, 0], rotation: [0, 0, headingDeg], scale: [1, 1, 1] }
  }
}

/** Height of a new lamp's bulb above the floor, mm. */
export const LAMP_HEIGHT: Record<LightParams['kind'], number> = { point: 250, spot: 200 }

export function lampNode(kind: LightParams['kind'], x: number, y: number, name: string): PrimNode {
  return {
    id: newId(),
    kind: 'prim',
    prim: 'light',
    name,
    color: DEFAULT_COLORS.light,
    isHole: false,
    params: { light: { kind, brightness: 100, on: true, angle: 60, tilt: kind === 'spot' ? 35 : 0 } },
    transform: { position: [x, y, LAMP_HEIGHT[kind]], rotation: [0, 0, 0], scale: [1, 1, 1] }
  }
}

/** A character of the field: the seal (by default), the cheetah or the pigeon. */
export function nerpaNode(x: number, y: number, headingDeg: number, name: string, program?: unknown, species: Species = 'seal'): PrimNode {
  return {
    id: newId(),
    kind: 'prim',
    prim: 'nerpa',
    name,
    color: species === 'seal' ? DEFAULT_COLORS.nerpa : PROFILES[species].color,
    isHole: false,
    params: { nerpa: { ...(program !== undefined ? { program } : {}), species } },
    transform: { position: [x, y, 0], rotation: [0, 0, headingDeg], scale: [1, 1, 1] }
  }
}

/** The demo: a 4 × 3 loop, a robot that follows the line and a few shapes in its way. */
export function demoDoc(names: { tile: string; robot: string; box: string; cylinder: string }): Doc {
  const d = emptyDoc()
  const nodes: DocNode[] = loopTrack(4, 3).map((t, i) => tileNode(t, `${names.tile} ${i + 1}`))
  nodes.push(robotNode(cellCenter(1), cellCenter(0), 0, names.robot, lineFollowerProgram()))
  const shape = (prim: 'box' | 'cylinder', name: string, x: number, y: number, s: number, color: string): PrimNode => ({
    id: newId(),
    kind: 'prim',
    prim,
    name,
    color,
    isHole: false,
    params: prim === 'cylinder' ? { segments: 32 } : {},
    transform: { position: [x, y, 0], rotation: [0, 0, 0], scale: [s, s, s] }
  })
  // cubes on the line in the robot's way, and one lying further on
  nodes.push(shape('box', `${names.box} 1`, cellCenter(2) + 60, cellCenter(0) + 20, 2, DEFAULT_COLORS.box))
  nodes.push(shape('cylinder', `${names.cylinder} 1`, cellCenter(3), cellCenter(1) + 40, 2, DEFAULT_COLORS.cylinder))
  nodes.push(shape('box', `${names.box} 2`, cellCenter(1) + 60, cellCenter(1), 3, DEFAULT_COLORS.pyramid))
  // a robotics field: the demo opens with the robotics scene on screen
  return { ...d, scene: 'robo', nodes }
}

// ---------------------------------------------------------------- the demo «Остров» (Island)

const blk = (type: string, inputs: Record<string, unknown> = {}, fields: Record<string, unknown> = {}): BlockJson =>
  ({ type, id: id('b'), inputs, fields }) as BlockJson
const textIn = (v: string) => ({ shadow: { type: 'robo_text', id: id('t'), fields: { TEXT: v } } })
const sound = (s: string, wait = false) => blk(wait ? 'sound_play_wait' : 'sound_play', {}, { SOUND: s })
const say = (text: string, s: number) => blk('nerpa_say_for', { TEXT: textIn(text), SECONDS: numIn(s) })
const turnLeft = (deg: number) => blk('nerpa_turn', { DEG: numIn(deg) }, { DIR: 'LEFT' })
const wait = (s: number) => blk('robo_wait', { SECONDS: numIn(s) })
const ifThen = (cond: BlockJson, body: BlockJson[]) => blk('robo_if', { COND: { block: cond }, DO: { block: chain(body) } })
/** a point of the field as the blocks take it: cell centres in cm */
const cm = (i: number) => numIn(cellCenter(i) / 10)

/** The island: what is where (cells of the 9 × 7 field). */
export const ISLAND = {
  cols: 9,
  rows: 7,
  /** the robot's road with a black line: a 5 × 3 loop from this cell */
  road: [2, 2] as [number, number],
  /** the cheetah's hill on the north beach, the lighthouse on the south-east corner */
  hill: [4, 5] as [number, number],
  lighthouse: [7, 1] as [number, number],
  seal: [0, 0] as [number, number],
  cheetah: [1, 5] as [number, number],
  pigeon: [1, 3] as [number, number],
  /** where the pigeon flies to and back */
  pigeonTo: [7, 3] as [number, number]
}

/**
 * The demo «Остров»: an island of sand and grass in the sea, a road round its middle. The robot
 * follows the road's line, the seal swims round the island, Читик runs along the beach and
 * jumps over the hill, Геннадий flies across and back, the lighthouse blinks. `tr` gives the
 * names and the words in the user's language (keys of the app's dictionary).
 */
export function islandDoc(tr: (key: string) => string): Doc {
  const d = emptyDoc()
  const nodes: DocNode[] = []
  const counts = new Map<string, number>()
  const named = (key: string) => {
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    return `${tr(key)} ${n}`
  }
  const I = ISLAND
  const at = (c: [number, number]) => [cellCenter(c[0]), cellCenter(c[1])] as const
  const same = (a: [number, number], i: number, j: number) => a[0] === i && a[1] === j
  // the road loop: the same pictures as a track loop, with the line on road tiles
  const road = new Map(loopTrack(5, 3).map((t) => [`${Math.round((t.x - cellCenter(0)) / TILE_SIZE) + I.road[0]},${Math.round((t.y - cellCenter(0)) / TILE_SIZE) + I.road[1]}`, t]))
  for (let i = 0; i < I.cols; i++) {
    for (let j = 0; j < I.rows; j++) {
      if (same(I.hill, i, j) || same(I.lighthouse, i, j)) continue
      const x = cellCenter(i)
      const y = cellCenter(j)
      const sea = i === 0 || j === 0 || i === I.cols - 1 || j === I.rows - 1
      const beach = !sea && (i === 1 || j === 1 || i === I.cols - 2 || j === I.rows - 2)
      const r = road.get(`${i},${j}`)
      if (sea) nodes.push(terrainNode('water', x, y, 0, named('robo.land.water'), { kind: 'water', height: DEFAULT_TERRAIN.water.height }))
      else if (r) nodes.push(terrainNode('ground', x, y, r.angle, named('robo.land.road'), { surface: 'road', line: r.kind }))
      else nodes.push(terrainNode('ground', x, y, 0, named(beach ? 'robo.land.sand' : 'robo.land.grass'), { surface: beach ? 'sand' : 'grass' }))
    }
  }
  // the hill and the lighthouse's rock
  nodes.push(terrainNode('platform', ...at(I.hill), 0, named('robo.terrain.platform'), { height: 120 }))
  nodes.push(terrainNode('platform', ...at(I.lighthouse), 0, named('robo.terrain.platform'), { height: 120 }))
  // scenery: trees on the beach, flowers and a bush inside the road
  const decor = (kind: DecorKind, c: [number, number], z: number) =>
    nodes.push({
      id: newId(),
      kind: 'prim',
      prim: 'decor',
      name: named(`robo.decor.${kind}`),
      color: DEFAULT_COLORS.decor,
      isHole: false,
      params: { decor: { kind } },
      transform: { position: [...at(c), z], rotation: [0, 0, 0], scale: [1, 1, 1] }
    })
  const GROUND = DEFAULT_TERRAIN.ground.height
  decor('tree', [1, 1], GROUND)
  decor('pine', [2, 1], GROUND)
  decor('rock', [5, 1], GROUND)
  decor('flowers', [3, 3], GROUND)
  decor('bush', [4, 3], GROUND)
  decor('flowers', [5, 3], GROUND)
  decor('tree', [7, 4], GROUND)

  // the robot follows the road's line
  nodes.push(robotNode(cellCenter(I.road[0] + 1), cellCenter(I.road[1]), 0, tr('shape.robot'), lineFollowerProgram()))

  // the seal swims round the island: along the sea, a quarter turn at each corner
  const sealProgram = workspaceJson([
    start([
      sound('seal_voice'),
      say(tr('demo.island.seal'), 2),
      forever([sound('seal_bark'), blk('nerpa_walk', { CM: numIn(240) }), turnLeft(90), sound('seal_splash'), blk('nerpa_walk', { CM: numIn(180) }), turnLeft(90)])
    ])
  ])
  nodes.push(nerpaNode(...at(I.seal), 0, `${tr('shape.nerpa')} 1`, sealProgram, 'seal'))

  // Читик runs along the north beach: over the hill, back at the water
  const cheetahProgram = workspaceJson([
    start([
      sound('cheetah_meow', true),
      forever([
        blk('cheetah_run', { CM: numIn(400) }),
        ifThen(blk('creature_ledge'), [sound('cheetah_chirp'), blk('cheetah_leap'), sound('cheetah_purr'), say(tr('demo.island.cheetah'), 1.5), blk('cheetah_leap')]),
        ifThen(blk('creature_water'), [sound('cheetah_meow'), turnLeft(180)])
      ])
    ])
  ])
  nodes.push(nerpaNode(...at(I.cheetah), 0, tr('robo.cheetahName'), cheetahProgram, 'cheetah'))

  // Геннадий flies across the island and back
  const [px, py] = I.pigeon
  const [qx, qy] = I.pigeonTo
  const pigeonProgram = workspaceJson([
    start([
      forever([
        sound('pigeon_coo', true),
        blk('pigeon_takeoff', { CM: numIn(40) }),
        sound('pigeon_wings'),
        blk('pigeon_fly_to', { X: cm(qx), Y: cm(qy) }),
        blk('pigeon_land'),
        sound('pigeon_gugu'),
        say(tr('demo.island.pigeon'), 1.5),
        blk('pigeon_takeoff', { CM: numIn(40) }),
        sound('pigeon_wings'),
        blk('pigeon_fly_to', { X: cm(px), Y: cm(py) }),
        blk('pigeon_land'),
        wait(1)
      ])
    ])
  ])
  nodes.push(nerpaNode(...at(I.pigeon), 0, tr('robo.pigeonName'), pigeonProgram, 'pigeon'))

  // the lighthouse blinks
  const lamp = lampNode('point', ...at(I.lighthouse), tr('demo.island.lighthouse'))
  lamp.color = '#ffd60a'
  lamp.transform = { ...lamp.transform, position: [...at(I.lighthouse), 120 + LAMP_HEIGHT.point] }
  lamp.params.light = {
    ...lamp.params.light!,
    program: workspaceJson([start([forever([blk('light_on'), wait(0.6), blk('light_off'), wait(0.6)])])])
  }
  nodes.push(lamp)
  // the robot and the heroes stand on the tiles (the seal floats on the water)
  const actors = nodes.filter((n) => n.kind === 'prim' && (n.prim === 'robot' || n.prim === 'nerpa')).map((n) => n.id)
  return standOnTerrain({ ...d, scene: 'robo', nodes }, actors)
}
