/**
 * The heroes' sounds: each hero has its own voices, and every hero can use the common ones.
 * The files are in assets/sounds (made by scripts/build-sounds.py); the lengths here are the
 * files' lengths, so "play until done" waits the same in the app and in tests (where nothing
 * is heard).
 */
import type { Species } from '../doc/model'

export interface SoundSpec {
  id: string
  /** seconds */
  dur: number
  /** a hero's own voice; common sounds have none */
  species?: Species
}

export const SOUNDS: SoundSpec[] = [
  { id: 'seal_voice', dur: 1.1, species: 'seal' },
  { id: 'seal_bark', dur: 0.7, species: 'seal' },
  { id: 'seal_roar', dur: 1.3, species: 'seal' },
  { id: 'seal_splash', dur: 0.41, species: 'seal' },
  { id: 'pigeon_coo', dur: 1.49, species: 'pigeon' },
  { id: 'pigeon_gugu', dur: 0.8, species: 'pigeon' },
  { id: 'pigeon_wings', dur: 1.04, species: 'pigeon' },
  { id: 'cheetah_purr', dur: 2.4, species: 'cheetah' },
  { id: 'cheetah_meow', dur: 0.54, species: 'cheetah' },
  { id: 'cheetah_chirp', dur: 0.64, species: 'cheetah' },
  { id: 'hooray', dur: 0.89 },
  { id: 'oops', dur: 0.56 },
  { id: 'bell', dur: 0.94 },
  { id: 'drum', dur: 0.39 },
  { id: 'click', dur: 0.04 },
  { id: 'jump', dur: 0.37 },
  { id: 'pew', dur: 0.73 },
  { id: 'bonus', dur: 0.28 },
  { id: 'step', dur: 0.07 }
]

const BY_ID = new Map(SOUNDS.map((s) => [s.id, s]))

export const soundSpec = (id: string): SoundSpec | undefined => BY_ID.get(id)

/** What a hero's sound menu offers: its own voices first, then the common sounds. */
export function soundsFor(species: Species): SoundSpec[] {
  return [...SOUNDS.filter((s) => s.species === species), ...SOUNDS.filter((s) => !s.species)]
}

/** The sound a new "play" block starts with: the hero's first voice. */
export const firstSound = (species: Species): string => soundsFor(species)[0].id

/** Tempo of notes, beats per minute (as in Scratch). */
export const DEFAULT_TEMPO = 60
export const TEMPO_RANGE: [number, number] = [20, 500]
/** Notes a program can play: MIDI numbers (60 is the middle C). */
export const NOTE_RANGE: [number, number] = [0, 130]

/** Hertz of a MIDI note. */
export const noteHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12)

/** Where a running world sends its sounds (the app plays them; tests may count them). */
export interface SoundSink {
  /** `volume` 0…1 (the hero's own volume; the app multiplies in its master volume) */
  play(id: string, volume: number, source: string): void
  /** a synthesized note, `seconds` of the run's time */
  note(midi: number, seconds: number, volume: number, source: string): void
  /** stop every sound (`source` given: only that hero's) */
  stop(source?: string): void
}
