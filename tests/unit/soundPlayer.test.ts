/** The sound player (stage 8 review): a sound still loading when the run stops does not start after it. */
import { beforeEach, describe, expect, it } from 'vitest'

let decoded: (() => void)[] = []
class FakeAudio {
  state = 'running'
  currentTime = 0
  destination = {}
  createGain() {
    return { gain: { value: 1, setTargetAtTime() {} }, connect: (x: unknown) => x }
  }
  createBufferSource() {
    return { buffer: null, connect: (x: unknown) => x, start() {}, stop() {}, onended: null }
  }
  decodeAudioData() {
    return new Promise((r) => decoded.push(() => r({})))
  }
  resume() {
    return Promise.resolve()
  }
  suspend() {
    return Promise.resolve()
  }
  close() {
    return Promise.resolve()
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('sound player', () => {
  beforeEach(() => {
    decoded = []
    const g = globalThis as unknown as Record<string, unknown>
    g.AudioContext = FakeAudio
    g.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(1) })
  })

  it('plays a sound once it is loaded; one still loading at Stop never starts', async () => {
    const { SoundPlayer } = await import('@/view/soundPlayer')
    const p = new SoundPlayer()
    p.play('seal_bark', 1, 'seal')
    await flush()
    decoded.forEach((d) => d())
    await flush()
    expect(p.started).toBe(1)
    // another sound, stopped (the run ended) before it was loaded
    p.play('seal_roar', 1, 'seal')
    await flush()
    p.end()
    decoded.forEach((d) => d())
    await flush()
    expect(p.started).toBe(0)
    // "stop sounds" of one hero cancels its sound still loading, not the others'
    p.play('jump', 1, 'seal')
    p.play('jump', 1, 'cat')
    await flush()
    p.stop('seal')
    decoded.forEach((d) => d())
    await flush()
    expect(p.started).toBe(1)
  })
})
