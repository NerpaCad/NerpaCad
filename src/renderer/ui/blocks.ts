/**
 * The robot's blocks for Blockly (Scratch-like look: the "zelos" renderer and Scratch's
 * category colours). The interpreter in core/robotics/interpreter.ts runs them; every block
 * type defined here must be known there.
 */
import * as Blockly from 'blockly/core'
import * as En from 'blockly/msg/en'
import * as Ru from 'blockly/msg/ru'
import * as Zh from 'blockly/msg/zh-hans'
import { math as mathBlocks, variables as variableBlocks } from 'blockly/blocks'
import { type ActorKind, type Species, actorProgram } from '../core/doc/model'
import { doc } from '../core/doc/store'
import { EVENT_KEYS, msgName } from '../core/robotics/interpreter'
import { type Key, lang, t } from '../i18n'
import { allPorts } from '../core/robotics/robot'
import { ANALOG_PINS, IO_PINS, PWM_PINS, pinNumber } from '../core/circuit/parts'
import { currentTheme } from '../themes'
import { firstSound, soundsFor } from '../core/robotics/sounds'
import { SURFACE_KINDS } from '../core/robotics/surface'

// ---------------------------------------------------------------- message names

const MSG_BLOCKS = ['msg_send', 'msg_send_wait', 'msg_when']
/** the menu item that asks for a new name */
const NEW_MSG = '\u0001new'
/** names made in this session that no block holds yet */
const madeNames = new Set<string>()

/**
 * Message names: one list for the whole field — every name some program on it uses, the ones
 * made just now, and the default name first.
 */
export function messageNames(): string[] {
  const found = new Set<string>()
  const walk = (o: unknown): void => {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) return o.forEach(walk)
    const b = o as { type?: unknown; fields?: { MSG?: unknown } }
    if (typeof b.type === 'string' && MSG_BLOCKS.includes(b.type)) {
      const n = msgName(b.fields?.MSG)
      if (n) found.add(n)
    }
    for (const v of Object.values(o)) walk(v)
  }
  for (const n of doc.peek().nodes) walk(actorProgram(n))
  for (const n of madeNames) found.add(n)
  const first = t('blk.msgDefault')
  found.delete(first)
  return [first, ...[...found].sort((a, b) => a.localeCompare(b))]
}

const messageMenu = (): [string, string][] => [...messageNames().map((n) => [n, n] as [string, string]), [t('blk.msgNew'), NEW_MSG]]

/** "New message…" asks for a name; the block then holds it, and every menu offers it. */
function registerMessageMenu(): void {
  if (Blockly.Extensions.isRegistered('msg_menu')) return
  Blockly.Extensions.register('msg_menu', function (this: Blockly.Block) {
    const field = this.getField('MSG') as Blockly.FieldDropdown | null
    field?.setValidator((v: string) => {
      if (v !== NEW_MSG) return v
      Blockly.dialog.prompt(t('blk.msgPrompt'), '', (name: string | null) => {
        const n = msgName(name)
        if (!n) return
        madeNames.add(n)
        // the menu keeps the options it showed: made again, with the new name
        field.getOptions(false)
        field.setValue(n)
      })
      return null
    })
  })
}

/** Whose sounds the sound menus offer (the palette shown last sets it). */
let menuSpecies: Species = 'seal'
const soundMenu = (): [string, string][] => soundsFor(menuSpecies).map((s) => [t(`snd.${s.id}` as Key), s.id])
/** Notes for the note menu: two octaves from the middle C, sharps included. */
function noteMenu(): [string, string][] {
  const names = t('snd.notes').split(' ')
  const white = [0, 2, 4, 5, 7, 9, 11]
  const out: [string, string][] = []
  for (let m = 60; m <= 84; m++) {
    const k = (m - 60) % 12
    const i = white.indexOf(k)
    const name = i >= 0 ? names[i] : `${names[white.indexOf(k - 1)]}♯`
    out.push([`${name}${Math.floor(m / 12) - 1} (${m})`, String(m)])
  }
  return out
}

const STYLES = {
  event_blocks: ['#FFBF00', '#E6AC00', '#CC9900'],
  motion_blocks: ['#4C97FF', '#4280D7', '#3373CC'],
  sensor_blocks: ['#5CB1D6', '#47A8D1', '#2E8EB8'],
  control_blocks: ['#FFAB19', '#EC9C13', '#CF8B17'],
  operator_blocks: ['#59C059', '#46B946', '#389438'],
  output_blocks: ['#4C97FF', '#4280D7', '#3373CC'],
  looks_blocks: ['#9966FF', '#855CD6', '#774DCB'],
  light_blocks: ['#E6B800', '#CFA600', '#B89300'],
  sound_blocks: ['#CF63CF', '#C94FC9', '#BD42BD'],
  variable_blocks: ['#FF8C1A', '#FF8000', '#DB6E00'],
  math_blocks: ['#59C059', '#46B946', '#389438']
} as const

