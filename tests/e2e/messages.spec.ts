import { expect, test } from '@playwright/test'
import { idle, launch } from './app'

const cad = (win: any, fn: (arg?: any) => any, arg?: any) => win.evaluate(fn, arg)
const prog = (...tops: any[]) => ({ blocks: { languageVersion: 0, blocks: tops } })

test('messages: names are shared by the whole field, "New message…" makes one, the robot tells the seal what to do', async () => {
  test.setTimeout(120000)
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('console', (m: any) => m.type() === 'error' && errors.push(m.text()))
  win.on('pageerror', (e: any) => errors.push(String(e)))
  await win.getByTestId('mode-robotics').click()
  await win.waitForTimeout(1000)
  const ids = await cad(win, () => {
    const A = (window as any).__cad.actions
    return { robot: A.addRobot([450, 450]), seal: A.addNerpa([1050, 450], 'seal'), lamp: A.addLight('point', [750, 1050]) }
  })
  await idle(win)
  const select = (id: string) => cad(win, (i: string) => ((window as any).__cad.selection.value = [i]), id)

  // the palettes of the robot, the seal and the lamp all have the three message blocks
  for (const id of [ids.robot, ids.seal, ids.lamp]) {
    await select(id)
    await win.waitForTimeout(500)
    await win.locator('.blocklyToolboxCategory', { hasText: 'События' }).click()
    const flyout = win.locator('.blocklyFlyout .blocklyText')
    // (Blockly writes spaces as non-breaking ones)
    await expect(flyout.filter({ hasText: /когда\sя\sполучаю/ })).toHaveCount(1)
    await expect(flyout.filter({ hasText: /^передать\sсообщение$/ })).toHaveCount(2)
    await expect(flyout.filter({ hasText: /^и\sждать$/ })).toHaveCount(1)
    await win.keyboard.press('Escape')
  }

  // the robot's program: a "broadcast" block; its menu makes a new name
  await select(ids.robot)
  await cad(win, (a: any) => (window as any).__cad.actions.setProgram(a.id, a.p), {
    id: ids.robot,
    p: prog({ type: 'robo_start', x: 20, y: 20, next: { block: { type: 'msg_send', fields: { MSG: 'сообщение1' } } } })
  })
  await win.waitForTimeout(600)
  await win.locator('.blocklyBlockCanvas .blocklyText', { hasText: 'сообщение1' }).first().click()
  await win.locator('.blocklyDropDownDiv .blocklyMenuItem', { hasText: 'Новое сообщение…' }).click()
  await win.locator('.blockly-prompt input').fill('прыгай')
  await win.locator('.blockly-prompt [data-a=ok]').click()
  await expect(win.locator('.blocklyBlockCanvas .blocklyText', { hasText: 'прыгай' })).toHaveCount(1)
  // saved into the robot's program
  await win.waitForFunction(
    (id: string) => JSON.stringify((window as any).__cad.doc.value.nodes.find((n: any) => n.id === id).params.robot.program).includes('прыгай'),
    ids.robot,
    { timeout: 5000 }
  )

  // the seal's "when I receive" offers the robot's name
  await select(ids.seal)
  await cad(win, (a: any) => (window as any).__cad.actions.setProgram(a.id, a.p), {
    id: ids.seal,
    p: prog({
      type: 'msg_when',
      x: 20,
      y: 20,
      fields: { MSG: 'сообщение1' },
      next: { block: { type: 'nerpa_say', inputs: { TEXT: { shadow: { type: 'robo_text', fields: { TEXT: 'Прыгаю!' } } } }, next: { block: { type: 'nerpa_jump' } } } }
    })
  })
  await win.waitForTimeout(600)
  await win.locator('.blocklyBlockCanvas .blocklyText', { hasText: 'сообщение1' }).first().click()
  await win.locator('.blocklyDropDownDiv .blocklyMenuItem', { hasText: 'прыгай' }).click()
  await win.waitForFunction(
    (id: string) => JSON.stringify((window as any).__cad.doc.value.nodes.find((n: any) => n.id === id).params.nerpa.program).includes('прыгай'),
    ids.seal,
    { timeout: 5000 }
  )

  // run: the robot sends, the seal answers
  await win.getByTestId('sim-start').click()
  await win.waitForFunction(
    (id: string) => (window as any).__cad.viewport.sync.objects.get(id).visual?.userData.say === 'Прыгаю!',
    ids.seal,
    { timeout: 15000 }
  )
  await win.getByTestId('sim-stop').click()
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})
