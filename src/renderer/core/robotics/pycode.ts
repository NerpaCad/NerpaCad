/**
 * A block program as text, in the style of Python: for older pupils, a bridge from blocks to
 * typed code. Every event block becomes a function with a decorator (`@when_start`…), loops and
 * conditions become `while`/`for`/`if`, the actor's blocks become calls on `robot`, `hero` or
 * `lamp`. The text is for reading and copying; NerpaCad runs the blocks, not this text.
 */
import type { BlockJson } from './interpreter'
import { topBlocks } from './interpreter'

/** whose program it is: picks the name its blocks are called on */
export type CodeActor = 'robot' | 'hero' | 'lamp'

const PY_WORDS = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield print range wait robot hero lamp board lcd'.split(' ')
)

/** A name Python accepts (letters of any alphabet, digits, _), not a keyword. */
export function pyName(raw: string): string {
  let s = raw.trim().replace(/[^\p{L}\p{N}_]+/gu, '_').replace(/^_+|_+$/g, '')
  if (!s) s = 'var'
  if (/^\p{N}/u.test(s)) s = `_${s}`
  if (PY_WORDS.has(s)) s = `${s}_`
  return s
}

const str = (v: unknown) => JSON.stringify(String(v ?? ''))
const fmtNum = (v: unknown): string => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'))
  if (!Number.isFinite(n)) return '0'
  return String(Math.round(n * 1e6) / 1e6)
}
const target = (v: unknown) => str(String(v ?? 'ROBOT').toLowerCase())
const surface = (v: unknown) => str(String(v ?? ''))

interface Ctx {
  me: CodeActor
  names: Map<string, string>
  /** variables a function sets (they need `global`) */
  assigned: Set<string>
}