/** Colours the seal and the lamps can take (block dropdowns). */
export const BLOCK_COLORS: [Key, string][] = [
  ['blk.color.red', '#ff3b30'],
  ['blk.color.orange', '#ff9500'],
  ['blk.color.yellow', '#ffd60a'],
  ['blk.color.green', '#34c759'],
  ['blk.color.cyan', '#32d4ff'],
  ['blk.color.blue', '#1e6bff'],
  ['blk.color.purple', '#a45cff'],
  ['blk.color.pink', '#ff5fa8'],
  ['blk.color.white', '#ffffff'],
  ['blk.color.gray', '#8f9aa6'],
  ['blk.color.brown', '#8a5a36'],
  ['blk.color.black', '#1b1d22']
]

type Style = keyof typeof STYLES

const num = (name: string, value: number) => ({ [name]: { shadow: { type: 'robo_number', fields: { NUM: value } } } })

/** Block definitions in Blockly's JSON form, with texts in the current language. */
function definitions(): object[] {
  const ports = allPorts().map((p) => [String(p), String(p)])
  const v = (name: string, check: string) => ({ type: 'input_value', name, check })
  const st = (name: string) => ({ type: 'input_statement', name })
  const def = (type: string, style: Style, message: Key, args: object[], extra: object = {}) => ({
    type,
    style,
    message0: t(message),
    args0: args,
    tooltip: t(`${message}Tip` as Key),
    ...extra
  })
  const stmt = { previousStatement: null, nextStatement: null }
  const dd = (name: string, options: [string, string][]) => ({ type: 'field_dropdown', name, options })
  const colors = () => dd('COLOR', BLOCK_COLORS.map(([k, c]) => [t(k), c]))
  const targets = (prefix: 'blk.target' | 'blk.targetTo', withLight = true) =>
    dd(
      'TARGET',
      (['ROBOT', 'NERPA', 'CHEETAH', 'PIGEON', 'SHAPE', ...(withLight ? ['LIGHT'] : [])] as const).map((k) => [t(`${prefix}.${k}` as Key), k])
    )
  const keyName = (k: string) => ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' })[k] ?? k
  const portDd = () => dd('PORT', ports as [string, string][])
  const surfaces = () => dd('SURF', SURFACE_KINDS.map((k) => [t(`surf.${k}` as Key), k] as [string, string]))
  return [
    // events
    { ...def('robo_start', 'event_blocks', 'blk.start', []), nextStatement: null },
    {
      ...def('robo_when_key', 'event_blocks', 'blk.whenKey', [dd('KEY', [[t('blk.keyAny'), 'ANY'], ...EVENT_KEYS.map((k) => [keyName(k), k] as [string, string])])]),
      nextStatement: null
    },
    { ...def('robo_when_clicked', 'event_blocks', 'blk.whenClicked', []), nextStatement: null },
    // messages between the robot, the heroes and the lamps
    { ...def('msg_when', 'event_blocks', 'blk.msgWhen', [dd('MSG', messageMenu as unknown as [string, string][])]), nextStatement: null, extensions: ['msg_menu'] },
    def('msg_send', 'event_blocks', 'blk.msgSend', [dd('MSG', messageMenu as unknown as [string, string][])], { ...stmt, extensions: ['msg_menu'] }),
    def('msg_send_wait', 'event_blocks', 'blk.msgSendWait', [dd('MSG', messageMenu as unknown as [string, string][])], { ...stmt, extensions: ['msg_menu'] }),
    // robot: more sensors and the flashlight
    def('robo_distance', 'sensor_blocks', 'blk.distance', [portDd()], { output: 'Number' }),
    def('robo_touch', 'sensor_blocks', 'blk.touch', [portDd()], { output: 'Boolean' }),
    def('robo_light', 'sensor_blocks', 'blk.light', [portDd()], { output: 'Number' }),
    def('robo_flashlight', 'light_blocks', 'blk.flashlight', [portDd(), dd('STATE', [[t('blk.on'), 'ON'], [t('blk.off'), 'OFF']])], stmt),
    def('robo_flashlight_brightness', 'light_blocks', 'blk.flashlightBrightness', [portDd(), v('VALUE', 'Number')], { ...stmt, inputsInline: true }),
    // the seal: motion
    def('nerpa_walk', 'motion_blocks', 'blk.nerpaWalk', [v('CM', 'Number')], { ...stmt, inputsInline: true }),
    def('nerpa_turn', 'motion_blocks', 'blk.nerpaTurn', [dd('DIR', [[t('blk.left'), 'LEFT'], [t('blk.right'), 'RIGHT']]), v('DEG', 'Number')], {
      ...stmt,
      inputsInline: true
    }),
    def('nerpa_heading', 'motion_blocks', 'blk.nerpaHeading', [v('DEG', 'Number')], { ...stmt, inputsInline: true }),
    def('nerpa_face', 'motion_blocks', 'blk.nerpaFace', [targets('blk.targetTo')], stmt),
    def('nerpa_goto', 'motion_blocks', 'blk.nerpaGoto', [v('X', 'Number'), v('Y', 'Number')], { ...stmt, inputsInline: true }),
    def('nerpa_glide', 'motion_blocks', 'blk.nerpaGlide', [v('X', 'Number'), v('Y', 'Number'), v('SECONDS', 'Number')], { ...stmt, inputsInline: true }),
    def('nerpa_jump', 'motion_blocks', 'blk.nerpaJump', [], stmt),
    // the cheetah
    def('cheetah_run', 'motion_blocks', 'blk.cheetahRun', [v('CM', 'Number')], { ...stmt, inputsInline: true }),
    def('cheetah_leap', 'motion_blocks', 'blk.cheetahLeap', [], stmt),
    def('cheetah_crawl', 'motion_blocks', 'blk.cheetahCrawl', [v('CM', 'Number')], { ...stmt, inputsInline: true }),
    // the pigeon
    def('pigeon_takeoff', 'motion_blocks', 'blk.pigeonTakeoff', [v('CM', 'Number')], { ...stmt, inputsInline: true }),
    def('pigeon_fly', 'motion_blocks', 'blk.pigeonFly', [v('CM', 'Number')], { ...stmt, inputsInline: true }),
    def('pigeon_fly_to', 'motion_blocks', 'blk.pigeonFlyTo', [v('X', 'Number'), v('Y', 'Number')], { ...stmt, inputsInline: true }),
    def('pigeon_land', 'motion_blocks', 'blk.pigeonLand', [], stmt),
    def('creature_ledge', 'sensor_blocks', 'blk.creatureLedge', [], { output: 'Boolean' }),
    def('creature_water', 'sensor_blocks', 'blk.creatureWater', [], { output: 'Boolean' }),
    def('nerpa_in_water', 'sensor_blocks', 'blk.nerpaInWater', [], { output: 'Boolean' }),
    def('pigeon_altitude', 'sensor_blocks', 'blk.pigeonAltitude', [], { output: 'Number' }),
    // what a hero stands on
    def('creature_under', 'sensor_blocks', 'blk.creatureUnder', [], { output: 'String' }),
    def('creature_on', 'sensor_blocks', 'blk.creatureOn', [surfaces()], { output: 'Boolean' }),
    def('creature_ahead_is', 'sensor_blocks', 'blk.creatureAheadIs', [surfaces()], { output: 'Boolean' }),
    // the seal: looks
    def('nerpa_say', 'looks_blocks', 'blk.nerpaSay', [v('TEXT', null as unknown as string)], { ...stmt, inputsInline: true }),
    def('nerpa_say_for', 'looks_blocks', 'blk.nerpaSayFor', [v('TEXT', null as unknown as string), v('SECONDS', 'Number')], { ...stmt, inputsInline: true }),
    def('nerpa_color', 'looks_blocks', 'blk.nerpaColor', [colors()], stmt),
    def('nerpa_show', 'looks_blocks', 'blk.nerpaShow', [], stmt),
    def('nerpa_hide', 'looks_blocks', 'blk.nerpaHide', [], stmt),
    def('nerpa_size', 'looks_blocks', 'blk.nerpaSize', [v('PERCENT', 'Number')], { ...stmt, inputsInline: true }),
    // the seal: sensing
    def('nerpa_touching', 'sensor_blocks', 'blk.nerpaTouching', [targets('blk.target', false)], { output: 'Boolean' }),
    def('nerpa_distance', 'sensor_blocks', 'blk.nerpaDistance', [targets('blk.target')], { output: 'Number' }),
    def('nerpa_x', 'sensor_blocks', 'blk.nerpaX', [], { output: 'Number' }),
    def('nerpa_y', 'sensor_blocks', 'blk.nerpaY', [], { output: 'Number' }),
    def('nerpa_dir', 'sensor_blocks', 'blk.nerpaDir', [], { output: 'Number' }),
    // sounds (heroes)
    def('sound_play', 'sound_blocks', 'blk.soundPlay', [dd('SOUND', soundMenu as unknown as [string, string][])], stmt),
    def('sound_play_wait', 'sound_blocks', 'blk.soundPlayWait', [dd('SOUND', soundMenu as unknown as [string, string][])], stmt),
    def('sound_note', 'sound_blocks', 'blk.soundNote', [v('NOTE', 'Number'), v('BEATS', 'Number')], { ...stmt, inputsInline: true }),
    def('sound_rest', 'sound_blocks', 'blk.soundRest', [v('BEATS', 'Number')], { ...stmt, inputsInline: true }),
    def('sound_tempo', 'sound_blocks', 'blk.soundTempo', [v('BPM', 'Number')], { ...stmt, inputsInline: true }),
    def('sound_volume', 'sound_blocks', 'blk.soundVolume', [v('PERCENT', 'Number')], { ...stmt, inputsInline: true }),
    def('sound_change_volume', 'sound_blocks', 'blk.soundChangeVolume', [v('DELTA', 'Number')], { ...stmt, inputsInline: true }),
    def('sound_stop', 'sound_blocks', 'blk.soundStop', [], stmt),
    def('sound_volume_get', 'sound_blocks', 'blk.soundVolumeGet', [], { output: 'Number' }),
    def('sound_note_pick', 'sound_blocks', 'blk.soundNotePick', [dd('NOTE', noteMenu())], { output: 'Number' }),
    // lamps
    def('light_on', 'light_blocks', 'blk.lightOn', [], stmt),
    def('light_off', 'light_blocks', 'blk.lightOff', [], stmt),
    def('light_brightness', 'light_blocks', 'blk.lightBrightness', [v('VALUE', 'Number')], { ...stmt, inputsInline: true }),
    def('light_color', 'light_blocks', 'blk.lightColor', [colors()], stmt),
    // a piece of text (what the seal says)
    {
      type: 'robo_text',
      style: 'operator_blocks',
      message0: '%1',
      args0: [{ type: 'field_input', name: 'TEXT', text: '' }],
      output: null
    },
    // motion
    def('robo_motors', 'motion_blocks', 'blk.motors', [v('LEFT', 'Number'), v('RIGHT', 'Number')], { ...stmt, inputsInline: true }),
    def('robo_forward', 'motion_blocks', 'blk.forward', [v('POWER', 'Number')], { ...stmt, inputsInline: true }),
    def('robo_backward', 'motion_blocks', 'blk.backward', [v('POWER', 'Number')], { ...stmt, inputsInline: true }),
    def(
      'robo_turn',
      'motion_blocks',
      'blk.turn',
      [
        {
          type: 'field_dropdown',
          name: 'DIR',
          options: [
            [t('blk.left'), 'LEFT'],
            [t('blk.right'), 'RIGHT']
          ]
        },
        v('POWER', 'Number')
      ],
      { ...stmt, inputsInline: true }
    ),
    def('robo_motors_for', 'motion_blocks', 'blk.motorsFor', [v('LEFT', 'Number'), v('RIGHT', 'Number'), v('SECONDS', 'Number')], {
      ...stmt,
      inputsInline: true
    }),
    def('robo_stop', 'motion_blocks', 'blk.stop', [], stmt),
    // Arduino outputs
    def(
      'ard_digital_write',
      'output_blocks',
      'blk.digitalWrite',
      [
        { type: 'field_dropdown', name: 'PIN', options: IO_PINS.map((p) => [pinNumber(p), p]) },
        {
          type: 'field_dropdown',
          name: 'STATE',
          options: [
            [t('blk.high'), 'HIGH'],
            [t('blk.low'), 'LOW']
          ]
        }
      ],
      stmt
    ),
    def(
      'ard_builtin_led',
      'output_blocks',
      'blk.builtinLed',
      [
        {
          type: 'field_dropdown',
          name: 'STATE',
          options: [
            [t('blk.on'), 'ON'],
            [t('blk.off'), 'OFF']
          ]
        }
      ],
      stmt
    ),
    def(
      'ard_analog_write',
      'output_blocks',
      'blk.analogWrite',
      [{ type: 'field_dropdown', name: 'PIN', options: PWM_PINS.map((p) => [`~${p}`, `D${p}`]) }, v('VALUE', 'Number')],
      { ...stmt, inputsInline: true }
    ),
    def(
      'ard_servo',
      'output_blocks',
      'blk.servo',
      [{ type: 'field_dropdown', name: 'PIN', options: IO_PINS.filter((p) => p.startsWith('D')).map((p) => [pinNumber(p), p]) }, v('ANGLE', 'Number')],
      { ...stmt, inputsInline: true }
    ),
    def('ard_serial_println', 'looks_blocks', 'blk.serialPrintln', [v('TEXT', null as unknown as string)], { ...stmt, inputsInline: true }),
    // Arduino inputs
    def('ard_analog_read', 'sensor_blocks', 'blk.analogRead', [{ type: 'field_dropdown', name: 'PIN', options: ANALOG_PINS.map((p) => [p, p]) }], {
      output: 'Number'
    }),
    def('ard_digital_read', 'sensor_blocks', 'blk.digitalRead', [{ type: 'field_dropdown', name: 'PIN', options: IO_PINS.map((p) => [pinNumber(p), p]) }], {
      output: 'Boolean'
    }),
    // sensors
    def('robo_line_sensor', 'sensor_blocks', 'blk.lineSensor', [{ type: 'field_dropdown', name: 'PORT', options: ports }], {
      output: 'Number'
    }),
    def('robo_line_black', 'sensor_blocks', 'blk.lineBlack', [{ type: 'field_dropdown', name: 'PORT', options: ports }], {
      output: 'Boolean'
    }),
    def('robo_timer', 'sensor_blocks', 'blk.timer', [], { output: 'Number' }),
    // control
    def('robo_wait', 'control_blocks', 'blk.wait', [v('SECONDS', 'Number')], { ...stmt, inputsInline: true }),
    def('robo_wait_until', 'control_blocks', 'blk.waitUntil', [v('COND', 'Boolean')], { ...stmt, inputsInline: true }),
    { ...def('robo_forever', 'control_blocks', 'blk.forever', []), message1: '%1', args1: [st('DO')], previousStatement: null },
    {
      ...def('robo_repeat', 'control_blocks', 'blk.repeat', [v('TIMES', 'Number')]),
      message1: '%1',
      args1: [st('DO')],
      inputsInline: true,
      ...stmt
    },
    {
      ...def('robo_repeat_until', 'control_blocks', 'blk.repeatUntil', [v('COND', 'Boolean')]),
      message1: '%1',
      args1: [st('DO')],
      inputsInline: true,
      ...stmt
    },
    { ...def('robo_if', 'control_blocks', 'blk.if', [v('COND', 'Boolean')]), message1: '%1', args1: [st('DO')], inputsInline: true, ...stmt },
    {
      ...def('robo_if_else', 'control_blocks', 'blk.if', [v('COND', 'Boolean')]),
      message1: '%1',
      args1: [st('DO')],
      message2: t('blk.else'),
      message3: '%1',
      args3: [st('ELSE')],
      inputsInline: true,
      tooltip: t('blk.ifElseTip'),
      ...stmt
    },
    // operators
    def(
      'robo_compare',
      'operator_blocks',
      'blk.compare',
      [
        v('A', 'Number'),
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [
            ['<', 'LT'],
            ['>', 'GT'],
            ['=', 'EQ'],
            ['≤', 'LE'],
            ['≥', 'GE'],
            ['≠', 'NE']
          ]
        },
        v('B', 'Number')
      ],
      { output: 'Boolean', inputsInline: true }
    ),
    def(
      'robo_arith',
      'operator_blocks',
      'blk.arith',
      [
        v('A', 'Number'),
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [
            ['+', 'ADD'],
            ['−', 'SUB'],
            ['×', 'MUL'],
            ['÷', 'DIV']
          ]
        },
        v('B', 'Number')
      ],
      { output: 'Number', inputsInline: true }
    ),
    def(
      'robo_logic',
      'operator_blocks',
      'blk.logic',
      [
        v('A', 'Boolean'),
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [
            [t('blk.and'), 'AND'],
            [t('blk.or'), 'OR']
          ]
        },
        v('B', 'Boolean')
      ],
      { output: 'Boolean', inputsInline: true }
    ),
    def('robo_not', 'operator_blocks', 'blk.not', [v('A', 'Boolean')], { output: 'Boolean', inputsInline: true }),
    {
      type: 'robo_number',
      style: 'operator_blocks',
      message0: '%1',
      args0: [{ type: 'field_number', name: 'NUM', value: 0 }],
      output: 'Number'
    }
  ]
}

