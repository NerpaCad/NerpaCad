/**
 * Runs the constraint solver off the page. PlaneGCS's bindings generate code at load time,
 * which the page's Content-Security-Policy (no 'unsafe-eval') forbids; a worker has its own,
 * empty policy.
 */
import wasmUrl from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url'
import { type DragTarget, type SolveResult, createSolver } from './solver'
import type { Sketch } from './types'

export interface SolveRequest {
  id: number
  sketch: Sketch
  drag: DragTarget[]
  /** instead of solving: which points and curves are still free */
  free?: boolean
}
export type SolveResponse = { id: number; result: SolveResult } | { id: number; free: string[] | null } | { id: number; error: string }

const solver = createSolver(wasmUrl)

self.onmessage = async (e: MessageEvent<SolveRequest>) => {
  const { id, sketch, drag, free } = e.data
  let msg: SolveResponse
  try {
    msg = free ? { id, free: (await solver).free(sketch) } : { id, result: (await solver).solve(sketch, drag) }
  } catch (err) {
    msg = { id, error: err instanceof Error ? err.message : String(err) }
  }
  ;(self as unknown as Worker).postMessage(msg)
}
