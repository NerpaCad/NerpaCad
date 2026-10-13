/**
 * Arduino C++ from a block program, the same program the simulator runs. Blocks before
 * "forever" go into setup(), the blocks inside it into loop(); with no "forever" everything runs
 * once in setup(), as the simulator does.
 */
import { type BlockJson, topBlocks } from '../robotics/interpreter'
import { ANALOG_PINS, pinNumber } from './parts'

interface Ctx {
  pins: Set<string>
  loopVar: number
  timer: boolean
  unknown: Set<string>
  /** pins with a servo on them */
  servos: Set<string>
  serial: boolean
  /** variables: block id → C++ name and whether it holds text */
  vars: Map<string, { name: string; c: string; text: boolean }>
}

const IND = '  '

export function arduinoCode(program: unknown, comments: { setup: string; loop: string; wait: string; unsupported: string } = DEFAULT_COMMENTS): string {
  const ctx: Ctx = { pins: new Set(), loopVar: 0, timer: false, unknown: new Set(), servos: new Set(), serial: false, vars: variables(program) }
  const start = topBlocks(program).find((b) => b.type === 'robo_start')
  const setup: string[] = []
  let loop: string[] = []
  let b = start?.next?.block
  for (; b; b = b.next?.block) {
    if (b.type === 'robo_forever') {
      loop = chain(b.inputs?.DO?.block, 1, ctx, comments)
      break
    }
    setup.push(...stmt(b, 1, ctx, comments))
  }
  const servoPins = [...ctx.servos].sort(byPin)
  // a pin driving a servo is set up by attach(), not pinMode()
  const pinModes = [...ctx.pins].filter((p) => !ctx.servos.has(p)).sort(byPin).map((p) => `${IND}pinMode(${p}, OUTPUT);`)
  const lines: string[] = []
  if (servoPins.length) lines.push('#include <Servo.h>', '')
  for (const p of servoPins) lines.push(`Servo servo${p};`)
  if (ctx.timer) lines.push('unsigned long startTime;')
  for (const v of ctx.vars.values()) lines.push(`${v.text ? 'String' : 'long'} ${v.c}${v.text ? '' : ' = 0'};${v.c !== v.name ? ` // ${v.name}` : ''}`)
  if (servoPins.length || ctx.timer || ctx.vars.size) lines.push('')
  lines.push('void setup()', '{')
  if (ctx.serial) lines.push(`${IND}Serial.begin(9600);`)
  lines.push(...pinModes)
  for (const p of servoPins) lines.push(`${IND}servo${p}.attach(${p});`)
  if (ctx.timer) lines.push(`${IND}startTime = millis();`)
  if ((pinModes.length || servoPins.length || ctx.serial || ctx.timer) && setup.length) lines.push('')
  lines.push(...setup)
  lines.push('}', '', 'void loop()', '{')
  lines.push(...(loop.length ? loop : [`${IND}// ${comments.loop}`]))
  lines.push('}')
  return lines.join('\n') + '\n'
}

const DEFAULT_COMMENTS = { setup: 'runs once', loop: 'nothing to repeat', wait: 'Wait for {ms} millisecond(s)', unsupported: 'block not supported' }

const byPin = (a: string, b: string) => (isNaN(+a) ? 100 : +a) - (isNaN(+b) ? 100 : +b) || a.localeCompare(b)

function chain(first: BlockJson | undefined, depth: number, ctx: Ctx, c: typeof DEFAULT_COMMENTS): string[] {
  const out: string[] = []
  for (let b = first; b; b = b.next?.block) out.push(...stmt(b, depth, ctx, c))
  return out
}

function stmt(b: BlockJson, depth: number, ctx: Ctx, c: typeof DEFAULT_COMMENTS): string[] {
  const ind = IND.repeat(depth)
  const f = b.fields ?? {}
  const sub = (name: string) => chain(b.inputs?.[name]?.block, depth + 1, ctx, c)
  switch (b.type) {
    case 'ard_digital_write': {
      const pin = pinNumber(String(f.PIN ?? 'D13'))
      ctx.pins.add(pin)
      return [`${ind}digitalWrite(${pin}, ${f.STATE === 'LOW' ? 'LOW' : 'HIGH'});`]
    }
    case 'ard_builtin_led':
      ctx.pins.add('LED_BUILTIN')
      return [`${ind}digitalWrite(LED_BUILTIN, ${f.STATE === 'OFF' ? 'LOW' : 'HIGH'});`]
    case 'ard_analog_write': {
      const pin = pinNumber(String(f.PIN ?? 'D9'))
      ctx.pins.add(pin)
      return [`${ind}analogWrite(${pin}, ${expr(b, 'VALUE', ctx)});`]
    }
    case 'ard_servo': {
      const pin = pinNumber(String(f.PIN ?? 'D9'))
      ctx.servos.add(pin)
      ctx.pins.add(pin)
      return [`${ind}servo${pin}.write(${expr(b, 'ANGLE', ctx)});`]
    }
    case 'ard_serial_println':
      ctx.serial = true
      return [`${ind}Serial.println(${textExpr(b, 'TEXT', ctx)});`]
    case 'variables_set': {
      const v = ctx.vars.get(varOf(b))
      if (!v) return []
      return [`${ind}${v.c} = ${v.text ? stringExpr(b, 'VALUE', ctx) : expr(b, 'VALUE', ctx)};`]
    }
    case 'math_change': {
      const v = ctx.vars.get(varOf(b))
      if (!v) return []
      return [`${ind}${v.c} += ${expr(b, 'DELTA', ctx)};`]
    }
    case 'robo_wait': {
      const s = expr(b, 'SECONDS', ctx)
      const lit = Number(s)
      const ms = Number.isFinite(lit) ? String(Math.round(lit * 1000)) : `(${s}) * 1000`
      return [`${ind}delay(${ms}); // ${c.wait.replace('{ms}', ms)}`]
    }
    case 'robo_wait_until':
      return [`${ind}while (!(${cond(b, 'COND', ctx)})) {`, `${ind}}`]
    case 'robo_forever':
      return [`${ind}while (true) {`, ...sub('DO'), `${ind}}`]
    case 'robo_repeat': {
      const v = `i${ctx.loopVar++ || ''}`
      return [`${ind}for (int ${v} = 0; ${v} < ${expr(b, 'TIMES', ctx)}; ${v}++) {`, ...sub('DO'), `${ind}}`]
    }
    case 'robo_repeat_until':
      return [`${ind}while (!(${cond(b, 'COND', ctx)})) {`, ...sub('DO'), `${ind}}`]
    case 'robo_if':
      return [`${ind}if (${cond(b, 'COND', ctx)}) {`, ...sub('DO'), `${ind}}`]
    case 'robo_if_else':
      return [`${ind}if (${cond(b, 'COND', ctx)}) {`, ...sub('DO'), `${ind}} else {`, ...sub('ELSE'), `${ind}}`]
    default:
      ctx.unknown.add(b.type)
      return [`${ind}// ${c.unsupported}: ${b.type}`]
  }
}

function child(b: BlockJson, name: string): BlockJson | undefined {
  const i = b.inputs?.[name]
  return i?.block ?? i?.shadow
}

function expr(b: BlockJson, name: string, ctx: Ctx): string {
  const c = child(b, name)
  return c ? value(c, ctx, 'num') : '0'
}

function cond(b: BlockJson, name: string, ctx: Ctx): string {
  const c = child(b, name)
  return c ? value(c, ctx, 'num') : 'false'
}

const OPS: Record<string, string> = { LT: '<', GT: '>', EQ: '==', LE: '<=', GE: '>=', NE: '!=', ADD: '+', SUB: '-', MUL: '*', DIV: '/', AND: '&&', OR: '||' }

/** An expression; `want` 'num' is a number context (a text variable is read with toInt()). */
function value(b: BlockJson, ctx: Ctx, want: 'num' | 'any' = 'num'): string {
  const f = b.fields ?? {}
  switch (b.type) {
    case 'robo_number':
    case 'math_number': {
      const n = Number(f.NUM)
      return Number.isFinite(n) ? String(n) : '0'
    }
    case 'robo_timer':
      ctx.timer = true
      return '((millis() - startTime) / 1000.0)'
    case 'robo_compare':
    case 'robo_arith':
    case 'robo_logic':
      return `(${b.type === 'robo_logic' ? cond(b, 'A', ctx) : expr(b, 'A', ctx)} ${OPS[String(f.OP)] ?? '+'} ${b.type === 'robo_logic' ? cond(b, 'B', ctx) : expr(b, 'B', ctx)})`
    case 'robo_not':
      return `!(${cond(b, 'A', ctx)})`
    case 'ard_analog_read':
      return `analogRead(${ANALOG_PINS.includes(String(f.PIN)) ? f.PIN : 'A0'})`
    case 'ard_digital_read':
      return `(digitalRead(${pinNumber(String(f.PIN ?? 'D2'))}) == HIGH)`
    case 'variables_get': {
      const v = ctx.vars.get(varOf(b))
      if (!v) return '0'
      return v.text && want === 'num' ? `${v.c}.toInt()` : v.c
    }
    case 'robo_text': {
      const s = String(f.TEXT ?? '')
      // text where a number is needed: its number, as the simulator reads it
      if (want === 'num') {
        const n = Number(s.trim().replace(',', '.'))
        return Number.isFinite(n) && s.trim() !== '' ? String(n) : '0'
      }
      return cString(s)
    }
    default:
      ctx.unknown.add(b.type)
      return '0'
  }
}

// ---------------------------------------------------------------- variables and text

const varOf = (b: BlockJson): string => {
  const v = b.fields?.VAR as { id?: unknown } | string | undefined
  return typeof v === 'string' ? v : String(v?.id ?? '')
}

/** A value to print: text stays text, numbers and conditions as they are. */
function textExpr(b: BlockJson, name: string, ctx: Ctx): string {
  const c = child(b, name)
  return c ? value(c, ctx, 'any') : '""'
}

/** A value to store in a String variable: numbers are turned into text with String(…). */
function stringExpr(b: BlockJson, name: string, ctx: Ctx): string {
  const c = child(b, name)
  if (!c) return '""'
  if (c.type === 'robo_text') return value(c, ctx, 'any')
  if (c.type === 'variables_get' && ctx.vars.get(varOf(c))?.text) return value(c, ctx, 'any')
  return `String(${value(c, ctx, 'num')})`
}

/** A C++ string literal. */
function cString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"'
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya'
}
/** C++ keywords and names Arduino.h already uses (all lower case: names are lower-cased first). */
const RESERVED = new Set(
  (
    'auto break case char const continue default do double else enum extern float for goto if int long register return short signed ' +
    'sizeof static struct switch typedef union unsigned void volatile while bool true false class new delete this and or not xor ' +
    'bitand bitor compl and_eq or_eq xor_eq not_eq try catch throw public private protected template typename namespace using ' +
    'operator virtual inline friend explicit mutable nullptr asm export static_cast dynamic_cast const_cast reinterpret_cast ' +
    'string serial servo setup loop main init yield high low input output input_pullup led_builtin byte word boolean ' +
    'delay delaymicroseconds millis micros map random randomseed min max abs constrain round sq sqrt pow sin cos tan log exp ' +
    'tone notone pulsein pulseinlong shiftin shiftout pinmode digitalread digitalwrite analogread analogwrite analogreference ' +
    'attachinterrupt detachinterrupt interrupts nointerrupts bit bitread bitwrite bitset bitclear lowbyte highbyte ' +
    'pi half_pi two_pi deg_to_rad rad_to_deg a0 a1 a2 a3 a4 a5 starttime'
  ).split(' ')
)