/** Blocks for an Arduino: pins instead of motors and sensors. */
export function arduinoToolbox(): Blockly.utils.toolbox.ToolboxDefinition {
  const b = (type: string, inputs?: object, fields?: object) => ({ kind: 'block', type, ...(inputs ? { inputs } : {}), ...(fields ? { fields } : {}) })
  return {
    kind: 'categoryToolbox',
    contents: [
      { kind: 'category', name: t('blk.catEvents'), categorystyle: 'event_category', contents: [b('robo_start')] },
      {
        kind: 'category',
        name: t('blk.catOutput'),
        categorystyle: 'output_category',
        contents: [
          b('ard_digital_write', undefined, { PIN: 'D13', STATE: 'HIGH' }),
          b('ard_builtin_led', undefined, { STATE: 'ON' }),
          b('ard_analog_write', num('VALUE', 128), { PIN: 'D9' }),
          b('ard_servo', num('ANGLE', 90), { PIN: 'D9' })
        ]
      },
      {
        kind: 'category',
        name: t('blk.catInput'),
        categorystyle: 'sensor_category',
        contents: [b('ard_analog_read', undefined, { PIN: 'A0' }), b('ard_digital_read', undefined, { PIN: 'D2' })]
      },
      {
        kind: 'category',
        name: t('blk.catSerial'),
        categorystyle: 'looks_category',
        contents: [b('ard_serial_println', { TEXT: { shadow: { type: 'robo_text', fields: { TEXT: 'Hello!' } } } })]
      },
      ...commonCategories([b('robo_timer')])
    ]
  } as Blockly.utils.toolbox.ToolboxDefinition
}

