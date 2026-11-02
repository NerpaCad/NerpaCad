/**
 * Relief on the landscape stands at one height (a pond is ground like the grass for it), and the
 * cheetah's "ledge ahead?" does not see a ledge on a ramp or where the ramp meets its platform.
 */
import { describe, expect, it } from 'vitest'
import { emptyDoc, type Doc, type DocNode } from '@/core/doc/model'
import { addNodes, updateNodes } from '@/core/doc/ops'
import { nerpaNode, start, terrainNode, workspaceJson } from '@/core/robotics/demo'
import { settleOnTerrain, standOnTerrain } from '@/core/robotics/field'
import { RoboWorld } from '@/core/robotics/world'
import { GROUND_HEIGHT } from '@/core/robotics/terrain'
import type { BlockJson } from '@/core/robotics/interpreter'

let bid = 0
const blk = (type: string, inputs: Record<string, unknown> = {}, fields: Record<string, unknown> = {}): BlockJson =>
  ({ type, id: `r${++bid}`, inputs, fields }) as BlockJson
const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const c = (i: number) => 150 + 300 * i
const put = (d: Doc, node: DocNode) => settleOnTerrain(d, standOnTerrain(addNodes(d, [node]), [node.id]))
const z = (d: Doc, id: string) => d.nodes.find((q) => q.id === id)!.transform.position[2]
const field = (): Doc => ({ ...emptyDoc(), scene: 'robo', nodes: [] })
const land = (d: Doc, kinds: ('grass' | 'water')[]) =>
  kinds.reduce((doc, k, i) => put(doc, terrainNode(k === 'water' ? 'water' : 'ground', c(i), c(0), 0, k, k === 'water' ? {} : { surface: 'grass' })), d)

describe('relief on the landscape', () => {
  it('a ramp, a platform and a bridge stand as high on water as on the grass', () => {
    let d = land(field(), ['grass', 'water', 'water', 'grass'])
    const r1 = terrainNode('ramp', c(1), c(0), 0, 'r1', { length: 1 })
    const p1 = terrainNode('platform', c(2), c(0), 0, 'p1')
    const p2 = terrainNode('platform', c(3), c(0), 0, 'p2')
    for (const node of [r1, p1, p2]) d = put(d, node)
    expect([z(d, r1.id), z(d, p1.id), z(d, p2.id)]).toEqual([GROUND_HEIGHT, GROUND_HEIGHT, GROUND_HEIGHT])
    // a long ramp half on water, half on grass: level too
    let e = land(field(), ['grass', 'water'])
    const r2 = terrainNode('ramp', c(0) + 150, c(0), 90, 'r2', { length: 2 })
    e = put(e, r2)
    expect(z(e, r2.id)).toBe(GROUND_HEIGHT)
  })

  it('one put on a pond before (a little lower) comes up to the landscape height when the field changes', () => {
    let d = land(field(), ['water', 'grass'])
    const p = terrainNode('platform', c(0), c(0), 0, 'p')
    d = put(d, p)
    // as an older file had it: on the water's level
    d = updateNodes(d, [p.id], (q) => ({ ...q, transform: { ...q.transform, position: [c(0), c(0), 7] } }))
    d = put(d, terrainNode('ground', c(2), c(0), 0, 'g', { surface: 'sand' }))
    expect(z(d, p.id)).toBe(GROUND_HEIGHT)
  })
})

describe('the cheetah on a ramp up to a platform', () => {
  const keep = (name: string, reporter: BlockJson) => blk('variables_set', { VALUE: { block: reporter } }, { VAR: { id: name } })
  const scene = (body: BlockJson[]) => {
    let d = land(field(), ['grass', 'grass', 'grass', 'grass', 'grass'])
    d = put(d, terrainNode('ramp', c(1) + 150, c(0), -90, 'r', { length: 2 }))
    d = put(d, terrainNode('platform', c(3), c(0), 0, 'p'))
    d = put(d, nerpaNode(c(0), c(0), 0, 'cheetah', workspaceJson([start(body)]), 'cheetah'))
    return RoboWorld.fromDoc(d)
  }

  it('"ledge ahead?" is false at the foot of the ramp, on it and where it meets the platform', () => {
    for (const cm of [10, 40, 60, 75]) {
      const w = scene([blk('nerpa_walk', { CM: n(cm) }), keep('ledge', blk('creature_ledge'))])
      w.run(8)
      expect(w.seals[0].program!.vars.get('ledge'), `after ${cm} cm`).toBe(false)
    }
  })

  it('a loop "run; if ledge ahead: jump" takes it up the ramp and across the platform', () => {
    const ifThen = (cond: BlockJson, body: BlockJson) => blk('robo_if', { COND: { block: cond }, DO: { block: body } })
    const step = blk('cheetah_run', { CM: n(10) })
    step.next = { block: ifThen(blk('creature_ledge'), blk('cheetah_leap')) }
    const w = scene([blk('robo_repeat', { TIMES: n(10), DO: { block: step } })])
    w.run(12)
    const s = w.seals[0].seal
    expect(s.x).toBeGreaterThan(c(3))
    expect(s.z).toBeCloseTo(GROUND_HEIGHT + 120, 0)
  })

  it('a platform with no ramp is still a ledge', () => {
    let d = land(field(), ['grass', 'grass', 'grass'])
    d = put(d, terrainNode('platform', c(2), c(0), 0, 'p'))
    d = put(d, nerpaNode(c(0), c(0), 0, 'cheetah', workspaceJson([start([blk('nerpa_walk', { CM: n(60) }), keep('ledge', blk('creature_ledge'))])]), 'cheetah'))
    const w = RoboWorld.fromDoc(d)
    w.run(6)
    expect(w.seals[0].program!.vars.get('ledge')).toBe(true)
  })
})
