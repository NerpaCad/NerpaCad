import { expect, test, type Page } from '@playwright/test'
import { launch } from './app'

const circuit = (win: Page) => win.evaluate(() => (window as any).__cad.circuit.value)
const center = async (win: Page, testId: string) => {
  const b = (await win.getByTestId(testId).first().boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

test('breadboard example: the knob turns the servo, dims the LED and prints to the serial monitor', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await win.getByTestId('mode-circuits').click()
  await win.getByTestId('ckt-demo2').click()
  await win.waitForTimeout(400)
  await win.keyboard.press('f')
  await win.waitForTimeout(300)
  const c = await circuit(win)
  expect(c.parts.map((p: any) => p.kind).sort()).toEqual(['arduino', 'breadboard', 'led', 'pot', 'resistor', 'servo'])
  const id = (k: string) => c.parts.find((p: any) => p.kind === k).id
  await win.getByTestId('ckt-start').click()
  // the knob in the middle: the LED at about half, the servo at 90°
  await win.waitForFunction((l) => ((window as any).__cad.circuitResult.value?.leds.get(l)?.current ?? 0) > 0.002, id('led'))
  await win.waitForFunction((s) => (window as any).__cad.circuitServos.value[s]?.driven, id('servo'))
  expect(Math.abs((await win.evaluate((s) => (window as any).__cad.circuitServos.value[s].angle, id('servo'))) - 90)).toBeLessThan(2)
  const dim = await win.evaluate((l) => (window as any).__cad.circuitResult.value.leds.get(l).current, id('led'))

  // turn the knob to the far end with the mouse: press above its centre, go round clockwise
  const pot = (await win.getByTestId('part-pot').boundingBox())!
  const cx = pot.x + pot.width / 2
  const cy = pot.y + pot.height * 0.39
  const r = pot.height * 0.3
  // a click alone does not turn it
  await win.mouse.click(cx, cy - r)
  expect(await win.evaluate((p) => (window as any).__cad.circuitKnobs.value[p], id('pot'))).toBe(0.5)
  await win.mouse.move(cx, cy - r)
  await win.mouse.down()
  await win.mouse.move(cx + r * 0.7, cy - r * 0.7, { steps: 3 })
  await win.mouse.move(cx + r, cy, { steps: 3 })
  await win.mouse.move(cx + r * 0.7, cy + r * 0.7, { steps: 3 })
  await win.mouse.up()
  const knob = await win.evaluate((p) => (window as any).__cad.circuitKnobs.value[p], id('pot'))
  expect(knob).toBeGreaterThan(0.9)
  await win.waitForFunction((s) => ((window as any).__cad.circuitServos.value[s]?.angle ?? 0) > 160, id('servo'))
  const bright = await win.evaluate((l) => (window as any).__cad.circuitResult.value.leds.get(l).current, id('led'))
  expect(bright).toBeGreaterThan(dim * 1.5)
  await win.screenshot({ path: 'test-results/ckt6-run.png' })

  // the serial monitor shows the readings
  await win.getByTestId('view-serial').click()
  await expect(win.getByTestId('serial-view')).toContainText(/10[0-2][0-9]/)
  // the code for the Arduino IDE
  await win.getByTestId('view-code').click()
  await expect(win.getByTestId('code-view')).toContainText('#include <Servo.h>')
  await expect(win.getByTestId('code-view')).toContainText('analogRead(A0)')
  await expect(win.getByTestId('code-view')).toContainText('Serial.begin(9600);')
  await win.getByTestId('ckt-stop').click()
  // the document keeps its own knob position: the run changes nothing
  expect((await circuit(win)).parts.find((p: any) => p.kind === 'pot').knob).toBe(0.5)
  await win.getByTestId('view-blocks').click()
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})

test('a part dragged onto the breadboard plugs into the holes and moves with the board', async () => {
  const { app, win } = await launch()
  await win.getByTestId('mode-circuits').click()
  const view = (await win.getByTestId('circuit-view').boundingBox())!
  const drop = async (id: string, x: number, y: number) => {
    const c = await center(win, id)
    await win.mouse.move(c.x, c.y)
    await win.mouse.down()
    await win.mouse.move(x - 30, y, { steps: 4 })
    await win.mouse.move(x, y, { steps: 4 })
    await win.mouse.up()
    await win.waitForTimeout(150)
  }
  await drop('add-breadboard', view.x + view.width * 0.5, view.y + view.height * 0.5)
  await win.keyboard.press('f')
  await win.waitForTimeout(300)
  // drop a resistor roughly over the middle of the board: its legs go straight into holes
  await drop('add-resistor', view.x + view.width * 0.5 + 3, view.y + view.height * 0.4 + 2)
  let c = await circuit(win)
  expect(c.parts.map((p: any) => p.kind)).toEqual(['breadboard', 'resistor'])
  const plugged = () => win.evaluate(() => document.querySelectorAll('.ckt-hole.plugged').length)
  expect(await plugged()).toBe(2)
  // drag the board: the resistor goes along and stays plugged in
  c = await circuit(win)
  const before = c.parts.find((p: any) => p.kind === 'resistor')
  const bbBox = (await win.getByTestId('part-breadboard').boundingBox())!
  await win.mouse.move(bbBox.x + 8, bbBox.y + 8)
  await win.mouse.down()
  await win.mouse.move(bbBox.x + 60, bbBox.y + 48, { steps: 6 })
  await win.mouse.up()
  c = await circuit(win)
  const after = c.parts.find((p: any) => p.kind === 'resistor')
  expect(after.x).not.toBe(before.x)
  expect(await plugged()).toBe(2)
  // turning the board (R) takes the resistor along: still plugged in, now standing upright
  await win.keyboard.press('r')
  await win.waitForTimeout(200)
  expect(await plugged()).toBe(2)
  c = await circuit(win)
  expect(c.parts.find((p: any) => p.kind === 'resistor').rot).toBe(90)
  await win.keyboard.press('Control+z')
  await win.waitForTimeout(200)
  expect(await plugged()).toBe(2)
  await win.screenshot({ path: 'test-results/ckt6-board.png' })
  await app.close()
})