/** Categories every program has: control, operators, variables (events come first, separately). */
function commonCategories(extraControl: object[] = []): object[] {
  const b = (type: string, inputs?: object, fields?: object) => ({ kind: 'block', type, ...(inputs ? { inputs } : {}), ...(fields ? { fields } : {}) })
  return [
    {
      kind: 'category',
      name: t('blk.catControl'),
      categorystyle: 'control_category',
      contents: [
        b('robo_wait', num('SECONDS', 1)),
        b('robo_forever'),
        b('robo_repeat', num('TIMES', 10)),
        b('robo_if'),
        b('robo_if_else'),
        b('robo_wait_until'),
        b('robo_repeat_until'),
        ...extraControl
      ]
    },
    {
      kind: 'category',
      name: t('blk.catOperators'),
      categorystyle: 'operator_category',
      contents: [
        b('robo_compare', { ...num('A', 0), ...num('B', 50) }),
        b('robo_logic'),
        b('robo_not'),
        b('robo_arith', { ...num('A', 0), ...num('B', 0) }),
        b('robo_number'),
        b('robo_text')
      ]
    },
    { kind: 'category', name: t('blk.catVariables'), categorystyle: 'variable_category', custom: 'VARIABLE' }
  ]
}

const events = () => {
  const b = (type: string, fields?: object) => ({ kind: 'block', type, ...(fields ? { fields } : {}) })
  const msg = { MSG: messageNames()[0] }
  return {
    kind: 'category',
    name: t('blk.catEvents'),
    categorystyle: 'event_category',
    contents: [
      b('robo_start'),
      b('robo_when_key', { KEY: 'ArrowUp' }),
      b('robo_when_clicked'),
      b('msg_when', msg),
      b('msg_send', msg),
      b('msg_send_wait', msg)
    ]
  }
}

