import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { emptyDoc, type Species } from '@/core/doc/model'
import { nerpaNode, robotNode, start, workspaceJson } from '@/core/robotics/demo'
import { RoboWorld } from '@/core/robotics/world'
import { type BlockJson, Program } from '@/core/robotics/interpreter'
import { DEFAULT_TEMPO, SOUNDS, type SoundSink, noteHz, soundSpec, soundsFor } from '@/core/robotics/sounds'
import ru from '@/i18n/ru.json'
import en from '@/i18n/en.json'
import zh from '@/i18n/zh.json'

const DIR = join(__dirname, '../../src/renderer/assets/sounds')

/** length of an Ogg Vorbis file: the last page's granule position over the sample rate */
function oggSeconds(file: string): number {
  const b = readFileSync(file)
  const id = b.indexOf(Buffer.from('\x01vorbis', 'latin1'))
  const rate = b.readUInt32LE(id + 12)
  const last = b.lastIndexOf(Buffer.from('OggS', 'latin1'))
  return Number(b.readBigUInt64LE(last + 6)) / rate
}

let bid = 0
const blk = (type: string, inputs: Record<string, unknown> = {}, fields: Record<string, unknown> = {}): BlockJson =>
  ({ type, id: `s${++bid}`, inputs, fields }) as BlockJson
const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const chain = (list: BlockJson[]): BlockJson | undefined => {
  for (let i = list.length - 2; i >= 0; i--) list[i].next = { block: list[i + 1] }
  return list[0]
}
const program = (body: BlockJson[]) => ({ blocks: { blocks: [{ type: 'robo_start', id: 'h', next: { block: chain(body) } }] } })

interface Heard {
  kind: 'play' | 'note' | 'stop'
  id?: string
  midi?: number
  seconds?: number
  volume?: number
  at: number
}
/** a program with a sink that writes down what it was asked to play, and when */
function run(body: BlockJson[], seconds: number) {
  const heard: Heard[] = []
  const p = new Program(program(body), {
    sound: {
      play: (id, volume) => heard.push({ kind: 'play', id, volume, at: p.time }),
      note: (midi, s, volume) => heard.push({ kind: 'note', midi, seconds: s, volume, at: p.time }),
      stopAll: () => heard.push({ kind: 'stop', at: p.time })
    }
  })
  const dt = 1 / 60
  for (let i = 0; i < Math.round(seconds / dt); i++) p.tick(dt)
  return { heard, p }
}

describe('the sound set', () => {
  it('every sound has its file, and the length written down is the file’s', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.ogg'))
    expect(files.sort()).toEqual(SOUNDS.map((s) => `${s.id}.ogg`).sort())
    for (const s of SOUNDS) expect(oggSeconds(join(DIR, `${s.id}.ogg`))).toBeCloseTo(s.dur, 1)
  })

  it('each hero hears its own voices first, then the common sounds — never another hero’s', () => {
    for (const sp of ['seal', 'cheetah', 'pigeon'] as Species[]) {
      const list = soundsFor(sp)
      const own = list.filter((s) => s.species)
      expect(own.length).toBeGreaterThanOrEqual(3)
      expect(own.every((s) => s.species === sp)).toBe(true)
      expect(list.slice(0, own.length)).toEqual(own)
      expect(list.filter((s) => !s.species).length).toBeGreaterThanOrEqual(8)
    }
  })

  it('every sound has a name in all three languages', () => {
    for (const s of SOUNDS) for (const l of [ru, en, zh] as Record<string, string>[]) expect(l[`snd.${s.id}`]).toBeTruthy()
  })

  it('notes are tuned to A = 440 Hz', () => {
    expect(noteHz(69)).toBeCloseTo(440)
    expect(noteHz(60)).toBeCloseTo(261.63, 1)
  })
})

