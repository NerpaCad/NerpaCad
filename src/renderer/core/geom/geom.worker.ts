/// <reference lib="webworker" />
import Module from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { parse } from 'opentype.js'
import fontUrl from '../../assets/fonts/DejaVuSans-Bold.ttf?url'
import type { DocNode, MeshData } from '../doc/model'
import { GeomEngine, type MeshResult } from './engine'
import { type RobotSpec, registerRobot } from '../robotics/robot'

export type WorkerRequest =
  | { id: number; type: 'eval'; node: DocNode }
  | { id: number; type: 'export'; nodes: DocNode[] }
  | { id: number; type: 'meshes'; meshes: Record<string, MeshData> }
  | { id: number; type: 'robots'; robots: RobotSpec[] }

export type WorkerResponse =
  | { id: number; ok: true; result?: MeshResult & { skipped?: number } }
  | { id: number; ok: false; error: string }

const ctx = self as unknown as DedicatedWorkerGlobalScope

const ready: Promise<GeomEngine> = (async () => {
  const w = await Module({ locateFile: () => wasmUrl })
  w.setup()
  let font = null
  try {
    const buf = await (await fetch(fontUrl)).arrayBuffer()
    font = parse(buf)
  } catch (e) {
    console.error('font load failed', e)
  }
  return new GeomEngine(w, font)
})()

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data
  let engine: GeomEngine
  try {
    engine = await ready
  } catch (e) {
    ctx.postMessage({ id: msg.id, ok: false, error: String(e) } satisfies WorkerResponse)
    return
  }
  try {
    if (msg.type === 'robots') {
      // robots of the installed mods: their stand-in shapes have their sizes
      for (const r of msg.robots) registerRobot(r)
      ctx.postMessage({ id: msg.id, ok: true } satisfies WorkerResponse)
      return
    }
    if (msg.type === 'meshes') {
      engine.meshes = msg.meshes
      ctx.postMessage({ id: msg.id, ok: true } satisfies WorkerResponse)
      return
    }
    const result = msg.type === 'eval' ? engine.evaluate(msg.node) : engine.exportMesh(msg.nodes)
    ctx.postMessage({ id: msg.id, ok: true, result } satisfies WorkerResponse, [
      result.positions.buffer,
      result.indices.buffer
    ])
  } catch (e) {
    ctx.postMessage({ id: msg.id, ok: false, error: String(e) } satisfies WorkerResponse)
  }
}
