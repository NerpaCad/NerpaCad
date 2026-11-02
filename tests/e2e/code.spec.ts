/** The block panel's Code tab for the robotics field: the selected robot's program as Python. */
import { expect, test } from '@playwright/test'
import { idle, launch } from './app'

test('the Code tab shows the robot\'s program as Python and follows the selection', async () => {
  const { app, win } = await launch()
  await win.getByTestId('mode-robotics').click()
  const ids = await win.evaluate(() => {
    const A = (window as any).__cad.actions
    const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
    const robot = A.addRobot([450, 450])
    A.setProgram(robot, {
      blocks: { languageVersion: 0, blocks: [{ type: 'robo_start', id: 'st', x: 20, y: 20, next: { block: { type: 'robo_motors', id: 'm', inputs: { LEFT: n(70), RIGHT: n(30) } } } }] }
    })
    const seal = A.addNerpa([1050, 450])
    return { robot, seal }
  })
  await idle(win)
  await win.evaluate((id: string) => ((window as any).__cad.selection.value = [id]), ids.robot)
  await win.getByTestId('view-code').click()
  await expect(win.getByTestId('code-view')).toContainText('@when_start')
  await expect(win.getByTestId('code-view')).toContainText('robot.motors(70, 30)')
  await win.screenshot({ path: 'test-results/code-tab.png' })
  // the seal's (empty) program: a hero
  await win.evaluate((id: string) => ((window as any).__cad.selection.value = [id]), ids.seal)
  await expect(win.getByTestId('code-view')).not.toContainText('robot.motors')
  await win.getByTestId('view-blocks').click()
  await expect(win.getByTestId('blockly-host')).toBeVisible()
  await app.close()
})
