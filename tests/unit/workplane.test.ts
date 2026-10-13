import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import { frameAxes, frameFromHit, frameMatrix } from '@/core/doc/workplane'
import { addNodes, alignNodes, dropToWorkplane, mirrorNodes, rotateNodes } from '@/core/doc/ops'
import { emptyDoc, transformMatrix } from '@/core/doc/model'
import { prim } from './helpers'

const close = (a: Vector3, b: Vector3, eps = 1e-6) => expect(a.distanceTo(b)).toBeLessThan(eps)

describe('workplane frames', () => {
  const normals = [
    new Vector3(0, 0, 1),
    new Vector3(0, 0, -1),
    new Vector3(1, 0, 0),
    new Vector3(0.7071068, -0.7071068, 0),
    new Vector3(0.3, -0.5, 0.8).normalize()
  ]
  it.each(normals.map((n, i) => [i, n] as const))('frame %i is orthonormal with Z = normal', (_i, n) => {
    const f = frameFromHit(new Vector3(5, -3, 12), n)
    const [x, y, z] = frameAxes(f)
    close(z, n, 1e-5)
    expect(Math.abs(x.dot(y))).toBeLessThan(1e-6)
    expect(Math.abs(x.dot(z))).toBeLessThan(1e-6)
    close(x.clone().cross(y), z, 1e-5) // right-handed
    const m = frameMatrix(f)
    close(new Vector3().setFromMatrixPosition(m), new Vector3(5, -3, 12))
  })

  it('side faces keep the grid level: frame X is horizontal', () => {
    const [x] = frameAxes(frameFromHit(new Vector3(), new Vector3(0.6, -0.8, 0)))
    expect(Math.abs(x.z)).toBeLessThan(1e-6)
  })
})

describe('operations along any axis', () => {
  it('rotate around an arbitrary axis matches the rotation matrix', () => {
    const a = prim('box')
    const d = addNodes(emptyDoc(), [a])
    const axis = new Vector3(1, 1, 0).normalize()
    const r = rotateNodes(d, [a.id], [axis.x, axis.y, axis.z], 90, [0, 0, 0])
    const want = new Matrix4().makeRotationAxis(axis, Math.PI / 2).multiply(transformMatrix(a.transform)).elements
    transformMatrix(r.nodes[0].transform).elements.forEach((v, i) => expect(v).toBeCloseTo(want[i], 5))
  })

  it('mirror across a tilted plane equals the reflected world matrix', () => {
    const a = { ...prim('wedge'), transform: { position: [3, 4, 1] as [number, number, number], rotation: [20, 10, 30] as [number, number, number], scale: [1, 2, 1] as [number, number, number] } }
    const n = new Vector3(0.3, -0.5, 0.8).normalize()
    const c = new Vector3(2, 1, 0)
    const d = mirrorNodes(addNodes(emptyDoc(), [a]), [a.id], [n.x, n.y, n.z], [c.x, c.y, c.z])
    const F = new Matrix4().set(
      1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, 0,
      -2 * n.y * n.x, 1 - 2 * n.y * n.y, -2 * n.y * n.z, 0,
      -2 * n.z * n.x, -2 * n.z * n.y, 1 - 2 * n.z * n.z, 0,
      0, 0, 0, 1
    )
    const want = new Matrix4().makeTranslation(c.x, c.y, c.z).multiply(F).multiply(new Matrix4().makeTranslation(-c.x, -c.y, -c.z)).multiply(transformMatrix(a.transform)).elements
    transformMatrix(d.nodes[0].transform).elements.forEach((v, i) => expect(v).toBeCloseTo(want[i], 5))
  })

  it('align and drop move along the given workplane axes', () => {
    const a = prim('box')
    const b = { ...prim('box'), transform: { ...prim('box').transform, position: [0, 0, 0] as [number, number, number] } }
    const d = addNodes(emptyDoc(), [a, b])
    const dirs: [[number, number, number], [number, number, number], [number, number, number]] = [[0, 1, 0], [-1, 0, 0], [0, 0, 1]]
    const boxes = { [a.id]: { min: [0, 0, 0] as [number, number, number], max: [10, 10, 10] as [number, number, number] }, [b.id]: { min: [20, 0, 0] as [number, number, number], max: [30, 10, 10] as [number, number, number] } }
    const r = alignNodes(d, [a.id, b.id], 0, 'min', boxes, dirs)
    // b moves -20 along workplane X, which is world +Y
    expect(r.nodes[1].transform.position).toEqual([0, -20, 0])
    const dropped = dropToWorkplane(d, [a.id], { [a.id]: { min: [0, 0, 5], max: [1, 1, 6] } }, [1, 0, 0])
    expect(dropped.nodes[0].transform.position).toEqual([-5, 0, 0])
  })
})