/**
 * The palette for a robot, a lamp or a character ('nerpa:cheetah'… — each species has only the
 * blocks it can do: what a character cannot do is simply not there).
 */
export function toolboxFor(kind: ActorKind | `nerpa:${Species}`): Blockly.utils.toolbox.ToolboxDefinition {
  if (kind === 'robot') return toolbox()
  const species: Species = kind.startsWith('nerpa:') ? (kind.slice(6) as Species) : 'seal'
  if (kind !== 'light') menuSpecies = species
  const b = (type: string, inputs?: object, fields?: object) => ({ kind: 'block', type, ...(inputs ? { inputs } : {}), ...(fields ? { fields } : {}) })
  const text = (name: string, value: string) => ({ [name]: { shadow: { type: 'robo_text', fields: { TEXT: value } } } })
  if (kind === 'light') {
    return {
      kind: 'categoryToolbox',
      contents: [
        events(),
        {
          kind: 'category',
          name: t('blk.catLight'),
          categorystyle: 'light_category',
          contents: [b('light_on'), b('light_off'), b('light_brightness', num('VALUE', 50)), b('light_color', undefined, { COLOR: '#ffd60a' })]
        },
        ...commonCategories([b('robo_timer')])
      ]
    } as Blockly.utils.toolbox.ToolboxDefinition
  }
  return {
    kind: 'categoryToolbox',
    contents: [
      events(),
      {
        kind: 'category',
        name: t('blk.catMotion'),
        categorystyle: 'motion_category',
        contents: [
          b('nerpa_walk', num('CM', 10)),
          ...(species === 'cheetah' ? [b('cheetah_run', num('CM', 50)), b('cheetah_leap'), b('cheetah_crawl', num('CM', 30))] : []),
          ...(species === 'pigeon'
            ? [b('pigeon_takeoff', num('CM', 40)), b('pigeon_fly', num('CM', 50)), b('pigeon_fly_to', { ...num('X', 30), ...num('Y', 30) }), b('pigeon_land')]
            : []),
          b('nerpa_turn', num('DEG', 90), { DIR: 'LEFT' }),
          b('nerpa_heading', num('DEG', 90)),
          b('nerpa_face', undefined, { TARGET: 'ROBOT' }),
          b('nerpa_goto', { ...num('X', 0), ...num('Y', 0) }),
          ...(species === 'seal' ? [b('nerpa_glide', { ...num('X', 30), ...num('Y', 30), ...num('SECONDS', 1) }), b('nerpa_jump')] : [])
        ]
      },
      {
        kind: 'category',
        name: t('blk.catLooks'),
        categorystyle: 'looks_category',
        contents: [
          b('nerpa_say_for', { ...text('TEXT', t('blk.hello')), ...num('SECONDS', 2) }),
          b('nerpa_say', text('TEXT', t('blk.hello'))),
          b('nerpa_color', undefined, { COLOR: '#32d4ff' }),
          b('nerpa_size', num('PERCENT', 150)),
          b('nerpa_hide'),
          b('nerpa_show')
        ]
      },
      {
        kind: 'category',
        name: t('blk.catSensors'),
        categorystyle: 'sensor_category',
        contents: [
          b('nerpa_touching', undefined, { TARGET: 'SHAPE' }),
          b('nerpa_distance', undefined, { TARGET: 'ROBOT' }),
          ...(species === 'seal' ? [b('nerpa_in_water')] : []),
          ...(species === 'cheetah' ? [b('creature_ledge'), b('creature_water')] : []),
          ...(species === 'pigeon' ? [b('pigeon_altitude'), b('creature_water')] : []),
          b('creature_under'),
          b('creature_on', undefined, { SURF: species === 'seal' ? 'water' : species === 'pigeon' ? 'air' : 'grass' }),
          b('creature_ahead_is', undefined, { SURF: species === 'cheetah' ? 'road' : 'water' }),
          b('nerpa_x'),
          b('nerpa_y'),
          b('nerpa_dir'),
          b('robo_timer')
        ]
      },
      {
        kind: 'category',
        name: t('blk.catSound'),
        categorystyle: 'sound_category',
        contents: [
          b('sound_play_wait', undefined, { SOUND: firstSound(species) }),
          b('sound_play', undefined, { SOUND: firstSound(species) }),
          b('sound_stop'),
          b('sound_note', { NOTE: { shadow: { type: 'sound_note_pick', fields: { NOTE: '60' } } }, ...num('BEATS', 0.5) }),
          b('sound_rest', num('BEATS', 0.5)),
          b('sound_tempo', num('BPM', 60)),
          b('sound_volume', num('PERCENT', 100)),
          b('sound_change_volume', num('DELTA', -10)),
          b('sound_volume_get')
        ]
      },
      ...commonCategories()
    ]
  } as Blockly.utils.toolbox.ToolboxDefinition
}

