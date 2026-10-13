import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { Batcher } from '@/view/batcher'

const geo = new BoxGeometry(1, 1, 1)
const a = new MeshBasicMaterial()
const b = new MeshBasicMaterial()

/** a "tile" visual at x: two parts sharing the geometry, one material each */
function tile(x: number, mat2 = b): Group {
  const g = new Group()
  g.position.x = x
  const top = new Mesh(geo, a)
  top.position.z = 2
  g.add(top, new Mesh(geo, mat2))
  return g
}

describe('instanced drawing of tiles and scenery', () => {
  it('one instanced mesh per (geometry, material); the copies’ own meshes are hidden; positions kept', () => {
    const root = new Group()
    const batcher = new Batcher()
    root.add(batcher.group)
    const tiles = [tile(0), tile(300), tile(600)]
    for (const t of tiles) root.add(t)
    batcher.rebuild(tiles)
    expect(batcher.size).toBe(2)
    const meshes = batcher.group.children as Mesh[] & { count: number }[]
    expect(meshes.map((m) => (m as unknown as { count: number }).count)).toEqual([3, 3])
    for (const t of tiles) t.traverse((o) => o instanceof Mesh && expect(o.visible).toBe(false))
    // the second copy's top: at x 300, z 2
    const m = new Matrix4()
    ;(meshes[0] as unknown as { getMatrixAt(i: number, m: Matrix4): void }).getMatrixAt(1, m)
    expect(new Vector3().setFromMatrixPosition(m).toArray()).toEqual([300, 0, 2])
  })

  it('fewer copies reuse the same instanced mesh; a material no longer used is dropped; hidden nodes are left out', () => {
    const root = new Group()
    const batcher = new Batcher()
    root.add(batcher.group)
    const tiles = [tile(0), tile(300)]
    for (const t of tiles) root.add(t)
    batcher.rebuild(tiles)
    const first = batcher.group.children[0]
    batcher.rebuild([tiles[0]])
    expect(batcher.group.children[0]).toBe(first)
    const other = tile(900, new MeshBasicMaterial())
    root.add(other)
    batcher.rebuild([other])
    // a's mesh is reused, b's goes, the new material gets its own
    expect(batcher.size).toBe(2)
    other.visible = false
    batcher.rebuild([other])
    expect(batcher.size).toBe(0)
  })
})
