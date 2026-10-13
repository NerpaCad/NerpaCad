import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

export function ToolButton(props: {
  title: string
  label?: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  children: ComponentChildren
  testId?: string
  /** extra class (e.g. which toolbar tier it belongs to) */
  cls?: string
}) {
  return (
    <button
      type="button"
      class={`tool-btn${props.active ? ' active' : ''}${props.cls ? ` ${props.cls}` : ''}`}
      title={props.title}
      aria-label={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      data-testid={props.testId}
    >
      {props.children}
      {props.label && <span class="tool-label">{props.label}</span>}
    </button>
  )
}

/** A toolbar button that opens a small menu underneath it. */
export function Dropdown(props: {
  title: string
  label?: string
  icon: JSX.Element
  disabled?: boolean
  testId?: string
  align?: 'left' | 'right'
  cls?: string
  children: (close: () => void) => ComponentChildren
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  useEffect(() => {
    if (props.disabled) setOpen(false)
  }, [props.disabled])
  return (
    <div class={`dropdown${props.cls ? ` ${props.cls}` : ''}`} ref={ref}>
      <ToolButton
        title={props.title}
        label={props.label}
        onClick={() => setOpen(!open)}
        disabled={props.disabled}
        active={open}
        testId={props.testId}
      >
        {props.icon}
      </ToolButton>
      {open && (
        <div class={`dropdown-menu ${props.align === 'right' ? 'right' : ''}`}>
          {props.children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/**
 * Numeric input that edits a local draft and commits on Enter / blur.
 * Arrow keys step by `step` (Shift ×10) and commit immediately.
 */
export function NumberField(props: {
  value: number
  onCommit: (v: number) => void
  step?: number
  min?: number
  max?: number
  digits?: number
  label?: string
  testId?: string
  /** tooltip */
  title?: string
  /** model units per unit on screen: 10 shows millimetres as centimetres (`value`, `min`, `max` stay in mm) */
  scale?: number
  disabled?: boolean
}) {
  const digits = props.digits ?? 2
  const k = props.scale ?? 1
  const fmt = (v: number) => {
    const r = Math.round(v * 10 ** digits) / 10 ** digits
    return Object.is(r, -0) ? '0' : String(r)
  }
  const [draft, setDraft] = useState<string | null>(null)
  // Enter/Escape already handled the value; the blur that follows must not commit again
  const skipBlur = useRef(false)
  const commit = (raw: string) => {
    const v = parseFloat(raw.replace(',', '.')) * k
    setDraft(null)
    if (!Number.isFinite(v)) return
    let c = v
    if (props.min !== undefined) c = Math.max(props.min, c)
    if (props.max !== undefined) c = Math.min(props.max, c)
    if (Math.abs(c - props.value) > 1e-9) props.onCommit(c)
  }
  return (
    <label class="num-field" title={props.title}>
      {props.label && <span class="num-label">{props.label}</span>}
      <input
        type="text"
        inputMode="decimal"
        value={draft ?? fmt(props.value / k)}
        data-testid={props.testId}
        disabled={props.disabled}
        onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
        onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
        onBlur={(e) => {
          if (skipBlur.current) {
            skipBlur.current = false
            return
          }
          commit((e.currentTarget as HTMLInputElement).value)
        }}
        onKeyDown={(e) => {
          const el = e.currentTarget as HTMLInputElement
          if (e.key === 'Enter') {
            commit(el.value)
            skipBlur.current = true
            el.blur()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            setDraft(null)
            skipBlur.current = true
            el.blur()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const st = (props.step ?? 1) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
            commit(String(props.value / k + st))
          }
        }}
      />
    </label>
  )
}

const autoFocused = new WeakSet<Element>()

/**
 * `ref={focusOnMount}`: focus a field and select its text once, when it appears. A stable
 * function (not an inline arrow) so re-renders do not call it again — re-selecting on every
 * render made the next typed digit replace the ones already typed.
 */
export function focusOnMount(el: HTMLInputElement | null): void {
  if (!el || autoFocused.has(el)) return
  autoFocused.add(el)
  requestAnimationFrame(() => {
    el.focus()
    el.select()
  })
}

