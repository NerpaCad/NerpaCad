import { expect, test } from '@playwright/test'
import { idle, launch } from './app'

const cad = (win: any, fn: (arg?: any) => any, arg?: any) => win.evaluate(fn, arg)
const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const prog = (...blocks: any[]) => {
  for (let i = blocks.length - 2; i >= 0; i--) blocks[i].next = { block: blocks[i + 1] }
  return { blocks: { languageVersion: 0, blocks: [{ type: 'robo_start', x: 20, y: 20, next: { block: blocks[0] } }] } }
}

test('sounds: each hero has a Sound palette with its own voices; sounds play only during a run, pause and Stop silence them', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('console', (m: any) => m.type() === 'error' && errors.push(m.text()))
  win.on('pageerror', (e: any) => errors.push(String(e)))
  await win.getByTestId('mode-robotics').click()
  await win.waitForTimeout(1200)

  // no heroes: no volume slider
  await expect(win.getByTestId('sim-volume')).toHaveCount(0)
  await win.getByTestId('add-pigeon').scrollIntoViewIfNeeded()
  await win.getByTestId('add-pigeon').click()
  await idle(win)
  await expect(win.getByTestId('sim-volume')).toHaveCount(1)
  await win.waitForTimeout(400)
  await win.locator('.blocklyToolboxCategory', { hasText: 'Звук' }).click()
  const flyout = win.locator('.blocklyFlyout .blocklyText')
  await expect(flyout.filter({ hasText: 'играть звук' })).toHaveCount(2)
  await expect(flyout.filter({ hasText: 'остановить все звуки' })).toHaveCount(1)
  // the pigeon's first voice is preset; its menu has its voices and the common ones, no seal
  await expect(flyout.filter({ hasText: /^воркование/ }).first()).toBeVisible()
  // the robot has no sound blocks
  await cad(win, () => (window as any).__cad.actions.addRobot([600, 300]))
  await idle(win)
  await win.waitForTimeout(400)
  await expect(win.locator('.blocklyToolboxCategory', { hasText: 'Звук' })).toHaveCount(0)

  // a program: a long purr, then notes; while it plays: pause → silent; Stop → all gone
  const id = await cad(win, () => {
    const c = (window as any).__cad
    return c.doc.value.nodes.find((x: any) => x.params?.nerpa?.species === 'pigeon').id
  })
  await cad(win, (i: string) => ((window as any).__cad.selection.value = [i]), id)
  await cad(win, (a: any) => (window as any).__cad.actions.setProgram(a.id, a.program), {
    id,
    program: prog(
      { type: 'sound_volume', inputs: { PERCENT: n(70) } },
      { type: 'sound_play_wait', fields: { SOUND: 'pigeon_coo' } },
      { type: 'sound_note', inputs: { NOTE: { shadow: { type: 'sound_note_pick', fields: { NOTE: '67' } } }, BEATS: n(0.5) } },
      { type: 'sound_play', fields: { SOUND: 'hooray' } },
      { type: 'robo_wait', inputs: { SECONDS: n(10) } }
    )
  })
  // in the editor: the pigeon's menu has its voices and the common ones, not the seal's
  await win.waitForTimeout(500)
  await win.locator('.blocklyBlockCanvas .blocklyText', { hasText: /^воркование/ }).first().click()
  const menu = win.locator('.blocklyDropDownDiv .blocklyMenuItem')
  await expect(menu.filter({ hasText: 'крылья' })).toHaveCount(1)
  await expect(menu.filter({ hasText: 'ура' })).toHaveCount(1)
  await expect(menu.filter({ hasText: 'лай' })).toHaveCount(0)
  await win.keyboard.press('Escape')
  const player = () => cad(win, () => {
    const p = (window as any).__cad.soundPlayer
    return { played: p.played, started: p.started, state: p.state }
  })
  expect((await player()).played).toBe(0)
  await win.getByTestId('sim-start').click()
  await win.waitForFunction(() => (window as any).__cad.soundPlayer.started >= 1, null, { timeout: 10000 })
  await win.waitForFunction(() => (window as any).__cad.soundPlayer.started >= 3, null, { timeout: 10000 })
  expect((await player()).state).toBe('running')
  await win.getByTestId('sim-pause').click()
  await win.waitForFunction(() => (window as any).__cad.soundPlayer.state === 'suspended', null, { timeout: 5000 })
  await win.getByTestId('sim-start').click()
  await win.waitForFunction(() => (window as any).__cad.soundPlayer.state === 'running', null, { timeout: 5000 })
  await win.getByTestId('sim-stop').click()
  expect((await player()).played).toBe(0)

  // the master volume is kept
  await win.getByTestId('sim-volume').fill('30')
  expect(await cad(win, () => localStorage.getItem('cad.volume'))).toBe('30')
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})
