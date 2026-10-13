/** Page side of the sketch solver worker. The worker (and the WebAssembly solver) start on first use. */
import type { SolveRequest, SolveResponse } from './sketch.worker'
import type { DragTarget, SolveResult } from './solver'
import type { Sketch } from './types'
import SketchWorker from './sketch.worker?worker'

type Waiter = { resolve: (r: never) => void; reject: (e: Error) => void }
type Queued = { sketch: Sketch; drag: DragTarget[]; resolve: (r: SolveResult | null) => void; reject: (e: Error) => void }

export class SketchClient {
  private worker: Worker | null = null
  private nextId = 1
  private waiting = new Map<number, Waiter>()
  private dragBusy = false
  private dragQueued: Queued | null = null

  private get w(): Worker {
    if (!this.worker) {
      this.worker = new SketchWorker()
      this.worker.onmessage = (e: MessageEvent<SolveResponse>) => {
        const m = e.data
        const p = this.waiting.get(m.id)
        if (!p) return
        this.waiting.delete(m.id)
        if ('error' in m) p.reject(new Error(m.error))
        else if ('free' in m) (p.resolve as (r: string[] | null) => void)(m.free)
        else (p.resolve as (r: SolveResult) => void)(m.result)
      }
    }
    return this.worker
  }

  solve(sketch: Sketch, drag: DragTarget[] = []): Promise<SolveResult> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (r: never) => void, reject })
      this.w.postMessage({ id, sketch, drag } satisfies SolveRequest)
    })
  }

  /** Which points and curves can still move (null: not known). */
  free(sketch: Sketch): Promise<string[] | null> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (r: never) => void, reject })
      this.w.postMessage({ id, sketch, drag: [], free: true } satisfies SolveRequest)
    })
  }

  /**
   * For mouse drags: at most one request in flight and one waiting. A newer request replaces the
   * waiting one, which then resolves with null (skip it).
   */
  solveLatest(sketch: Sketch, drag: DragTarget[]): Promise<SolveResult | null> {
    return new Promise((resolve, reject) => {
      this.dragQueued?.resolve(null)
      this.dragQueued = { sketch, drag, resolve, reject }
      this.pump()
    })
  }

  private pump() {
    if (this.dragBusy || !this.dragQueued) return
    const q = this.dragQueued
    this.dragQueued = null
    this.dragBusy = true
    this.solve(q.sketch, q.drag)
      .then(q.resolve, q.reject)
      .finally(() => {
        this.dragBusy = false
        this.pump()
      })
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    for (const p of this.waiting.values()) p.reject(new Error('solver stopped'))
    this.waiting.clear()
  }
}

export const sketchSolver = new SketchClient()
