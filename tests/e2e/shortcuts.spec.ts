import { expect, test } from '@playwright/test'
import { idle, launch, nodes } from './app'

/** A key as a Russian keyboard layout sends it: the Cyrillic letter, the physical key code. */
const ru = (win: import('@playwright/test').Page, key: string, code: string, ctrl = false, shift = false) =>
  win.evaluate(
    ([key, code, ctrl, shift]) =>
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code, ctrlKey: ctrl, shiftKey: shift, bubbles: true })),
    [key, code, ctrl, shift] as const
  )

test('Ctrl shortcuts work with a Russian keyboard layout; Ctrl+D repeats the last move', async () => {
  const { app, win } = await launch()
  await win.click('[data-testid=shape-box]')
  await idle(win)
  expect(await nodes(win)).toHaveLength(1)
  // Ctrl+D (Ctrl+В), move the copy 30 mm, Ctrl+D twice more: a row with 30 mm steps
  await ru(win, 'в', 'KeyD', true)
  await idle(win)
  await win.evaluate(() => (window as any).__cad.actions.nudge(30, 0, 0))
  await ru(win, 'в', 'KeyD', true)
  await ru(win, 'в', 'KeyD', true)
  await idle(win)
  let xs = (await nodes(win)).map((n: any) => n.transform.position[0])
  expect(xs).toEqual([0, 30, 60, 90])
  // Ctrl+Z (Ctrl+Я) twice, Ctrl+Y (Ctrl+Н) once
  await ru(win, 'я', 'KeyZ', true)
  await ru(win, 'я', 'KeyZ', true)
  expect(await nodes(win)).toHaveLength(2)
  await ru(win, 'н', 'KeyY', true)
  expect(await nodes(win)).toHaveLength(3)
  // Ctrl+A (Ctrl+Ф), Ctrl+G (Ctrl+П): one group; Ctrl+Shift+G takes it apart
  await ru(win, 'ф', 'KeyA', true)
  await ru(win, 'п', 'KeyG', true)
  await idle(win)
  expect(await nodes(win)).toHaveLength(1)
  await ru(win, 'П', 'KeyG', true, true)
  expect(await nodes(win)).toHaveLength(3)
  // Ctrl+C / Ctrl+V (Ctrl+С / Ctrl+М)
  await win.evaluate(() => { const c = (window as any).__cad; c.selection.value = [c.doc.value.nodes[0].id] })
  await ru(win, 'с', 'KeyC', true)
  await ru(win, 'м', 'KeyV', true)
  expect(await nodes(win)).toHaveLength(4)
  // H (Р) makes the selection a hole, S (Ы) solid again
  await ru(win, 'р', 'KeyH')
  expect((await nodes(win))[3].isHole).toBe(true)
  await ru(win, 'ы', 'KeyS')
  expect((await nodes(win))[3].isHole).toBe(false)
  await app.close()
})
