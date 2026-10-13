import { expect, test } from '@playwright/test'
import { idle, launch, nodes, project } from './app'

const cad = (win: any, fn: (arg?: any) => any, arg?: any) => win.evaluate(fn, arg)
const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const prog = (...blocks: any[]) => {
  for (let i = blocks.length - 2; i >= 0; i--) blocks[i].next = { block: blocks[i + 1] }
  return { blocks: { languageVersion: 0, blocks: [{ type: 'robo_start', x: 20, y: 20, next: { block: blocks[0] } }] } }
}

async function field(win: any) {
  const errors: string[] = []
  win.on('console', (m: any) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  win.on('pageerror', (e: any) => errors.push(String(e)))
  await win.getByTestId('mode-robotics').click()
  await win.waitForTimeout(1200)
  return errors
}

test('devices: drag the ultrasonic onto a pad, put a touch sensor from the pad map; readings show units', async () => {
  const { app, win } = await launch()
  const errors = await field(win)
  const robot = await cad(win, () => (window as any).__cad.actions.addRobot([150, 150]))
  await idle(win)
  await win.waitForTimeout(1500)
  // drag the ultrasonic card onto pad 2 (front middle: 59.7 mm ahead of the robot's origin)
  await win.getByTestId('add-sensor-ultrasonic').scrollIntoViewIfNeeded()
  const card = await win.getByTestId('add-sensor-ultrasonic').boundingBox()
  const pad = await project(win, 150 + 59.7, 150, 16.5)
  await win.mouse.move(card!.x + 20, card!.y + 20)
  await win.mouse.down()
  await win.mouse.move(pad.x + 30, pad.y + 30, { steps: 8 })
  await win.mouse.move(pad.x, pad.y, { steps: 4 })
  await win.mouse.up()
  // pick the touch sensor by clicking its card (it goes on the first free pad: 1), then remove it
  // and put it on pad 3 from the pad map
  await win.getByTestId('add-sensor-touch').click()
  await win.getByTestId('pad-1').click()
  await expect(win.getByTestId('pad-chosen')).toContainText('касания')
  await win.getByTestId('pad-3').click()
  const r = (await nodes(win)).find((x: any) => x.id === robot)
  expect(r.params.robot.sensors).toEqual([
    { port: 2, type: 'ultrasonic' },
    { port: 3, type: 'touch' }
  ])
  await win.waitForTimeout(600)
  await expect(win.getByTestId('reading-2')).toContainText('см')
  await expect(win.getByTestId('reading-3')).toContainText('нет')
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})

test('a robot with the ultrasonic stops in front of a wall', async () => {
  const { app, win } = await launch()
  const errors = await field(win)
  await cad(
    win,
    (p: any) => {
      const A = (window as any).__cad.actions
      const r = A.addRobot([0, 0])
      A.attachSensor(r, 2, 'ultrasonic')
      A.setProgram(r, p)
      const wall = A.addObstacle('box', [600, 0])
      // a heavy, wide wall
      const d = (window as any).__cad.doc.value
      A.setMass([wall], 5000)
      void d
    },
    prog(
      { type: 'robo_forward', inputs: { POWER: n(60) } },
      {
        type: 'robo_wait_until',
        inputs: { COND: { block: { type: 'robo_compare', fields: { OP: 'LT' }, inputs: { A: { block: { type: 'robo_distance', fields: { PORT: '2' } } }, B: n(10) } } } }
      },
      { type: 'robo_stop' }
    )
  )
  await idle(win)
  await win.waitForTimeout(800)
  await win.getByTestId('sim-start').click()
  await win.waitForFunction(() => (window as any).__cad.simState.value === 'running')
  await win.waitForTimeout(5000)
  const x = await cad(win, () => {
    const c = (window as any).__cad
    const robot = c.doc.value.nodes.find((q: any) => q.prim === 'robot')
    return c.viewport.sync.objects.get(robot.id).position.x
  })
  // the cube (60 mm, its face at 570) is 10 cm ahead of the transducers (118.7 mm ahead of the centre)
  expect(x).toBeGreaterThan(300)
  expect(x).toBeLessThan(380)
  await win.getByTestId('sim-stop').click()
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})

test('the seal walks and talks, answers a click and a key; the block palette follows the selection', async () => {
  const { app, win } = await launch()
  const errors = await field(win)
  await win.getByTestId('add-nerpa').click()
  await idle(win)
  await win.waitForTimeout(1500)
  // the seal is selected: its palette has Looks
  await expect(win.locator('.blocklyToolboxCategory', { hasText: 'Внешность' })).toBeVisible()
  const seal = (await nodes(win)).find((x: any) => x.prim === 'nerpa')
  const txt = (v: string) => ({ shadow: { type: 'robo_text', fields: { TEXT: v } } })
  await cad(
    win,
    (a: any) => (window as any).__cad.actions.setProgram(a.id, a.program),
    {
      id: seal.id,
      program: {
        blocks: {
          languageVersion: 0,
          blocks: [
            { type: 'robo_start', x: 20, y: 20, next: { block: { type: 'nerpa_say', inputs: { TEXT: txt('Привет!') }, next: { block: { type: 'nerpa_walk', inputs: { CM: n(30) } } } } } },
            { type: 'robo_when_clicked', x: 20, y: 200, next: { block: { type: 'nerpa_say', inputs: { TEXT: txt('Ой!') } } } },
            { type: 'robo_when_key', x: 300, y: 200, fields: { KEY: 'ArrowUp' }, next: { block: { type: 'nerpa_jump' } } }
          ]
        }
      }
    }
  )
  await win.waitForTimeout(300)
  await win.getByTestId('sim-start').click()
  await win.waitForFunction(() => (window as any).__cad.simState.value === 'running')
  await win.waitForTimeout(800)
  const look = () =>
    cad(win, (id: string) => {
      const o = (window as any).__cad.viewport.sync.objects.get(id)
      return { x: o.position.x, bubble: o.visual?.userData.bubble?.visible, say: o.visual?.userData.say }
    }, seal.id)
  let l = await look()
  expect(l.bubble).toBe(true)
  expect(l.say).toBe('Привет!')
  await win.waitForTimeout(2200)
  l = await look()
  expect(l.x - seal.transform.position[0]).toBeGreaterThan(250)
  // click on the seal: "when clicked"
  const at = await cad(win, (id: string) => {
    const c = (window as any).__cad
    const o = c.viewport.sync.objects.get(id)
    return c.project(o.position.x, o.position.y, 50)
  }, seal.id)
  await win.mouse.click(at.x, at.y)
  await win.waitForTimeout(300)
  expect((await look()).say).toBe('Ой!')
  // the up arrow: "when key pressed" → a jump
  await win.keyboard.press('ArrowUp')
  await win.waitForTimeout(250)
  const lift = await cad(win, (id: string) => {
    const o = (window as any).__cad.viewport.sync.objects.get(id)
    return o.visual.children[0].position.z
  }, seal.id)
  expect(lift).toBeGreaterThan(20)
  await win.getByTestId('sim-stop').click()
  await win.waitForTimeout(300)
  // back where the document has it, no bubble
  l = await look()
  expect(l.x).toBeCloseTo(seal.transform.position[0])
  expect(l.bubble).toBe(false)
  // a lamp selected: the palette has Light; a robot: Sensors
  await win.getByTestId('add-lamp-point').click()
  await win.waitForTimeout(500)
  await expect(win.locator('.blocklyToolboxCategory', { hasText: 'Свет' })).toBeVisible()
  await expect(win.locator('.blocklyToolboxCategory', { hasText: 'Внешность' })).toHaveCount(0)
  await win.getByTestId('add-robot').click()
  await win.waitForTimeout(500)
  await expect(win.locator('.blocklyToolboxCategory', { hasText: 'Датчики' })).toBeVisible()
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})

test('a lamp lights a light sensor; switching it off in the inspector and blinking it from its program', async () => {
  const { app, win } = await launch()
  const errors = await field(win)
  const ids = await cad(win, () => {
    const A = (window as any).__cad.actions
    const r = A.addRobot([0, 0])
    A.attachSensor(r, 1, 'light')
    const l = A.addLight('point', [100, 35])
    return { r, l }
  })
  await idle(win)
  await win.waitForTimeout(1200)
  await cad(win, (id: string) => ((window as any).__cad.selection.value = [id]), ids.l)
  await expect(win.getByTestId('lamp-fields')).toBeVisible()
  const reading = async () => {
    await cad(win, (id: string) => ((window as any).__cad.selection.value = [id]), ids.r)
    await win.waitForTimeout(500)
    const text = await win.getByTestId('reading-1').locator('.reading-val').textContent()
    return Number(text)
  }
  expect(await reading()).toBeGreaterThan(20)
  await cad(win, (id: string) => ((window as any).__cad.selection.value = [id]), ids.l)
  await win.getByTestId('lamp-on').click()
  expect(await reading()).toBe(0)
  // the lamp's program: on, wait, off, wait… the sensor follows it during the run
  await cad(
    win,
    (a: any) => (window as any).__cad.actions.setProgram(a.id, a.p),
    {
      id: ids.l,
      p: prog({ type: 'robo_forever', inputs: { DO: { block: { type: 'light_on', next: { block: { type: 'robo_wait', inputs: { SECONDS: n(0.4) }, next: { block: { type: 'light_off', next: { block: { type: 'robo_wait', inputs: { SECONDS: n(0.4) } } } } } } } } } } })
    }
  )
  await win.getByTestId('sim-start').click()
  const seen = new Set<string>()
  for (let i = 0; i < 16; i++) {
    await win.waitForTimeout(110)
    seen.add((await win.getByTestId('reading-1').locator('.reading-val').textContent()) ?? '')
  }
  expect(seen.has('0')).toBe(true)
  expect([...seen].some((v) => Number(v) > 20)).toBe(true)
  await win.getByTestId('sim-stop').click()
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})

test('variables: the “create variable” prompt works inside the app', async () => {
  const { app, win } = await launch()
  await field(win)
  await win.getByTestId('add-nerpa').click()
  await win.waitForTimeout(1200)
  await win.locator('.blocklyToolboxCategory', { hasText: 'Переменные' }).click()
  await win.waitForTimeout(300)
  await win.locator('.blocklyFlyoutButton').first().click()
  await expect(win.getByTestId('prompt-input')).toBeVisible()
  await win.getByTestId('prompt-input').fill('очки')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(400)
  await expect(win.getByTestId('prompt-input')).toHaveCount(0)
  // the palette closes with the dialog; open the category again: the new variable is there
  await win.locator('.blocklyToolboxCategory', { hasText: 'Переменные' }).click()
  await win.waitForTimeout(300)
  await expect(win.locator('.blocklyFlyout .blocklyText', { hasText: 'очки' }).first()).toBeVisible()
  await app.close()
})
