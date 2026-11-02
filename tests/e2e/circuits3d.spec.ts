/**
 * The circuit in 3D: the 2D / 3D switch, the parts built on a table, a run seen there (the
 * parking sensor's display, a box dragged on the table towards it, the motor turning while its
 * button is held with the mouse), a lamp switched by a click while editing (one undo step).
 */
import { expect, test } from '@playwright/test'
import { launch } from './app'

const cad = (win: any, fn: (arg?: any) => any, arg?: any) => win.evaluate(fn, arg)
const ckt = (win: any) => cad(win, () => (window as any).__cad.circuit.value)
const live = (win: any, id: string) => cad(win, (i: string) => (window as any).__cad.circuitLive.value[i], id)
const toScreen = (win: any, x: number, y: number, z: number) => cad(win, (a: number[]) => (window as any).__cad.circuitScene().toScreen(a[0], a[1], a[2]), [x, y, z])
const partScreen = (win: any, id: string, x: number, y: number, z: number) =>
  cad(win, (a: any[]) => (window as any).__cad.circuitScene().partScreen(a[0], a[1], a[2], a[3]), [id, x, y, z])

test('3D view: the switch, the parts on a table, a run: the parking sensor and a box, the motor and its button; a lamp clicked, in the dark too', async () => {
  test.setTimeout(150000)
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e: Error) => errors.push(e.message))
  win.on('dialog', (d: any) => void d.accept())
  await win.getByTestId('mode-circuits').click()
  await win.getByTestId('ckt-demo-parking').click()
  await win.getByTestId('ckt-view-3d').click()
  await expect(win.getByTestId('circuit-3d')).toBeVisible()
  await expect(win.locator('[data-testid=circuit-3d] canvas')).toBeVisible()
  const kinds = [...new Set((await ckt(win)).parts.map((p: any) => p.kind))] as string[]
  for (const k of kinds) expect(await cad(win, (kk: string) => (window as any).__cad.circuitScene().meshCount(kk), k), k).toBeGreaterThan(0)
  await win.waitForTimeout(400)
  await win.screenshot({ path: 'test-results/ckt3d-parking.png' })

  // the run: the display shows the distance to the box, the box is dragged closer on the table
  await win.getByTestId('ckt-start').click()
  const sonarId = (await ckt(win)).parts.find((p: any) => p.kind === 'hcsr04').id
  await expect.poll(async () => (await live(win, sonarId))?.sense ?? 0).toBeGreaterThan(20)
  const box = (await ckt(win)).room.items[0]
  const sonar = (await ckt(win)).parts.find((p: any) => p.kind === 'hcsr04')
  const from = await toScreen(win, box.x, box.y, 40)
  const to = await toScreen(win, box.x, box.y + (sonar.y - 13.6 - 25 - box.y) * 0.7, 40)
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(to.x, to.y, { steps: 10 })
  await win.mouse.up()
  await expect.poll(async () => (await live(win, sonarId))?.sense ?? 99).toBeLessThan(20)
  await win.waitForTimeout(300)
  await win.screenshot({ path: 'test-results/ckt3d-parking-run.png' })
  await win.getByTestId('ckt-stop').click()
  // moved during the run only: the project keeps the box where it was
  expect((await ckt(win)).room.items[0]).toEqual(box)

  // the motor turns while the button's cap is held
  await win.getByTestId('ckt-demo-motor').click()
  await win.keyboard.press('f')
  const parts = (await ckt(win)).parts
  const mot = parts.find((p: any) => p.kind === 'motor').id
  const btn = parts.find((p: any) => p.kind === 'button').id
  await win.getByTestId('ckt-start').click()
  await win.waitForTimeout(300)
  expect((await live(win, mot)).speed).toBe(0)
  const cap = await partScreen(win, btn, 2.54, -2.54, 6.5)
  await win.mouse.move(cap.x, cap.y)
  await win.mouse.down()
  await expect.poll(async () => (await live(win, mot)).speed).toBeGreaterThan(1)
  await win.waitForTimeout(300)
  await win.screenshot({ path: 'test-results/ckt3d-motor.png' })
  await win.mouse.up()
  await expect.poll(async () => (await live(win, mot)).speed).toBe(0)
  await win.getByTestId('ckt-stop').click()

  // the night light's lamp: a click switches it on, Ctrl+Z off again
  await win.getByTestId('ckt-demo-night').click()
  await win.keyboard.press('f')
  const lamp = (await ckt(win)).room.items.find((it: any) => it.kind === 'lamp')
  expect(lamp.on).toBeFalsy()
  await win.waitForTimeout(300)
  const at = await toScreen(win, lamp.x, lamp.y, 4)
  const pick = () => cad(win, (a: number[]) => (window as any).__cad.circuitScene().pick(a[0], a[1]).item, [at.x, at.y])
  await expect.poll(pick).toBe(lamp.id)
  await win.mouse.click(at.x, at.y)
  await expect.poll(async () => (await ckt(win)).room.items.find((it: any) => it.kind === 'lamp').on).toBe(true)
  await win.waitForTimeout(300)
  await win.screenshot({ path: 'test-results/ckt3d-night.png' })
  await win.keyboard.press('Control+z')
  await expect.poll(async () => !!(await ckt(win)).room.items.find((it: any) => it.kind === 'lamp').on).toBe(false)

  // a dark room in a run: the night light comes on; the lamp clicked on the table puts it out
  const led = (await ckt(win)).parts.find((p: any) => p.kind === 'led').id
  const bright = () => cad(win, (i: string) => (window as any).__cad.circuitResult.value?.leds.get(i)?.brightness ?? 0, led)
  await win.getByTestId('ckt-start').click()
  await win.getByTestId('room-light').fill('3')
  await expect.poll(bright).toBeGreaterThan(0.5)
  await win.waitForTimeout(300)
  await win.screenshot({ path: 'test-results/ckt3d-dark.png' })
  await win.mouse.click(at.x, at.y)
  await expect.poll(bright).toBe(0)
  await win.waitForTimeout(300)
  await win.screenshot({ path: 'test-results/ckt3d-dark-lamp.png' })
  await win.getByTestId('ckt-stop').click()

  // the knob of the potentiometer turned by a sideways drag: the servo follows
  await win.getByTestId('ckt-demo2').click()
  const pot = (await ckt(win)).parts.find((p: any) => p.kind === 'pot')
  const servo = (await ckt(win)).parts.find((p: any) => p.kind === 'servo').id
  await win.getByTestId('ckt-start').click()
  await win.waitForTimeout(800)
  const angle = () => cad(win, (i: string) => (window as any).__cad.circuitServos.value[i]?.angle ?? 0, servo)
  const a0 = await angle()
  const knob = await partScreen(win, pot.id, 2.54, -5.8, 8)
  await win.mouse.move(knob.x, knob.y)
  await win.mouse.down()
  await win.mouse.move(knob.x + 200, knob.y, { steps: 8 })
  await win.mouse.up()
  expect(await cad(win, (i: string) => (window as any).__cad.circuitKnobs.value[i], pot.id)).toBeGreaterThan((pot.knob ?? 0.5) + 0.3)
  await expect.poll(async () => Math.abs((await angle()) - a0)).toBeGreaterThan(30)
  await win.getByTestId('ckt-stop').click()

  // a part dragged in from the panel lands on the table where it is dropped
  const before = (await ckt(win)).parts.length
  await win.getByTestId('add-led').scrollIntoViewIfNeeded()
  const tile = await win.getByTestId('add-led').boundingBox()
  const area = await win.getByTestId('circuit-3d').boundingBox()
  await win.mouse.move(tile!.x + tile!.width / 2, tile!.y + tile!.height / 2)
  await win.mouse.down()
  await win.mouse.move(area!.x + area!.width * 0.2, area!.y + area!.height * 0.5, { steps: 8 })
  await win.mouse.up()
  await expect.poll(async () => (await ckt(win)).parts.length).toBe(before + 1)
  const added = (await ckt(win)).parts.at(-1)
  const seen = await partScreen(win, added.id, 1.27, 0, 0)
  expect(Math.abs(seen.x - (area!.x + area!.width * 0.2))).toBeLessThan(40)

  // switching back and forth many times keeps one drawing context at a time
  const lost: string[] = []
  win.on('console', (m: any) => /context lost/i.test(m.text()) && lost.push(m.text()))
  for (let i = 0; i < 12; i++) {
    await win.getByTestId('ckt-view-2d').click()
    await win.getByTestId('ckt-view-3d').click()
  }
  await expect(win.locator('[data-testid=circuit-3d] canvas')).toBeVisible()
  expect(lost).toEqual([])

  // back to the flat board
  await win.getByTestId('ckt-view-2d').click()
  await expect(win.locator('[data-testid=circuit-view] svg.circuit-svg')).toBeVisible()
  await expect(win.getByTestId('circuit-3d')).toHaveCount(0)
  expect(errors).toEqual([])
  await app.close()
})
