import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Module from 'manifold-3d'
import { parse } from 'opentype.js'
import { GeomEngine } from '@/core/geom/engine'
import type { DocNode, PrimNode, PrimType } from '@/core/doc/model'
import { identityTransform, newId } from '@/core/doc/model'

let enginePromise: Promise<GeomEngine> | null = null

export function getEngine(): Promise<GeomEngine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const w = await Module()
      w.setup()
      const buf = readFileSync(resolve(__dirname, '../../src/renderer/assets/fonts/DejaVuSans-Bold.ttf'))
      const font = parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      return new GeomEngine(w, font)
    })()
  }
  return enginePromise
}

export function prim(type: PrimType, over: Partial<PrimNode> = {}): PrimNode {
  return {
    id: newId(),
    kind: 'prim',
    prim: type,
    name: type,
    color: '#ff0000',
    isHole: false,
    params: type === 'text' ? { text: 'Привет' } : {},
    transform: identityTransform(),
    ...over
  }
}

export function at(n: DocNode, x: number, y: number, z: number): DocNode {
  return { ...n, transform: { ...n.transform, position: [x, y, z] } }
}
