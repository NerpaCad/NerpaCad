/**
 * Plays the heroes' sounds during a run (Web Audio). A sound a hero starts again while it still
 * plays starts over (as in Scratch), so a loop without waits does not pile up noise; and no more
 * than MAX_VOICES sound at once. Pause suspends everything, Stop silences it.
 */
import { effect } from '@preact/signals'
import { type SoundSink, noteHz, soundSpec } from '../core/robotics/sounds'
import { simSpeed, simVolume } from '../core/robotics/state'

const FILES = import.meta.glob('../assets/sounds/*.ogg', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const URLS = new Map(Object.entries(FILES).map(([path, url]) => [path.replace(/^.*\/([^/]+)\.ogg$/, '$1'), url]))

const MAX_VOICES = 24

interface Voice {
  key: string
  source: string
  stop(): void
}

export class SoundPlayer implements SoundSink {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private buffers = new Map<string, Promise<AudioBuffer | null>>()
  private voices: Voice[] = []
  private unwatch: (() => void) | null = null
  /** counts Stops: a sound still being decoded when its sounds were stopped does not start */
  private stops = 0
  private sourceStops = new Map<string, number>()
  /** sounds asked for, and sounds that really started, since the run started (for the e2e checks) */
  played = 0
  started = 0

  private context(): { ctx: AudioContext; out: GainNode } | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext()
      } catch {
        return null
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      this.master = this.ctx.createGain()
      this.master.connect(this.ctx.destination)
      this.unwatch = effect(() => {
        const v = simVolume.value / 100
        if (this.master && this.ctx) this.master.gain.setTargetAtTime(v * v, this.ctx.currentTime, 0.02)
      })
    }
    return { ctx: this.ctx, out: this.master! }
  }

  private buffer(id: string): Promise<AudioBuffer | null> {
    let b = this.buffers.get(id)
    if (!b) {
      const url = URLS.get(id)
      const c = this.context()
      b =
        url && c
          ? fetch(url)
              .then((r) => r.arrayBuffer())
              .then((data) => c.ctx.decodeAudioData(data))
              .catch(() => null)
          : Promise.resolve(null)
      this.buffers.set(id, b)
    }
    return b
  }

  /** Decode every sound ahead so the first "play" is not late. */
  preload(): void {
    if (!this.context()) return
    for (const id of URLS.keys()) void this.buffer(id)
  }

  private add(v: Voice): void {
    for (const old of this.voices.filter((o) => o.key === v.key)) old.stop()
    this.voices = this.voices.filter((o) => o.key !== v.key)
    this.voices.push(v)
    while (this.voices.length > MAX_VOICES) this.voices.shift()!.stop()
  }

  private drop(v: Voice): void {
    this.voices = this.voices.filter((o) => o !== v)
  }

  play(id: string, volume: number, source: string): void {
    if (!soundSpec(id) || volume <= 0) return
    const c = this.context()
    if (!c) return
    this.played++
    const asked = c.ctx.currentTime
    const stops = this.stops
    const mine = this.sourceStops.get(source) ?? 0
    void this.buffer(id).then((buf) => {
      // a sound decoded after a Stop (or very late: a slow first load) is not played any more
      if (!buf || !this.ctx || this.stops !== stops || (this.sourceStops.get(source) ?? 0) !== mine) return
      if (c.ctx.currentTime - asked > 1.5) return
      const node = c.ctx.createBufferSource()
      node.buffer = buf
      const g = c.ctx.createGain()
      g.gain.value = volume
      node.connect(g).connect(c.out)
      const v: Voice = {
        key: `${source}:${id}`,
        source,
        stop: () => {
          try {
            node.stop()
          } catch {
            /* already stopped */
          }
        }
      }
      node.onended = () => this.drop(v)
      this.add(v)
      node.start()
      this.started++
    })
  }

  note(midi: number, seconds: number, volume: number, source: string): void {
    if (volume <= 0 || seconds <= 0) return
    const c = this.context()
    if (!c) return
    this.played++
    const { ctx, out } = c
    // the run's seconds are faster or slower than real ones when the speed is changed
    const len = Math.max(0.05, seconds / Math.max(0.1, simSpeed.peek()))
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = noteHz(midi)
    const g = ctx.createGain()
    const peak = 0.5 * volume
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + 0.01)
    g.gain.setTargetAtTime(peak * 0.6, t0 + 0.01, 0.15)
    g.gain.setTargetAtTime(0, t0 + Math.max(0.02, len - 0.06), 0.02)
    osc.connect(g).connect(out)
    const v: Voice = {
      key: `${source}:note:${t0}`,
      source,
      stop: () => {
        try {
          osc.stop()
        } catch {
          /* already stopped */
        }
      }
    }
    osc.onended = () => this.drop(v)
    this.add(v)
    osc.start(t0)
    this.started++
    osc.stop(t0 + len + 0.1)
  }

  stop(source?: string): void {
    if (source) this.sourceStops.set(source, (this.sourceStops.get(source) ?? 0) + 1)
    else this.stops++
    for (const v of this.voices) if (!source || v.source === source) v.stop()
    this.voices = source ? this.voices.filter((v) => v.source !== source) : []
  }

  /** 'running', 'suspended'… or 'none' before the first sound */
  get state(): string {
    return this.ctx?.state ?? 'none'
  }

  pause(): void {
    void this.ctx?.suspend()
  }

  resume(): void {
    void this.ctx?.resume()
  }

  /** The run is over: silence (the decoded sounds stay for the next run). */
  end(): void {
    this.stop()
    this.played = 0
    this.started = 0
    this.resume()
  }

  dispose(): void {
    this.stop()
    this.unwatch?.()
    void this.ctx?.close()
    this.ctx = null
  }
}

/** The app's one player. */
export const soundPlayer = new SoundPlayer()
