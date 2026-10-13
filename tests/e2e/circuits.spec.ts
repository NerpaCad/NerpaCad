import { expect, test, type Page } from '@playwright/test'
import { launch } from './app'

const circuit = (win: Page) => win.evaluate(() => (window as any).__cad.circuit.value)
const center = async (win: Page, testId: string) => {
  const b = (await win.getByTestId(testId).first().boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

test('circuits: blink example blinks, code view, stop', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(String(e)))
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await win.getByTestId('mode-circuits').click()
  await expect(win.getByTestId('circuit-view')).toBeVisible()
  await win.getByTestId('ckt-demo').click()
  await win.waitForTimeout(400)
  await win.keyboard.press('f')
  await win.waitForTimeout(300)
  expect((await circuit(win)).parts).toHaveLength(3)
  await win.screenshot({ path: 'test-results/ckt-demo.png' })
  await win.getByTestId('ckt-start').click()
  // the LED is lit during the first second and dark in the second
  const led = await win.evaluate(() => (window as any).__cad.circuit.value.parts.find((p: any) => p.kind === 'led').id)
  await win.waitForFunction(() => (window as any).__cad.circuitResult.value !== null)
  await win.waitForFunction((id) => ((window as any).__cad.circuitResult.value?.leds.get(id)?.brightness ?? 0) > 0.5, led)
  await win.screenshot({ path: 'test-results/ckt-lit.png' })
  await win.waitForFunction((id) => ((window as any).__cad.circuitResult.value?.leds.get(id)?.brightness ?? 1) === 0, led, { timeout: 5000 })
  await win.getByTestId('ckt-stop').click()
  expect(await win.evaluate(() => (window as any).__cad.circuitState.value)).toBe('idle')
  // the program as Arduino code
  await win.getByTestId('view-code').click()
  await expect(win.getByTestId('code-view')).toContainText('pinMode(13, OUTPUT);')
  await expect(win.getByTestId('code-view')).toContainText('delay(1000);')
  await win.screenshot({ path: 'test-results/ckt-code.png' })
  await win.getByTestId('view-blocks').click()
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})

test('circuits: build from parts, wire with clicks, burn an LED without a resistor', async () => {
  const { app, win } = await launch()
  await win.getByTestId('mode-circuits').click()
  const view = (await win.getByTestId('circuit-view').boundingBox())!
  // drag an Arduino and an LED onto the board
  const drop = async (id: string, x: number, y: number) => {
    const c = await center(win, id)
    await win.mouse.move(c.x, c.y)
    await win.mouse.down()
    await win.mouse.move(x - 30, y, { steps: 4 })
    await win.mouse.move(x, y, { steps: 4 })
    await win.mouse.up()
    await win.waitForTimeout(150)
  }
  await drop('add-arduino', view.x + view.width * 0.35, view.y + view.height * 0.5)
  await drop('add-led', view.x + view.width * 0.75, view.y + view.height * 0.35)
  let c = await circuit(win)
  expect(c.parts.map((p: any) => p.kind)).toEqual(['arduino', 'led'])
  // wire D13 → anode (with a bend), cathode → GND
  const click = async (testId: string) => {
    const p = await center(win, testId)
    await win.mouse.click(p.x, p.y)
    await win.waitForTimeout(80)
  }
  await click('pin-arduino-D13')
  const a = await center(win, 'pin-led-anode')
  await win.mouse.click(a.x, a.y + 40)
  await click('pin-led-anode')
  await click('pin-led-cathode')
  await click('pin-arduino-GND.1')
  c = await circuit(win)
  expect(c.wires).toHaveLength(2)
  expect(c.wires[0].points).toHaveLength(1)
  expect(c.wires[1].color).toBe('#222222')
  await win.screenshot({ path: 'test-results/ckt-wired.png' })
  // program: pin 13 HIGH under the start block (set through the document)
  await win.evaluate(() => {
    const cad = (window as any).__cad
    const uno = cad.circuit.value.parts[0]
    cad.circuitActions.setArduinoProgram(uno.id, {
      blocks: { languageVersion: 0, blocks: [{ type: 'robo_start', x: 20, y: 20, next: { block: { type: 'ard_digital_write', fields: { PIN: 'D13', STATE: 'HIGH' } } } }] }
    })
  })
  await win.waitForTimeout(500)
  await win.keyboard.press('Space')
  await win.waitForFunction(() => (window as any).__cad.circuitResult.value && [...((window as any).__cad.circuitState.value === 'running' ? [1] : [])].length)
  await win.waitForTimeout(500)
  await expect(win.locator('.toast.error')).toContainText(/перегорел|burnt/)
  await win.screenshot({ path: 'test-results/ckt-burnt.png' })
  await win.keyboard.press('Escape')
  // undo removes the program, then wires, one by one
  const before = (await circuit(win)).wires.length
  await win.keyboard.press('Control+z')
  await win.keyboard.press('Control+z')
  expect((await circuit(win)).wires.length).toBe(before - 1)
  // select the LED and delete it: its wires go too
  const l = await center(win, 'part-led')
  await win.mouse.click(l.x, l.y - 10)
  await win.keyboard.press('Delete')
  c = await circuit(win)
  expect(c.parts.map((p: any) => p.kind)).toEqual(['arduino'])
  expect(c.wires).toHaveLength(0)
  await app.close()
})
