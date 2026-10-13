import { describe, expect, it } from 'vitest'
import { emptyDoc, type Doc, type DocNode, type PrimNode } from '@/core/doc/model'
import { addNodes, removeNodes, updateNodes } from '@/core/doc/ops'
import { nerpaNode, robotNode, start, terrainNode, workspaceJson } from '@/core/robotics/demo'
import { settleOnTerrain, standOnTerrain } from '@/core/robotics/field'
import { RoboWorld, terrainOf } from '@/core/robotics/world'
import { surfacesAt } from '@/core/robotics/terrain'
import { parseDoc, serializeDoc } from '@/core/io/formats'
import type { BlockJson } from '@/core/robotics/interpreter'

const c = (i: number) => 150 + 300 * i
const field = (nodes: DocNode[]): Doc => ({ ...emptyDoc(), scene: 'robo', nodes })
/** add a node the way the app does: built on what is under it */
const put = (d: Doc, n: DocNode) => settleOnTerrain(d, standOnTerrain(addNodes(d, [n]), [n.id]))
const z = (d: Doc, id: string) => d.nodes.find((n) => n.id === id)!.transform.position[2]
const platform = (i: number, j: number, height = 120) => terrainNode('platform', c(i), c(j), 0, 'p', { height })

describe('relief in tiers', () => {
  it('a piece is built on the highest surface under it: the floor, a landscape tile, another platform', () => {
    let d = field([])
    const a = platform(0, 0)
    d = put(d, a)
    expect(z(d, a.id)).toBe(0)
    const b = platform(0, 0, 60)
    d = put(d, b)
    expect(z(d, b.id)).toBe(120)
    const g = terrainNode('ground', c(1), c(0), 0, 'g', { surface: 'grass' })
    d = put(d, g)
    const p = platform(1, 0)
    d = put(d, p)
    expect(z(d, p.id)).toBe(10)
    // where one stands on the stack: only on its top
    const t = terrainOf(d)
    expect(surfacesAt(t, c(0), c(0)).map((s) => s.z)).toEqual([180])
    expect(surfacesAt(t, c(1), c(0)).map((s) => s.z)).toEqual([130])
  })

  it('upper tiers and what stands on them follow the lower ones: made taller, taken away', () => {
    let d = field([])
    const a = platform(0, 0)
    d = put(d, a)
    const b = platform(0, 0, 60)
    d = put(d, b)
    const r = robotNode(c(0), c(0), 0, 'R')
    d = put(d, r)
    expect(z(d, r.id)).toBe(180)
    // the bottom platform made taller: the top one and the robot go up with it
    let next = updateNodes(d, [a.id], (n) => (n.kind === 'prim' ? { ...n, params: { terrain: { ...n.params.terrain!, height: 200 } } } : n))
    d = settleOnTerrain(d, next)
    expect(z(d, b.id)).toBe(200)
    expect(z(d, r.id)).toBe(260)
    // the bottom one taken away: the top one comes down to the floor, the robot with it
    next = removeNodes(d, [a.id])
    d = settleOnTerrain(d, next)
    expect(z(d, b.id)).toBe(0)
    expect(z(d, r.id)).toBe(60)
  })

  it('a stack dragged together keeps its tiers; one dragged off the stack goes down to the floor', () => {
    let d = field([])
    const a = platform(0, 0)
    d = put(d, a)
    const b = platform(0, 0, 60)
    d = put(d, b)
    const move = (doc: Doc, ids: string[], dx: number) =>
      settleOnTerrain(
        doc,
        standOnTerrain(
          updateNodes(doc, ids, (n) => ({ ...n, transform: { ...n.transform, position: [n.transform.position[0] + dx, n.transform.position[1], n.transform.position[2]] } })),
          ids,
          doc
        )
      )
    const both = move(d, [a.id, b.id], 300)
    expect(z(both, a.id)).toBe(0)
    expect(z(both, b.id)).toBe(120)
    const off = move(d, [b.id], 600)
    expect(z(off, b.id)).toBe(0)
  })

  it('the robot drives up a ramp onto a platform, and up a second ramp built on it onto the top tier', () => {
    let d = field([])
    // along +Y: floor, ramp 0→12 cm, platforms, a ramp on them 12→24 cm, the top platform
    d = put(d, terrainNode('ramp', c(0), 600, 0, 'r1', { height: 120, length: 2 }))
    for (const j of [3, 4, 5, 6]) d = put(d, platform(0, j))
    const r2 = terrainNode('ramp', c(0), 1500, 0, 'r2', { height: 120, length: 2 })
    d = put(d, r2)
    expect(z(d, r2.id)).toBe(120)
    const top = platform(0, 6)
    d = put(d, top)
    expect(z(d, top.id)).toBe(120)
    const prog = workspaceJson([start([{ type: 'robo_motors_for', inputs: { LEFT: n(60), RIGHT: n(60), SECONDS: n(17) } } as BlockJson])])
    d = put(d, robotNode(c(0), c(0) - 60, 90, 'R', prog))
    const w = RoboWorld.fromDoc(d)
    let maxZ = 0
    for (let k = 0; k < 120 * 18; k++) {
      w.step()
      if (w.robots[0].pose.y < 2000) maxZ = Math.max(maxZ, w.robots[0].z)
    }
    // it got to the top tier (and drove on off its far edge)
    expect(maxZ).toBeCloseTo(240, 0)
    expect(w.robots[0].pose.y).toBeGreaterThan(1800)
  })

  it('files: a piece keeps its tier (its z), old files are on the floor as before', () => {
    let d = field([])
    const a = platform(0, 0)
    d = put(d, a)
    const b = platform(0, 0, 60)
    d = put(d, b)
    const back = parseDoc(serializeDoc(d))
    const nodes = [...back.nodes, ...back.parked] as PrimNode[]
    expect(nodes.find((n) => n.id === b.id)!.transform.position[2]).toBe(120)
    const w = RoboWorld.fromDoc({ ...back, scene: 'robo', nodes: nodes })
    expect(w.terrain.find((t) => t.id === b.id)!.base).toBe(120)
  })

  it('a hero walks off the top tier down onto the lower one', () => {
    let d = field([])
    d = put(d, platform(0, 0))
    d = put(d, platform(1, 0))
    d = put(d, platform(0, 0, 60))
    const walk = { type: 'nerpa_walk', inputs: { CM: n(30) } } as BlockJson
    d = put(d, nerpaNode(c(0), c(0), 0, 'N', workspaceJson([start([walk])]), 'seal'))
    const w = RoboWorld.fromDoc(d)
    expect(w.seals[0].seal.z).toBe(180)
    for (let k = 0; k < 120 * 4; k++) w.step()
    expect(w.seals[0].seal.x).toBeGreaterThan(c(1) - 50)
    expect(w.seals[0].seal.z).toBeCloseTo(120, 0)
  })
})

function n(v: number) {
  return { shadow: { type: 'robo_number', fields: { NUM: v } } }
}
