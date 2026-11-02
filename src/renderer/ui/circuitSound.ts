/**
 * Buzzers of a running circuit, heard through the speakers: one square-wave oscillator per
 * sounding buzzer, at its pitch. Quiet on purpose (a real piezo is shrill).
 */
let ctx: AudioContext | null = null
const voices = new Map<string, { osc: OscillatorNode; gain: GainNode; freq: number }>()
const VOLUME = 0.04

function audio(): AudioContext | null {
  if (ctx) return ctx
  try {
    ctx = new AudioContext()
  } catch {
    ctx = null
  }
  return ctx
}

/** What sounds now: buzzer id → pitch, Hz. Buzzers not in it fall silent. */
export function buzz(now: Record<string, number>): void {
  for (const [id, v] of voices) {
    if (now[id] !== undefined) continue
    v.gain.gain.setTargetAtTime(0, v.osc.context.currentTime, 0.01)
    v.osc.stop(v.osc.context.currentTime + 0.05)
    voices.delete(id)
  }
  const ids = Object.keys(now)
  if (!ids.length) return
  const a = audio()
  if (!a) return
  for (const id of ids) {
    const f = now[id]
    const v = voices.get(id)
    if (v) {
      if (v.freq !== f) {
        v.osc.frequency.setValueAtTime(f, a.currentTime)
        v.freq = f
      }
      continue
    }
    const osc = a.createOscillator()
    osc.type = 'square'
    osc.frequency.value = f
    const gain = a.createGain()
    gain.gain.value = 0
    gain.gain.setTargetAtTime(VOLUME, a.currentTime, 0.01)
    osc.connect(gain).connect(a.destination)
    osc.start()
    voices.set(id, { osc, gain, freq: f })
  }
}

/** Everything quiet (the run stopped). */
export function silence(): void {
  buzz({})
}

/** What is sounding (for the tests): buzzer id → Hz. */
export const sounding = (): Record<string, number> => Object.fromEntries([...voices].map(([id, v]) => [id, v.freq]))