/** A C++ name for a variable: Cyrillic letters spelled in Latin ones, other symbols dropped. */
export function cName(name: string, taken: Set<string>): string {
  let c = [...name.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
  if (!c || /^[0-9]/.test(c)) c = `v_${c}`
  if (RESERVED.has(c) || c.startsWith('servo') || /^i[0-9]*$/.test(c)) c = `${c}_`
  let out = c
  for (let k = 2; taken.has(out); k++) out = `${c}${k}`
  taken.add(out)
  return out
}

/** The program's variables; a variable holds text when any block puts text into it. */
function variables(program: unknown): Map<string, { name: string; c: string; text: boolean }> {
  const out = new Map<string, { name: string; c: string; text: boolean }>()
  const list = (program as { variables?: { name?: unknown; id?: unknown }[] } | null)?.variables
  if (!Array.isArray(list)) return out
  const taken = new Set<string>()
  const texts = new Set<string>()
  // (target, source variable) pairs: a := b
  const copies: [string, string][] = []
  const walk = (b: BlockJson | undefined) => {
    for (; b; b = b.next?.block) {
      if (b.type === 'variables_set') {
        const v = b.inputs?.VALUE
        const c = v?.block ?? v?.shadow
        if (c?.type === 'robo_text') texts.add(varOf(b))
        if (c?.type === 'variables_get') copies.push([varOf(b), varOf(c)])
      }
      for (const i of Object.values(b.inputs ?? {})) {
        walk(i?.block)
      }
    }
  }
  for (const top of topBlocks(program)) walk(top)
  for (let changed = true; changed; ) {
    changed = false
    for (const [to, from] of copies) {
      if (texts.has(from) && !texts.has(to)) {
        texts.add(to)
        changed = true
      }
    }
  }
  for (const v of list.slice(0, 500)) {
    if (typeof v?.id !== 'string' || typeof v.name !== 'string') continue
    out.set(v.id, { name: v.name.replace(/[\r\n]/g, ' ').slice(0, 60), c: cName(v.name, taken), text: texts.has(v.id) })
  }
  return out
}
