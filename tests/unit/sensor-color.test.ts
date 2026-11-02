/** The line sensor sees how light a painted platform or a static shape is. */
import { describe, expect, it } from 'vitest'
import { emptyDoc, type Doc, type DocNode, type PrimNode } from '@/core/doc/model'
import { robotNode, terrainNode } from '@/core/robotics/demo'
import { RoboWorld } from '@/core/robotics/world'
import { colorLight } from '@/core/robotics/sensors'

const field = (nodes: DocNode[], meshes: Doc['meshes'] = {}): Doc => ({ ...emptyDoc(), scene: 'robo', nodes, meshes })
/** a robot standing still with a line sensor on its front pad */
const looker = (x: number, y: number, z = 0): PrimNode => {
  const r = robotNode(x, y, 0, 'R')
  r.params.robot!.sensors = [{ port: 2, type: 'line' }]
  r.transform.position[2] = z
  return r
}
const reading = (d: Doc) => RoboWorld.fromDoc(d).robots[0].readings.get(2)

describe('the line sensor on painted surfaces', () => {
  it('colour brightness: black 0, white 1, yellow light, dark blue dark', () => {
    expect(colorLight('#000000')).toBe(0)
    expect(colorLight('#ffffff')).toBe(1)
    expect(colorLight('#ffd60a')).toBeGreaterThan(0.75)
    expect(colorLight('#13315c')).toBeLessThan(0.2)
    expect(colorLight('rgb(1,2,3)')).toBe(1)
  })

  it('reads a dark platform dark and a light one light; the bare floor stays white', () => {
    const dark = { ...terrainNode('platform', 150, 150, 0, 'p'), color: '#13315c' }
    const light = { ...terrainNode('platform', 150, 150, 0, 'p'), color: '#fcee0a' }
    expect(reading(field([dark, looker(150, 150, 120)]))).toBeLessThan(25)
    expect(reading(field([light, looker(150, 150, 120)]))).toBeGreaterThan(75)
    expect(reading(field([dark, looker(1050, 150)]))).toBe(100)
  })

  it('reads a static shape by its colour too', () => {
    const v: number[] = []
    for (let i = 0; i < 8; i++) v.push(i & 1 ? 200 : -200, i & 2 ? 200 : -200, i & 4 ? 10 : 0)
    const tri = [0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5]
    const plate: PrimNode = {
      id: 'plate',
      kind: 'prim',
      prim: 'mesh',
      name: 'plate',
      color: '#202020',
      isHole: false,
      fixed: true,
      params: { meshId: 'm' },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
    }
    expect(reading(field([plate, looker(0, 0, 10)], { m: { vertices: v, triangles: tri } }))).toBeLessThan(20)
  })
})
