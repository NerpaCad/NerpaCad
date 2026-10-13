/**
 * Scenery for the robotics field: trees, firs, bushes, rocks and flowers. They stand on whatever
 * surface is under them (the floor, a landscape tile, a platform) and — all but the flowers —
 * block the way: robots and actors stop at them, the sonar sees them, the bumper presses on them.
 * For the walking rules each is a round solid post (its trunk, its whole bush or rock); the view
 * shows the real little model.
 */
import type { DecorKind, Doc, DocNode, PrimNode } from '../doc/model'
import type { PlacedTerrain } from './terrain'

export const DECOR_KINDS: DecorKind[] = ['tree', 'pine', 'bush', 'rock', 'flowers']

export interface DecorSpec {
  /** overall height and radius of the model, mm */
  height: number
  radius: number
  /** radius of the part that blocks the way (0: it can be driven over) */
  block: number
}

export const DECOR: Record<DecorKind, DecorSpec> = {
  // a robot (58 mm) and the seal (100 mm) pass under the crown; the trunk stops them
  tree: { height: 300, radius: 85, block: 20 },
  pine: { height: 280, radius: 70, block: 55 },
  bush: { height: 85, radius: 60, block: 52 },
  rock: { height: 55, radius: 50, block: 44 },
  flowers: { height: 60, radius: 65, block: 0 }
}

export const decorSpec = (k: DecorKind | undefined): DecorSpec => DECOR[k && DECOR_KINDS.includes(k) ? k : 'tree']

const isDecor = (n: DocNode): n is PrimNode => n.kind === 'prim' && n.prim === 'decor'

/** The scenery that blocks the way, as round posts from what it stands on up to its top. */
export function postsOf(doc: Doc): PlacedTerrain[] {
  const out: PlacedTerrain[] = []
  for (const n of doc.nodes) {
    if (!isDecor(n)) continue
    const s = decorSpec(n.params.decor?.kind)
    if (!s.block) continue
    const [x, y, z] = n.transform.position
    const decor = n.params.decor?.kind && DECOR_KINDS.includes(n.params.decor.kind) ? n.params.decor.kind : 'tree'
    out.push({ id: n.id, kind: 'post', decor, x, y, angle: 0, base: Math.max(0, z), height: s.height, length: 1, radius: s.block })
  }
  return out
}