/** What the palette on the left of the block editor offers for a robot. */
export function toolbox(): Blockly.utils.toolbox.ToolboxDefinition {
  const b = (type: string, inputs?: object, fields?: object) => ({ kind: 'block', type, ...(inputs ? { inputs } : {}), ...(fields ? { fields } : {}) })
  const cmp = (op: string, a: number, port = 1) => ({
    kind: 'block',
    type: 'robo_compare',
    fields: { OP: op },
    inputs: { A: { block: { type: 'robo_line_sensor', fields: { PORT: String(port) } } }, ...num('B', a) }
  })
  return {
    kind: 'categoryToolbox',
    contents: [
      events(),
      {
        kind: 'category',
        name: t('blk.catMotion'),
        categorystyle: 'motion_category',
        contents: [
          b('robo_forward', num('POWER', 50)),
          b('robo_backward', num('POWER', 50)),
          b('robo_turn', num('POWER', 40)),
          b('robo_motors', { ...num('LEFT', 50), ...num('RIGHT', 50) }),
          b('robo_motors_for', { ...num('LEFT', 50), ...num('RIGHT', 50), ...num('SECONDS', 1) }),
          b('robo_stop')
        ]
      },
      {
        kind: 'category',
        name: t('blk.catSensors'),
        categorystyle: 'sensor_category',
        contents: [
          b('robo_line_black', undefined, { PORT: '1' }),
          b('robo_line_sensor', undefined, { PORT: '1' }),
          cmp('LT', 50),
          b('robo_distance', undefined, { PORT: '2' }),
          {
            kind: 'block',
            type: 'robo_compare',
            fields: { OP: 'LT' },
            inputs: { A: { block: { type: 'robo_distance', fields: { PORT: '2' } } }, ...num('B', 20) }
          },
          b('robo_touch', undefined, { PORT: '2' }),
          b('robo_light', undefined, { PORT: '1' }),
          b('robo_timer')
        ]
      },
      {
        kind: 'category',
        name: t('blk.catLight'),
        categorystyle: 'light_category',
        contents: [b('robo_flashlight', undefined, { PORT: '2', STATE: 'ON' }), b('robo_flashlight_brightness', num('VALUE', 50), { PORT: '2' })]
      },
      ...commonCategories()
    ]
  } as Blockly.utils.toolbox.ToolboxDefinition
}

