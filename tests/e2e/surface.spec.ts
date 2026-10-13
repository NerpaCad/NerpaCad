import { expect, test } from '@playwright/test'
import { idle, launch } from './app'

const cad = (win: any, fn: (arg?: any) => any, arg?: any) => win.evaluate(fn, arg)

test('"under me": every hero has the blocks, the robot does not; the cheetah says what it stands on in the user’s language', async () => {
  test.setTimeout(120000)
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('console', (m: any) => m.type() === 'error' && errors.push(m.text()))
  win.on('pageerror', (e: any) => errors.push(String(e)))
  await win.getByTestId('mode-robotics').click()
  await win.waitForTimeout(1000)
  const ids = await cad(win, () => {
    const A = (window as any).__cad.actions
    A.addLand('sand', [450, 450])
    A.addLand('water', [750, 450])
    return {
      robot: A.addRobot([1050, 1050]),
      seal: A.addNerpa([1350, 450], 'seal'),
      cheetah: A.addNerpa([450, 450], 'cheetah'),
      pigeon: A.addNerpa([1350, 1050], 'pigeon')
    }
  })
  await idle(win)
  const select = (id: string) => cad(win, (i: string) => ((window as any).__cad.selection.value = [i]), id)
  for (const [id, has] of [
    [ids.seal, 1],
    [ids.cheetah, 1],
    [ids.pigeon, 1],
    [ids.robot, 0]
  ] as [string, number][]) {
    await select(id)
    await win.waitForTimeout(500)
    await win.locator('.blocklyToolboxCategory', { hasText: 'Датчики' }).click()
    const flyout = win.locator('.blocklyFlyout .blocklyText')
    await expect(flyout.filter({ hasText: 'подо' })).toHaveCount(has)
    await expect(flyout.filter({ hasText: 'стою' })).toHaveCount(has)
    await win.keyboard.press('Escape')
  }
  await cad(win, (id: string) => {
    const c = (window as any).__cad
    c.actions.setProgram(id, {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'robo_start',
            x: 20,
            y: 20,
            next: {
              block: {
                type: 'robo_if',
                inputs: {
                  COND: { block: { type: 'creature_ahead_is', fields: { SURF: 'water' } } },
                  DO: { block: { type: 'nerpa_say', inputs: { TEXT: { block: { type: 'creature_under' } } } } }
                }
              }
            }
          }
        ]
      }
    })
  }, ids.cheetah)
  await win.getByTestId('sim-start').click()
  await win.waitForFunction((id: string) => (window as any).__cad.viewport.sync.objects.get(id).visual?.userData.say === 'песок', ids.cheetah, {
    timeout: 15000
  })
  await win.getByTestId('sim-stop').click()
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})