/** The program's text. `header`: a comment line on top (in the user's language). */
export function programToPython(program: unknown, me: CodeActor, header = ''): string {
  const names = new Map<string, string>()
  const used = new Set<string>()
  const vars = (program as { variables?: { id?: unknown; name?: unknown }[] } | null)?.variables
  for (const v of Array.isArray(vars) ? vars : []) {
    if (typeof v?.id !== 'string') continue
    let n = pyName(String(v.name ?? 'var'))
    for (let k = 2; used.has(n); k++) n = `${pyName(String(v.name ?? 'var'))}_${k}`
    used.add(n)
    names.set(v.id, n)
  }
  const out: string[] = []
  if (header) out.push(`# ${header}`, '')
  if (names.size) {
    for (const n of names.values()) out.push(`${n} = 0`)
    out.push('')
  }
  const fnNames = new Set<string>()
  const fn = (base: string) => {
    let n = base
    for (let k = 2; fnNames.has(n); k++) n = `${base}_${k}`
    fnNames.add(n)
    return n
  }
  const loose: BlockJson[] = []
  for (const top of topBlocks(program)) {
    let deco: string | null = null
    let name = ''
    switch (top.type) {
      case 'robo_start':
        deco = '@when_start'
        name = fn('main')
        break
      case 'robo_when_key': {
        const key = String(top.fields?.KEY ?? 'ANY')
        deco = key === 'ANY' ? '@when_any_key' : `@when_key(${str(key)})`
        name = fn(key === 'ANY' ? 'on_any_key' : `on_key_${pyName(key.toLowerCase())}`)
        break
      }
      case 'robo_when_clicked':
        deco = '@when_clicked'
        name = fn('on_click')
        break
      case 'msg_when': {
        const msg = String(top.fields?.MSG ?? '').trim()
        deco = `@when_message(${str(msg)})`
        name = fn(`on_${pyName(msg.toLowerCase()) || 'message'}`)
        break
      }
    }
    if (!deco) {
      loose.push(top)
      continue
    }
    const ctx: Ctx = { me, names, assigned: new Set() }
    const body = chain(top.next?.block, ctx, 1)
    out.push(deco, `def ${name}():`)
    if (ctx.assigned.size) out.push(`    global ${[...ctx.assigned].join(', ')}`)
    out.push(...(body.length ? body : ['    pass']), '')
  }
  if (loose.length) {
    out.push('# not under an event block: these blocks do not run')
    for (const b of loose) {
      const ctx: Ctx = { me, names, assigned: new Set() }
      const lines = EXPRESSIONS.has(b.type) ? [expr(b, ctx)] : chain(b, ctx, 0)
      out.push(...lines.map((l) => `# ${l}`))
    }
    out.push('')
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  return out.join('\n') + '\n'
}

/** blocks that are values (they fit into other blocks' holes) */
const EXPRESSIONS = new Set([
  'robo_number', 'math_number', 'sound_note_pick', 'robo_text', 'variables_get', 'robo_distance',
  'robo_light', 'robo_touch', 'robo_line_sensor', 'robo_line_black', 'nerpa_x', 'nerpa_y', 'nerpa_dir',
  'nerpa_touching', 'nerpa_distance', 'creature_ledge', 'creature_water', 'nerpa_in_water', 'creature_under',
  'creature_on', 'creature_ahead_is', 'pigeon_altitude', 'sound_volume_get', 'robo_timer', 'ard_analog_read',
  'ard_digital_read', 'ard_ultrasonic', 'robo_compare', 'robo_arith', 'robo_logic', 'robo_not'
])

function chain(first: BlockJson | undefined, ctx: Ctx, depth: number): string[] {
  const out: string[] = []
  for (let b = first; b; b = b.next?.block) out.push(...stmt(b, ctx, depth))
  return out
}

const child = (b: BlockJson, name: string) => b.inputs?.[name]?.block ?? b.inputs?.[name]?.shadow
const val = (b: BlockJson, name: string, ctx: Ctx, def = '0') => {
  const c = child(b, name)
  return c ? expr(c, ctx) : def
}
/** an operand of an operator: in brackets unless it is a single thing */
const operand = (b: BlockJson, name: string, ctx: Ctx, def: string) => {
  const c = child(b, name)
  if (!c) return def
  const e = expr(c, ctx)
  return ['robo_arith', 'robo_compare', 'robo_logic', 'robo_not', 'creature_on', 'creature_ahead_is'].includes(c.type) ? `(${e})` : e
}

function stmt(b: BlockJson, ctx: Ctx, depth: number): string[] {
  const pad = '    '.repeat(depth)
  const line = (s: string) => [pad + s]
  const me = ctx.me
  const v = (name: string, def = '0') => val(b, name, ctx, def)
  const block = (head: string, name: string) => {
    const inner = chain(child(b, name), ctx, depth + 1)
    return [pad + head, ...(inner.length ? inner : [`${pad}    pass`])]
  }
  const f = b.fields ?? {}
  const varName = () => {
    const id = typeof f.VAR === 'string' ? f.VAR : (f.VAR as { id?: string } | undefined)?.id
    return (id && ctx.names.get(id)) || 'var'
  }
  switch (b.type) {
    case 'robo_motors':
      return line(`${me}.motors(${v('LEFT')}, ${v('RIGHT')})`)
    case 'robo_forward':
      return line(`${me}.forward(${v('POWER')})`)
    case 'robo_backward':
      return line(`${me}.backward(${v('POWER')})`)
    case 'robo_turn':
      return line(`${me}.turn_${f.DIR === 'RIGHT' ? 'right' : 'left'}(${v('POWER')})`)
    case 'robo_motors_for':
      return line(`${me}.motors(${v('LEFT')}, ${v('RIGHT')}, seconds=${v('SECONDS')})`)
    case 'robo_stop':
      return line(`${me}.stop()`)
    case 'robo_flashlight':
      return line(`${me}.flashlight(${fmtNum(f.PORT)}, ${f.STATE === 'OFF' ? 'False' : 'True'})`)
    case 'robo_flashlight_brightness':
      return line(`${me}.flashlight_brightness(${fmtNum(f.PORT)}, ${v('VALUE')})`)
    case 'nerpa_walk':
      return line(`${me}.walk(${v('CM')})`)
    case 'nerpa_turn':
      return line(`${me}.turn_${f.DIR === 'RIGHT' ? 'right' : 'left'}(${v('DEG')})`)
    case 'nerpa_heading':
      return line(`${me}.point_in_direction(${v('DEG')})`)
    case 'nerpa_face':
      return line(`${me}.face(${target(f.TARGET)})`)
    case 'nerpa_goto':
      return line(`${me}.go_to(${v('X')}, ${v('Y')})`)
    case 'nerpa_glide':
      return line(`${me}.glide_to(${v('X')}, ${v('Y')}, seconds=${v('SECONDS')})`)
    case 'nerpa_jump':
      return line(`${me}.jump()`)
    case 'cheetah_run':
      return line(`${me}.run(${v('CM')})`)
    case 'cheetah_crawl':
      return line(`${me}.crawl(${v('CM')})`)
    case 'cheetah_leap':
      return line(`${me}.leap()`)
    case 'pigeon_takeoff':
      return line(`${me}.take_off(${v('CM')})`)
    case 'pigeon_fly':
      return line(`${me}.fly(${v('CM')})`)
    case 'pigeon_fly_to':
      return line(`${me}.fly_to(${v('X')}, ${v('Y')})`)
    case 'pigeon_land':
      return line(`${me}.land()`)
    case 'nerpa_say':
      return line(`${me}.say(${v('TEXT', '""')})`)
    case 'nerpa_say_for':
      return line(`${me}.say(${v('TEXT', '""')}, seconds=${v('SECONDS')})`)
    case 'nerpa_color':
      return line(`${me}.set_color(${str(f.COLOR ?? '#8f9aa6')})`)
    case 'nerpa_show':
      return line(`${me}.show()`)
    case 'nerpa_hide':
      return line(`${me}.hide()`)
    case 'nerpa_size':
      return line(`${me}.set_size(${v('PERCENT', '100')})`)
    case 'msg_send':
      return line(`broadcast(${str(String(f.MSG ?? '').trim())})`)
    case 'msg_send_wait':
      return line(`broadcast_and_wait(${str(String(f.MSG ?? '').trim())})`)
    case 'sound_play':
      return line(`play_sound(${str(f.SOUND)})`)
    case 'sound_play_wait':
      return line(`play_sound_until_done(${str(f.SOUND)})`)
    case 'sound_note':
      return line(`play_note(${v('NOTE', '60')}, beats=${v('BEATS', '1')})`)
    case 'sound_rest':
      return line(`rest(beats=${v('BEATS', '1')})`)
    case 'sound_tempo':
      return line(`set_tempo(${v('BPM', '60')})`)
    case 'sound_volume':
      return line(`set_volume(${v('PERCENT', '100')})`)
    case 'sound_change_volume':
      return line(`change_volume(${v('DELTA')})`)
    case 'sound_stop':
      return line('stop_all_sounds()')
    case 'light_on':
      return line(`${me}.on()`)
    case 'light_off':
      return line(`${me}.off()`)
    case 'light_brightness':
      return line(`${me}.brightness(${v('VALUE')})`)
    case 'light_color':
      return line(`${me}.color(${str(f.COLOR ?? '#ffffff')})`)
    case 'variables_set': {
      const n = varName()
      ctx.assigned.add(n)
      return line(`${n} = ${v('VALUE')}`)
    }
    case 'math_change': {
      const n = varName()
      ctx.assigned.add(n)
      return line(`${n} += ${v('DELTA')}`)
    }
    case 'robo_wait':
      return line(`wait(${v('SECONDS')})`)
    case 'robo_wait_until':
      return line(`wait_until(lambda: ${v('COND', 'False')})`)
    case 'robo_forever':
      return block('while True:', 'DO')
    case 'robo_repeat':
      return block(`for _ in range(${v('TIMES')}):`, 'DO')
    case 'robo_repeat_until':
      return block(`while not ${operand(b, 'COND', ctx, 'False')}:`, 'DO')
    case 'robo_if':
      return block(`if ${v('COND', 'False')}:`, 'DO')
    case 'robo_if_else': {
      const yes = block(`if ${v('COND', 'False')}:`, 'DO')
      const inner = chain(child(b, 'ELSE'), ctx, depth + 1)
      return [...yes, `${pad}else:`, ...(inner.length ? inner : [`${pad}    pass`])]
    }
    case 'ard_digital_write':
      return line(`board.digital_write(${str(f.PIN ?? 'D13')}, ${f.STATE === 'LOW' ? 'LOW' : 'HIGH'})`)
    case 'ard_analog_write':
      return line(`board.analog_write(${str(f.PIN ?? 'D9')}, ${v('VALUE')})`)
    case 'ard_servo':
      return line(`board.servo(${str(f.PIN ?? 'D9')}, ${v('ANGLE')})`)
    case 'ard_serial_println':
      return line(`print(${v('TEXT', '""')})`)
    case 'ard_builtin_led':
      return line(`board.led(${f.STATE === 'OFF' ? 'False' : 'True'})`)
    case 'ard_pin_mode':
      return line(`board.pin_mode(${str(f.PIN ?? 'D2')}, ${f.MODE === 'OUTPUT' ? 'OUTPUT' : f.MODE === 'INPUT_PULLUP' ? 'INPUT_PULLUP' : 'INPUT'})`)
    case 'ard_tone':
      return line(`board.tone(${str(f.PIN ?? 'D8')}, ${v('FREQ', '440')})`)
    case 'ard_tone_for':
      return line(`board.tone(${str(f.PIN ?? 'D8')}, ${v('FREQ', '440')}, ms=${v('MS', '500')})`)
    case 'ard_no_tone':
      return line(`board.no_tone(${str(f.PIN ?? 'D8')})`)
    case 'ard_lcd_print':
      return line(`lcd.print(${v('TEXT', '""')}, row=${f.ROW === '1' ? 1 : 0}, col=${v('COL')})`)
    case 'ard_lcd_clear':
      return line('lcd.clear()')
    default:
      return line(`# ? ${b.type}`)
  }
}

function expr(b: BlockJson, ctx: Ctx): string {
  const f = b.fields ?? {}
  const me = ctx.me
  switch (b.type) {
    case 'robo_number':
    case 'math_number':
    case 'sound_note_pick':
      return fmtNum(f.NUM ?? f.NOTE)
    case 'robo_text':
      return str(f.TEXT)
    case 'variables_get': {
      const id = typeof f.VAR === 'string' ? f.VAR : (f.VAR as { id?: string } | undefined)?.id
      return (id && ctx.names.get(id)) || 'var'
    }
    case 'robo_distance':
      return `${me}.distance(${fmtNum(f.PORT)})`
    case 'robo_light':
      return `${me}.light(${fmtNum(f.PORT)})`
    case 'robo_touch':
      return `${me}.touch(${fmtNum(f.PORT)})`
    case 'robo_line_sensor':
      return `${me}.line(${fmtNum(f.PORT)})`
    case 'robo_line_black':
      return `${me}.line_is_black(${fmtNum(f.PORT)})`
    case 'nerpa_x':
      return `${me}.x`
    case 'nerpa_y':
      return `${me}.y`
    case 'nerpa_dir':
      return `${me}.direction`
    case 'nerpa_touching':
      return `${me}.touching(${target(f.TARGET)})`
    case 'nerpa_distance':
      return `${me}.distance_to(${target(f.TARGET)})`
    case 'creature_ledge':
      return `${me}.ledge_ahead()`
    case 'creature_water':
      return `${me}.water_ahead()`
    case 'nerpa_in_water':
      return `${me}.in_water()`
    case 'creature_under':
      return `${me}.standing_on()`
    case 'creature_on':
      return `${me}.standing_on() == ${surface(f.SURF)}`
    case 'creature_ahead_is':
      return `${me}.ahead() == ${surface(f.SURF)}`
    case 'pigeon_altitude':
      return `${me}.altitude`
    case 'sound_volume_get':
      return 'volume()'
    case 'robo_timer':
      return 'timer()'
    case 'ard_analog_read':
      return `board.analog_read(${str(f.PIN ?? 'A0')})`
    case 'ard_digital_read':
      return `board.digital_read(${str(f.PIN ?? 'D2')})`
    case 'ard_ultrasonic':
      return `board.distance_cm(${str(f.TRIG ?? 'D9')}, ${str(f.ECHO ?? 'D10')})`
    case 'robo_compare': {
      const op = { LT: '<', GT: '>', LE: '<=', GE: '>=', NE: '!=' }[String(f.OP)] ?? '=='
      return `${operand(b, 'A', ctx, '0')} ${op} ${operand(b, 'B', ctx, '0')}`
    }
    case 'robo_arith': {
      const op = { SUB: '-', MUL: '*', DIV: '/' }[String(f.OP)] ?? '+'
      return `${operand(b, 'A', ctx, '0')} ${op} ${operand(b, 'B', ctx, '0')}`
    }
    case 'robo_logic':
      return `${operand(b, 'A', ctx, 'False')} ${f.OP === 'OR' ? 'or' : 'and'} ${operand(b, 'B', ctx, 'False')}`
    case 'robo_not':
      return `not ${operand(b, 'A', ctx, 'False')}`
    default:
      return `None  # ? ${b.type}`
  }
}
