/**
 * Autosave bookkeeping (stage 8 review): a copy on disk always goes when the project is saved —
 * also after a failed write, a save during a write, or a project restored after a crash; a copy
 * left by a crash is not overwritten while it is offered.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyDoc, newId, type Doc } from '@/core/doc/model'
import { serializeDoc } from '@/core/io/formats'

type Call = 'write' | 'clear'
let calls: Call[]
let failWrite: boolean
let left: string | null
let release: (() => void) | null
let hold: boolean

function mockApi() {
  calls = []
  failWrite = false
  left = null
  release = null
  hold = false
  ;(globalThis as unknown as { window: unknown }).window = {
    setInterval: () => 1,
    api: {
      autosaveEvery: 60_000,
      autosaveWrite: async () => {
        calls.push('write')
        if (hold) await new Promise<void>((r) => (release = r))
        if (failWrite) throw new Error('disk full')
        return true
      },
      autosaveClear: async () => {
        calls.push('clear')
        return true
      },
      autosaveCheck: async () => (left ? { data: left, savedAt: 1, name: 'a.nerpa', path: '/gone/a.nerpa' } : null)
    }
  }
}

const docWith = (name: string): Doc => ({
  ...emptyDoc(),
  nodes: [{ id: newId(), kind: 'prim', prim: 'box', name, color: '#888888', isHole: false, params: {}, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } } as never]
})
const flush = () => new Promise((r) => setTimeout(r, 0))

/** a fresh copy of the modules for each test (the autosave keeps state in the module) */
async function load() {
  vi.resetModules()
  const store = await import('@/core/doc/store')
  const auto = await import('@/ui/autosave')
  return { store, auto }
}

describe('autosave', () => {
  beforeEach(mockApi)

  it('a copy on disk goes when the project is saved, even after a later write failed', async () => {
    const { store, auto } = await load()
    await auto.startAutosave()
    store.commit(docWith('a'))
    await auto.autosaveNow()
    failWrite = true
    store.commit(docWith('b'))
    await auto.autosaveNow()
    expect(calls).toEqual(['write', 'write'])
    store.markSaved('/p/x.nerpa', 'x.nerpa')
    await auto.autosaveNow()
    await flush()
    expect(calls).toEqual(['write', 'write', 'clear'])
  })

  it('saved while a copy was being written: the copy goes right after', async () => {
    const { store, auto } = await load()
    await auto.startAutosave()
    store.commit(docWith('a'))
    hold = true
    const writing = auto.autosaveNow()
    await flush()
    store.markSaved('/p/x.nerpa', 'x.nerpa')
    release!()
    await writing
    await flush()
    expect(calls).toEqual(['write', 'clear'])
  })

  it('a copy left by a crash is not overwritten while offered; restored and saved, it goes', async () => {
    left = serializeDoc(docWith('lost work'))
    const { store, auto } = await load()
    await auto.startAutosave()
    expect(auto.recoverOffer.value).not.toBeNull()
    store.commit(docWith('something else'))
    await auto.autosaveNow()
    expect(calls).toEqual([])
    auto.recover()
    expect(store.dirty.value).toBe(true)
    store.markSaved('/p/x.nerpa', 'x.nerpa')
    await flush()
    expect(calls).toEqual(['clear'])
  })
})
