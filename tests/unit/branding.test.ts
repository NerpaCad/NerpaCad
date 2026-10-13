import { describe, expect, it } from 'vitest'
import en from '../../src/renderer/i18n/en.json'
import ru from '../../src/renderer/i18n/ru.json'
import zh from '../../src/renderer/i18n/zh.json'
import { parseDoc, serializeDoc, TCAD_FORMAT } from '../../src/renderer/core/io/formats'
import { emptyDoc } from '@/core/doc/model'
import { prim } from './helpers'

describe('NerpaCad project files', () => {
  it('are written with the new format id and app name', () => {
    const f = JSON.parse(serializeDoc({ ...emptyDoc(), nodes: [prim('box')] }))
    expect(f.format).toBe('nerpacad-project')
    expect(f.format).toBe(TCAD_FORMAT)
    expect(f.app).toBe('NerpaCad')
  })

  it('still open when written by Cad System (the old name)', () => {
    const old = JSON.stringify({ format: 'cad-system-project', version: 4, app: 'Cad System', doc: { version: 4, nodes: [prim('box')], meshes: {} } })
    expect(parseDoc(old).nodes).toHaveLength(1)
  })

  it('refuse other JSON', () => {
    expect(() => parseDoc(JSON.stringify({ format: 'something-else', version: 1, doc: { nodes: [] } }))).toThrow()
  })
})

describe('translations', () => {
  const placeholders = (s: string) => (s.match(/%\d|\{\w+\}/g) ?? []).sort()
  for (const [name, dict] of [['en', en], ['zh', zh]] as const) {
    it(`${name} has every key of ru with the same placeholders`, () => {
      const d = dict as Record<string, string>
      for (const [k, v] of Object.entries(ru)) {
        expect(d[k], k).toBeTypeOf('string')
        expect(placeholders(d[k]), k).toEqual(placeholders(v))
      }
      expect(Object.keys(d).length).toBe(Object.keys(ru).length)
    })
  }
})
