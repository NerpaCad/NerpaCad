import { effect, signal } from '@preact/signals'
import en from './en.json'
import ru from './ru.json'
import zh from './zh.json'

export type Lang = 'ru' | 'en' | 'zh'
export type Key = keyof typeof ru

export const LANGS: Lang[] = ['ru', 'en', 'zh']
/** each language's name written in that language, for the language menu */
export const LANG_NAMES: Record<Lang, string> = { ru: 'Русский', en: 'English', zh: '简体中文' }
/** short label on the menu button */
export const LANG_SHORT: Record<Lang, string> = { ru: 'RU', en: 'EN', zh: '中文' }

const dicts: Record<Lang, Record<string, string>> = { ru, en, zh }
const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as string[]).includes(v)

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('cad.lang')
    if (isLang(saved)) return saved
  } catch {
    /* storage unavailable */
  }
  const nav = navigator.language.toLowerCase()
  if (nav.startsWith('ru')) return 'ru'
  if (nav.startsWith('zh')) return 'zh'
  return 'en'
}

export const lang = signal<Lang>(initialLang())

effect(() => {
  try {
    localStorage.setItem('cad.lang', lang.value)
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang.value === 'zh' ? 'zh-Hans' : lang.value
})

/** Translate a key; `{name}` placeholders are filled from `vars`. Reading it subscribes to `lang`. */
export function t(key: Key, vars?: Record<string, string | number>): string {
  let s = dicts[lang.value][key] ?? dicts.ru[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

export const dictionaries = dicts
