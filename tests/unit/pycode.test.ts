/** Block programs as Python-style text: events become functions, loops and conditions Python's own. */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { lineFollowerProgram, start, workspaceJson } from '@/core/robotics/demo'
import { programToPython, pyName } from '@/core/robotics/pycode'
import type { BlockJson } from '@/core/robotics/interpreter'

let bid = 0
const blk = (type: string, inputs: Record<string, unknown> = {}, fields: Record<string, unknown> = {}): BlockJson => ({ type, id: `b${++bid}`, inputs, fields }) as BlockJson
const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const seq = (list: BlockJson[]): BlockJson | undefined => {
  for (let i = list.length - 2; i >= 0; i--) list[i].next = { block: list[i + 1] }
  return list[0]
}

/** Python itself says whether the text parses (skipped where there is no Python). */
const python = spawnSync('python3', ['--version']).status === 0
const parses = (code: string) => spawnSync('python3', ['-c', 'import ast,sys; ast.parse(sys.stdin.read())'], { input: code }).status === 0

describe('blocks as Python', () => {
  it('the demo line follower: a function per start block, a loop, an if/else on the sensors', () => {
    const code = programToPython(lineFollowerProgram(), 'robot', 'Robot 1')
    expect(code.startsWith('# Robot 1\n')).toBe(true)
    expect(code).toContain('@when_start\ndef main():\n    while True:\n        if robot.line_is_black(1):')
    expect(code).toMatch(/robot\.motors\(\d+, \d+\)/)
    expect(code).toContain('        else:')
    if (python) expect(parses(code)).toBe(true)
  })

  it('a hero with variables (Cyrillic names), messages, keys, maths and a loose block', () => {
    const program = {
      ...workspaceJson([
        start([
          blk('variables_set', { VALUE: n(3) }, { VAR: { id: 'v1' } }),
          blk('robo_repeat', {
            TIMES: { block: blk('variables_get', {}, { VAR: { id: 'v1' } }) },
            DO: {
              block: seq([
                blk('nerpa_walk', { CM: { block: blk('robo_arith', { A: n(2), B: { block: blk('robo_arith', { A: n(3), B: n(4) }, { OP: 'MUL' }) } }, { OP: 'ADD' }) } }),
                blk('nerpa_turn', { DEG: n(90) }, { DIR: 'RIGHT' }),
                blk('math_change', { DELTA: n(-1) }, { VAR: { id: 'v1' } })
              ])
            }
          }),
          blk('robo_if', { COND: { block: blk('robo_logic', { A: { block: blk('creature_on', {}, { SURF: 'sand' }) }, B: { block: blk('robo_not', { A: { block: blk('creature_water') } }) } }, { OP: 'AND' }) } }),
          blk('nerpa_say_for', { TEXT: { block: blk('robo_text', {}, { TEXT: 'Привет "мир"' }) }, SECONDS: n(2) }),
          blk('msg_send', {}, { MSG: 'go' })
        ]),
        { ...blk('msg_when', {}, { MSG: 'go' }), next: { block: blk('nerpa_jump') } },
        { ...blk('robo_when_key', {}, { KEY: 'ArrowUp' }), next: { block: blk('cheetah_run', { CM: n(50) }) } },
        blk('nerpa_hide')
      ]),
      variables: [{ name: 'шаги осталось', id: 'v1' }]
    }
    const code = programToPython(program, 'hero')
    expect(code).toContain('шаги_осталось = 0')
    expect(code).toContain('    global шаги_осталось\n')
    expect(code).toContain('for _ in range(шаги_осталось):')
    expect(code).toContain('hero.walk(2 + (3 * 4))')
    expect(code).toContain('hero.turn_right(90)')
    expect(code).toContain('шаги_осталось += -1')
    expect(code).toContain('if (hero.standing_on() == "sand") and (not hero.water_ahead()):\n        pass')
    expect(code).toContain('hero.say("Привет \\"мир\\"", seconds=2)')
    expect(code).toContain('@when_message("go")\ndef on_go():\n    hero.jump()')
    expect(code).toContain('@when_key("ArrowUp")\ndef on_key_arrowup():\n    hero.run(50)')
    expect(code).toContain('# not under an event block: these blocks do not run\n# hero.hide()')
    if (python) expect(parses(code)).toBe(true)
  })

  it('names Python accepts; an empty program is still valid', () => {
    expect(pyName('my var')).toBe('my_var')
    expect(pyName('2nd')).toBe('_2nd')
    expect(pyName('while')).toBe('while_')
    expect(pyName('!!!')).toBe('var')
    const empty = programToPython(workspaceJson([start([])]), 'lamp')
    expect(empty).toBe('@when_start\ndef main():\n    pass\n')
  })
})
