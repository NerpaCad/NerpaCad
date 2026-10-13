import { signal } from '@preact/signals'
import type { DocNode, MeshData } from '../doc/model'
import type { RobotSpec } from '../robotics/robot'
import { type MeshResult, geomKey } from './engine'
import type { WorkerRequest, WorkerResponse } from './geom.worker'
import GeomWorker from './geom.worker?worker'

type Result = MeshResult & { skipped?: number }
type Pending = { resolve: (r: Result | undefined) => void; reject: (e: Error) => void }
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/** Main-thread side of the geometry worker, with a result cache keyed by geometry. */
export class GeomClient {
  /** Bumped whenever new geometry arrives, so the view can re-sync. */
  readonly revision = signal(0)
  /** Number of requests in flight (for a "calculating…" indicator). */
  readonly busy = signal(0)
  readonly lastError = signal<string | null>(null)

  private worker = new GeomWorker()
  private nextId = 1
  private pending = new Map<number, Pending>()
  private results = new Map<string, MeshResult>()
  private inflight = new Map<string, Promise<MeshResult>>()
  private sentMeshes: Record<string, MeshData> | null = null
  private readonly maxResults = 400

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const r = ev.data
      const p = this.pending.get(r.id)
      if (!p) return
      this.pending.delete(r.id)
      if (r.ok) p.resolve(r.result)
      else p.reject(new Error(r.error))
    }
  }

  private send(req: DistributiveOmit<WorkerRequest, 'id'>): Promise<Result | undefined> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...req, id } as WorkerRequest)
    })
  }

  /** The robots of the installed mods (sent before anything is built, see `initMods`). */
  setRobots(robots: RobotSpec[]): void {
    void this.send({ type: 'robots', robots })
  }

  setMeshes(meshes: Record<string, MeshData>): void {
    if (meshes === this.sentMeshes) return
    this.sentMeshes = meshes
    void this.send({ type: 'meshes', meshes })
  }

  /** Cached result for this node's current geometry, if already computed. */
  peek(node: DocNode): MeshResult | undefined {
    return this.results.get(geomKey(node))
  }

  peekKey(key: string): MeshResult | undefined {
    return this.results.get(key)
  }

  request(node: DocNode): Promise<MeshResult> {
    const key = geomKey(node)
    const done = this.results.get(key)
    if (done) return Promise.resolve(done)
    const running = this.inflight.get(key)
    if (running) return running
    this.busy.value++
    const pr = this.send({ type: 'eval', node })
      .then((r) => {
        const res = r!
        this.results.set(key, res)
        if (res.error) this.lastError.value = res.error
        this.trim()
        this.revision.value++
        return res
      })
      .catch((e: Error) => {
        this.lastError.value = e.message
        throw e
      })
      .finally(() => {
        this.inflight.delete(key)
        this.busy.value--
      })
    this.inflight.set(key, pr)
    return pr
  }

  async exportMesh(nodes: DocNode[]): Promise<Result> {
    this.busy.value++
    try {
      return (await this.send({ type: 'export', nodes }))!
    } finally {
      this.busy.value--
    }
  }

  private trim(): void {
    while (this.results.size > this.maxResults) {
      this.results.delete(this.results.keys().next().value as string)
    }
  }
}

export const geom = new GeomClient()
