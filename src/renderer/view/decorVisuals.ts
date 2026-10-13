/**
 * Little low-poly models of the field's scenery (see core/robotics/decor.ts): a leafy tree, a fir,
 * a bush, a rock and a patch of flowers. Built from a few simple shapes with flat shading, in
 * the node's frame (standing on z = 0). Shapes and colours are shared by all copies.
 */
import {
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry
} from 'three'
import type { DecorKind } from '../core/doc/model'
import { keep, noPick } from './roboVisuals'

const mat = (color: string, roughness = 0.85) => keep(new MeshStandardMaterial({ color, roughness, metalness: 0, flatShading: true }))
const M = {
  bark: mat('#8a5a34'),
  leaf: mat('#4f9a3a'),
  leafLight: mat('#6cb84a'),
  fir: mat('#2f7a45'),
  firDark: mat('#276a3b'),
  bush: mat('#4a9136'),
  rock: mat('#9a9c9f', 0.95),
  rockDark: mat('#85878b', 0.95),
  stem: mat('#3f8a33'),
  petals: ['#ff5a5f', '#ffd23f', '#ffffff', '#b07cff', '#ff8fc8'].map((c) => mat(c, 0.6)),
  centre: mat('#f2b134', 0.6)
}

const G = {
  trunk: keep(new CylinderGeometry(12, 17, 140, 7)),
  crown: keep(new IcosahedronGeometry(1, 0)),
  firTrunk: keep(new CylinderGeometry(9, 12, 50, 6)),
  cone: keep(new ConeGeometry(1, 1, 8)),
  ball: keep(new IcosahedronGeometry(1, 1)),
  rock: keep(new DodecahedronGeometry(1, 0)),
  stem: keep(new CylinderGeometry(1.4, 1.6, 1, 4)),
  bloom: keep(new SphereGeometry(1, 6, 4))
}

function part(geo: (typeof G)[keyof typeof G], m: MeshStandardMaterial, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, rz = 0): Mesh {
  const o = new Mesh(geo, m)
  o.position.set(x, y, z)
  o.scale.set(sx, sy, sz)
  o.rotation.z = rz
  o.castShadow = true
  o.receiveShadow = true
  return o
}

/** Upright: three.js cylinders and cones stand along Y; the field's up is Z. */
function upright(o: Mesh): Mesh {
  o.rotation.x = Math.PI / 2
  return o
}

function tree(): Group {
  const g = new Group()
  g.add(upright(part(G.trunk, M.bark, 0, 0, 70, 1)))
  g.add(part(G.crown, M.leaf, 0, 0, 200, 72, 72, 66, 0.3))
  g.add(part(G.crown, M.leafLight, 30, -20, 238, 48, 48, 44, 1.1))
  g.add(part(G.crown, M.leaf, -34, 22, 176, 46, 46, 40, 2.2))
  return g
}

function pine(): Group {
  const g = new Group()
  g.add(upright(part(G.firTrunk, M.bark, 0, 0, 25, 1)))
  const tiers: [number, number, number, MeshStandardMaterial][] = [
    [70, 110, 90, M.firDark],
    [56, 95, 160, M.fir],
    [40, 80, 225, M.firDark]
  ]
  for (const [r, h, z, m] of tiers) g.add(upright(part(G.cone, m, 0, 0, z, r, h, r)))
  return g
}

function bush(): Group {
  const g = new Group()
  g.add(part(G.ball, M.bush, 0, 0, 38, 46, 46, 40))
  g.add(part(G.ball, M.leafLight, 28, 14, 30, 30, 30, 28))
  g.add(part(G.ball, M.bush, -26, 18, 28, 30, 30, 27))
  g.add(part(G.ball, M.leaf, 6, -28, 26, 28, 28, 25))
  return g
}

function rock(): Group {
  const g = new Group()
  g.add(part(G.rock, M.rock, 0, 0, 22, 44, 36, 30, 0.4))
  g.add(part(G.rock, M.rockDark, 30, 18, 10, 18, 16, 13, 1.3))
  return g
}

function flowers(): Group {
  const g = new Group()
  // a little meadow: stems with round blooms around the middle
  const spots: [number, number, number][] = [
    [0, 0, 34],
    [24, 10, 28],
    [-20, 16, 30],
    [10, -24, 26],
    [-14, -18, 32],
    [32, -14, 24],
    [-32, -4, 27]
  ]
  spots.forEach(([x, y, h], i) => {
    g.add(upright(part(G.stem, M.stem, x, y, h / 2, 1, h, 1)))
    g.add(part(G.bloom, M.petals[i % M.petals.length], x, y, h + 3, 6.5, 6.5, 4.5))
    g.add(part(G.bloom, M.centre, x, y, h + 6.5, 2.4))
  })
  g.add(part(G.ball, M.leafLight, 0, 0, 3, 38, 38, 5))
  // big enough to be seen from across the field
  g.scale.setScalar(1.5)
  return g
}

const BUILD: Record<DecorKind, () => Group> = { tree, pine, bush, rock, flowers }

/** The model of a piece of scenery (not clickable: the node's stand-in shape is). */
export function decorVisual(kind: DecorKind): Group {
  const g = (BUILD[kind] ?? tree)()
  g.name = 'decor-visual'
  noPick(g)
  return g
}