/** Blockly theme: Scratch colours for the blocks, the app's own colours around them. */
export function blocklyTheme(): Blockly.Theme {
  const ui = currentTheme().ui
  const blockStyles: Record<string, Partial<Blockly.Theme.BlockStyle>> = {}
  const categoryStyles: Record<string, Blockly.Theme.CategoryStyle> = {}
  for (const [name, [a, b, c]] of Object.entries(STYLES)) {
    blockStyles[name] = { colourPrimary: a, colourSecondary: b, colourTertiary: c, ...(name === 'event_blocks' ? { hat: 'cap' } : {}) }
    categoryStyles[name.replace('_blocks', '_category')] = { colour: a }
  }
  return Blockly.Theme.defineTheme(`robo-${currentTheme().id}`, {
    name: `robo-${currentTheme().id}`,
    base: Blockly.Themes.Zelos,
    blockStyles: blockStyles as Record<string, Blockly.Theme.BlockStyle>,
    categoryStyles,
    componentStyles: {
      workspaceBackgroundColour: ui.panel2,
      toolboxBackgroundColour: ui.panel,
      toolboxForegroundColour: ui.text,
      flyoutBackgroundColour: ui.panel3,
      flyoutForegroundColour: ui.text,
      flyoutOpacity: 0.96,
      scrollbarColour: ui.line,
      scrollbarOpacity: 0.8,
      insertionMarkerColour: ui.accent,
      insertionMarkerOpacity: 0.4,
      cursorColour: ui.accent
    },
    fontStyle: { family: 'Segoe UI, system-ui, sans-serif', weight: '600', size: 11 },
    startHats: false
  })
}

let definedFor: string | null = null

/** (Re)define the blocks so their texts follow the app language. */
export function defineBlocks(): void {
  const l = lang.value
  if (definedFor === l) return
  Blockly.setLocale((l === 'ru' ? Ru : l === 'zh' ? Zh : En) as unknown as Record<string, string>)
  registerMessageMenu()
  for (const d of definitions()) delete Blockly.Blocks[(d as { type: string }).type]
  Blockly.common.defineBlocksWithJsonArray(definitions())
  // Blockly's own variable blocks (their texts come from Blockly's language files)
  Blockly.common.defineBlocks({
    variables_get: variableBlocks.blocks.variables_get,
    variables_set: variableBlocks.blocks.variables_set,
    math_change: mathBlocks.blocks.math_change,
    math_number: mathBlocks.blocks.math_number
  })
  definedFor = l
}

/** A new robot's program: just the start block, ready for blocks to be snapped under it. */
export const EMPTY_PROGRAM = { blocks: { languageVersion: 0, blocks: [{ type: 'robo_start', x: 40, y: 40 }] } }

export { Blockly }