describe('sound blocks', () => {
  it('"play" goes on at once, "play until done" waits the sound out', () => {
    const { heard } = run(
      [
        blk('sound_play', {}, { SOUND: 'seal_bark' }),
        blk('sound_play_wait', {}, { SOUND: 'cheetah_purr' }),
        blk('sound_play', {}, { SOUND: 'bell' })
      ],
      4
    )
    expect(heard.map((h) => h.id)).toEqual(['seal_bark', 'cheetah_purr', 'bell'])
    expect(heard[1].at).toBeCloseTo(heard[0].at, 5)
    expect(heard[2].at - heard[1].at).toBeCloseTo(soundSpec('cheetah_purr')!.dur, 1)
  })

  it('a note lasts its beats at the tempo; the tempo can be changed', () => {
    const { heard } = run(
      [
        blk('sound_note', { NOTE: n(60), BEATS: n(1) }),
        blk('sound_tempo', { BPM: n(120) }),
        blk('sound_note', { NOTE: { shadow: { type: 'sound_note_pick', fields: { NOTE: '64' } } }, BEATS: n(1) }),
        blk('sound_rest', { BEATS: n(2) }),
        blk('sound_play', {}, { SOUND: 'click' })
      ],
      5
    )
    expect(DEFAULT_TEMPO).toBe(60)
    expect(heard[0]).toMatchObject({ kind: 'note', midi: 60, seconds: 1 })
    expect(heard[1]).toMatchObject({ kind: 'note', midi: 64, seconds: 0.5 })
    expect(heard[1].at - heard[0].at).toBeCloseTo(1, 1)
    // 1 beat at 120 + a rest of 2 beats at 120 = 1.5 s
    expect(heard[2].at - heard[1].at).toBeCloseTo(1.5, 1)
  })

  it('the volume is set, changed, kept within 0…100 % and passed with every sound', () => {
    const v = { id: 'vol' }
    const { heard, p } = run(
      [
        blk('sound_volume', { PERCENT: n(50) }),
        blk('sound_play', {}, { SOUND: 'drum' }),
        blk('sound_change_volume', { DELTA: n(80) }),
        blk('sound_play', {}, { SOUND: 'drum' }),
        blk('sound_change_volume', { DELTA: n(-130) }),
        blk('variables_set', { VALUE: { block: blk('sound_volume_get') } }, { VAR: v })
      ],
      0.2
    )
    expect(heard.map((h) => h.volume)).toEqual([0.5, 1])
    expect(p.volume).toBe(0)
    expect(p.vars.get('vol')).toBe(0)
  })

  it('"stop all sounds" reaches the player', () => {
    const { heard } = run([blk('sound_play', {}, { SOUND: 'pew' }), blk('sound_stop')], 0.2)
    expect(heard.map((h) => h.kind)).toEqual(['play', 'stop'])
  })

  it('a silent run waits just as long (tests and the field without a player)', () => {
    const p = new Program(program([blk('sound_play_wait', {}, { SOUND: 'pigeon_coo' }), blk('sound_note', { NOTE: n(70), BEATS: n(0.5) })]), {})
    for (let i = 0; i < 60; i++) p.tick(1 / 60)
    expect(p.finished).toBe(false)
    // 1.49 s + half a beat at 60 = 1.99 s (counted from the first tick)
    for (let i = 0; i < 58; i++) p.tick(1 / 60)
    expect(p.finished).toBe(false)
    for (let i = 0; i < 4; i++) p.tick(1 / 60)
    expect(p.finished).toBe(true)
  })
})

describe('sounds on the field', () => {
  it('heroes’ sounds go to the world’s player, each with its hero; the robot has no sound', () => {
    const got: string[] = []
    const sink: SoundSink = {
      play: (id, _v, src) => got.push(`${src}:${id}`),
      note: (m, _s, _v, src) => got.push(`${src}:note${m}`),
      stop: (src) => got.push(`stop:${src ?? 'all'}`)
    }
    const pigeon = nerpaNode(0, 0, 0, 'Г', workspaceJson([start([blk('sound_play', {}, { SOUND: 'pigeon_coo' }), blk('sound_stop')])]), 'pigeon')
    const robot = robotNode(400, 0, 0, 'R', workspaceJson([start([blk('sound_play', {}, { SOUND: 'bell' })])]))
    const w = RoboWorld.fromDoc({ ...emptyDoc(), scene: 'robo', nodes: [pigeon, robot] })
    w.sounds = sink
    for (let i = 0; i < 10; i++) w.step()
    expect(got).toEqual([`${pigeon.id}:pigeon_coo`, 'stop:all'])
  })
})
