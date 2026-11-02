/**
 * Circuits 0.3 in the app: the new parts in the panel and their settings; the room (its sliders,
 * things on the table, a lamp switched by a click, things deleted); the examples running — the
 * night light reacts to the room's light, the parking sensor to the box moved during the run (the
 * project keeps it where it was), the motor to the button held with the mouse.
 */
import { expect, test } from '@playwright/test'
import { launch } from './app'

const cad = (win: any, fn: (arg?: any) => any, arg?: any) => win.evaluate(fn, arg)
const ckt = (win: any) => cad(win, () => (window as any).__cad.circuit.value)
const live = (win: any, id: string) => cad(win, (i: string) => (window as any).__cad.circuitLive.value[i], id)

test('new parts and their settings; the room: sliders, things on the table, a lamp, delete', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.getByTestId('mode-circuits').click()
  for (const k of ['button', 'switch', 'buzzer', 'rgb', 'ldr', 'battery', 'meter', 'seg7', 'motor', 'npn', 'diode', 'lcd', 'joystick', 'tmp36', 'hcsr04', 'ir', 'pir'])
    await expect(win.getByTestId(`add-${k}`)).toBeVisible()
  await win.getByTestId('add-battery').click()
  await win.getByTestId('volts-3').click()
  expect((await ckt(win)).parts[0]).toMatchObject({ kind: 'battery', volts: 3 })
  await win.getByTestId('add-meter').click()
  await win.getByTestId('meter-A').click()
  expect((await ckt(win)).parts[1]).toMatchObject({ kind: 'meter', mode: 'A' })

  // the room
  await win.getByTestId('room-temp').fill('30')
  expect((await ckt(win)).room.temp).toBe(30)
  // the lamp and the box put on the table away from the parts
  const lt = await win.locator('[data-testid=add-item-lamp]').boundingBox()
  const area = await win.locator('[data-testid=circuit-view]').boundingBox()
  await win.mouse.move(lt!.x + lt!.width / 2, lt!.y + lt!.height / 2)
  await win.mouse.down()
  await win.mouse.move(area!.x + 120, area!.y + 380, { steps: 6 })
  await win.mouse.up()
  const bx = await win.locator('[data-testid=add-item-box]').boundingBox()
  const view = await win.locator('[data-testid=circuit-view]').boundingBox()
  await win.mouse.move(bx!.x + bx!.width / 2, bx!.y + bx!.height / 2)
  await win.mouse.down()
  await win.mouse.move(view!.x + 150, view!.y + 120, { steps: 6 })
  await win.mouse.up()
  const items = (await ckt(win)).room.items
  expect(items.map((i: any) => i.kind)).toEqual(['lamp', 'box'])
  expect(items[0].on).toBe(true)
  // a click on the lamp switches it off (one undo step)
  const lamp = win.locator('[data-testid=item-lamp]')
  const b = await lamp.boundingBox()
  await win.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2)
  expect((await ckt(win)).room.items[0].on).toBeFalsy()
  await win.keyboard.press('Control+Z')
  expect((await ckt(win)).room.items[0].on).toBe(true)
  // the box selected and deleted
  const boxId = (await ckt(win)).room.items.find((i: any) => i.kind === 'box').id
  await cad(win, (id: string) => ((window as any).__cad.circuitSelection.value = [id]), boxId)
  await win.locator('[data-testid=circuit-view]').hover()
  await win.keyboard.press('Delete')
  expect((await ckt(win)).room.items.map((i: any) => i.kind)).toEqual(['lamp'])
  await win.getByTestId('ckt-panel').screenshot({ path: 'test-results/ckt3-panel.png' })
  expect(errors).toEqual([])
  await app.close()
})

test('examples: the night light and the room light; the parking sensor and the box; the motor and the button', async () => {
  test.setTimeout(90000)
  const { app, win } = await launch()
  win.on('dialog', (d: any) => void d.accept())
  await win.getByTestId('mode-circuits').click()

  // night light: dark room → the LED comes on
  await win.getByTestId('ckt-demo-night').click()
  const led = (await ckt(win)).parts.find((p: any) => p.kind === 'led').id
  const bright = () => cad(win, (i: string) => (window as any).__cad.circuitResult.value?.leds.get(i)?.brightness ?? 0, led)
  await win.getByTestId('ckt-start').click()
  await win.waitForTimeout(500)
  expect(await bright()).toBe(0)
  await win.getByTestId('room-light').fill('3')
  await expect.poll(bright).toBeGreaterThan(0.5)
  await win.getByTestId('ckt-stop').click()
  // the slider moved during the run only: the project keeps its room
  expect((await ckt(win)).room.light).toBe(300)

  // parking sensor: the box dragged closer during the run
  await win.getByTestId('ckt-demo-parking').click()
  await win.locator('[data-testid=circuit-view]').hover()
  await win.keyboard.press('f')
  await win.getByTestId('ckt-start').click()
  await expect(win.getByTestId('lcd-line-1')).toContainText('25')
  const was = (await ckt(win)).room.items[0]
  const bx = await win.locator('[data-testid=item-box]').boundingBox()
  const sonar = await win.locator('[data-testid=pin-hcsr04-VCC]').boundingBox()
  await win.mouse.move(bx!.x + bx!.width / 2, bx!.y + bx!.height / 2)
  await win.mouse.down()
  const from = bx!.y + bx!.height / 2
  await win.mouse.move(bx!.x + bx!.width / 2, sonar!.y - (sonar!.y - from) * 0.25, { steps: 8 })
  await win.mouse.up()
  await expect.poll(async () => Number(((await win.getByTestId('lcd-line-1').textContent()) ?? '').trim().split(/\s+/)[0])).toBeLessThan(20)
  const bz = (await ckt(win)).parts.find((p: any) => p.kind === 'buzzer').id
  await expect.poll(async () => (await live(win, bz))?.freq, { timeout: 5000 }).toBe(1000)
  await win.screenshot({ path: 'test-results/ckt3-parking.png' })
  await win.getByTestId('ckt-stop').click()
  expect((await ckt(win)).room.items[0]).toEqual(was)

  // the motor runs while the button is held
  await win.getByTestId('ckt-demo-motor').click()
  await win.locator('[data-testid=circuit-view]').hover()
  await win.keyboard.press('f')
  const mot = (await ckt(win)).parts.find((p: any) => p.kind === 'motor').id
  await win.getByTestId('ckt-start').click()
  await win.waitForTimeout(300)
  expect((await live(win, mot)).speed).toBe(0)
  const btn = await win.locator('[data-testid=part-button]').boundingBox()
  await win.mouse.move(btn!.x + btn!.width / 2, btn!.y + btn!.height / 2)
  await win.mouse.down()
  await expect.poll(async () => (await live(win, mot)).speed).toBeGreaterThan(1)
  await win.mouse.up()
  await expect.poll(async () => (await live(win, mot)).speed).toBe(0)
  await win.getByTestId('ckt-stop').click()
  await app.close()
})
