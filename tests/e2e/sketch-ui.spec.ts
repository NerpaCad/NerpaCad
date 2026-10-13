import { expect, test, type Page } from '@playwright/test'
import { launch, project } from './app'

const sk = (win: Page) => win.evaluate(() => (window as any).__cad.sketch.value)
const tool = (win: Page) => win.evaluate(() => (window as any).__cad.skTool.value)
const settle = (win: Page) => win.evaluate(() => (window as any).__cad.sketchSettled())

async function clickAt(win: Page, x: number, y: number, button: 'left' | 'right' = 'left') {
  const p = await project(win, x, y, 0)
  await win.mouse.move(p.x + 3, p.y + 3)
  await win.mouse.move(p.x, p.y)
  await win.mouse.click(p.x, p.y, { button })
}

async function startSketch(win: Page) {
  await win.evaluate(() => ((window as any).__cad.gridStep.value = 0))
  await win.click('[data-testid=tb-sketch]')
  const c = await win.evaluate(() => {
    const r = document.querySelector('[data-testid=viewport] canvas')!.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await win.mouse.click(c.x, c.y)
  // the camera turns onto the sketch plane: wait until it stands still
  // (it first turns, then fits the view a moment later)
  let last = ''
  let still = 0
  for (let i = 0; i < 60 && still < 8; i++) {
    await win.waitForTimeout(100)
    const now = JSON.stringify(await project(win, 50, 50, 0))
    still = now === last ? still + 1 : 0
    last = now
  }
}

/** screen boxes of all badges and dimension numbers */
const overlayBoxes = (win: Page) =>
  win.evaluate(() =>
    [...document.querySelectorAll('.sk-badge:not(.static), .dim-tag.sk-dim')].map((e) => {
      const r = e.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height, cls: e.className }
    })
  )

function overlaps(boxes: { x: number; y: number; w: number; h: number }[]): number {
  let n = 0
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5) n++
    }
  return n
}

test('sketch tools: rectangle and arc variants behind one button; right click finishes, then goes back to Select', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await startSketch(win)
  // one button per group; the corner triangle opens the variants
  await expect(win.getByTestId('sk-tool-rect')).toBeVisible()
  await expect(win.getByTestId('sk-tool-rectCenter')).toHaveCount(0)
  await expect(win.getByTestId('sk-tool-arc3')).toHaveCount(0)
  await win.getByTestId('sk-more-rect').click()
  await expect(win.getByTestId('sk-variants-rect')).toBeVisible()
  await win.screenshot({ path: 'test-results/sk-variants.png' })
  await win.getByTestId('sk-variant-rectCenter').click()
  await expect(win.getByTestId('sk-variants-rect')).toHaveCount(0)
  expect(await tool(win)).toBe('rectCenter')
  await expect(win.getByTestId('sk-tool-rectCenter')).toBeVisible()
  // the button keeps the last variant picked; R still means the plain rectangle
  await win.keyboard.press('q')
  await win.getByTestId('sk-tool-rectCenter').click()
  expect(await tool(win)).toBe('rectCenter')
  await win.keyboard.press('r')
  expect(await tool(win)).toBe('rect')
  await win.getByTestId('sk-more-arc').click()
  await win.getByTestId('sk-variant-arc3').click()
  expect(await tool(win)).toBe('arc3')
  // a click elsewhere closes an open list
  await win.getByTestId('sk-more-arc').click()
  await expect(win.getByTestId('sk-variants-arc')).toBeVisible()
  await win.getByTestId('sketch-panel').locator('.panel-title').click()
  await expect(win.getByTestId('sk-variants-arc')).toHaveCount(0)

  // right click: the line ends (the tool stays), a second right click goes to Select
  await win.keyboard.press('l')
  await clickAt(win, 0, 0)
  await clickAt(win, 30, 0)
  await clickAt(win, 30, 20)
  await clickAt(win, 30, 20, 'right')
  await settle(win)
  expect(await tool(win)).toBe('line')
  expect((await sk(win)).curves.filter((c: any) => c.kind === 'line')).toHaveLength(2)
  await clickAt(win, 30, 20, 'right')
  expect(await tool(win)).toBe('select')
  // a half-drawn rectangle: the first right click drops it, the second goes to Select
  await win.keyboard.press('r')
  await clickAt(win, -40, -40)
  await clickAt(win, -20, -20, 'right')
  expect(await tool(win)).toBe('rect')
  await clickAt(win, -20, -20, 'right')
  expect(await tool(win)).toBe('select')
  expect((await sk(win)).curves.filter((c: any) => c.kind === 'line')).toHaveLength(2)
  expect(errors).toEqual([])
  await app.close()
})

test('dimensions: the number opens for typing, the arrow selects it (Delete removes only it), dragging moves it', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await startSketch(win)
  await win.keyboard.press('r')
  await clickAt(win, 0, 0)
  await clickAt(win, 40, 30)
  await settle(win)
  await win.keyboard.press('q')
  // dimension the bottom line
  let s = await sk(win)
  const bottom = s.curves.find((c: any) => {
    if (c.kind !== 'line') return false
    const y = (id: string) => (id === 'O' ? 0 : s.points.find((p: any) => p.id === id).y)
    return Math.abs(y(c.p1)) < 1e-6 && Math.abs(y(c.p2)) < 1e-6
  })
  await win.evaluate((id) => ((window as any).__cad.skSelection.value = [id]), bottom.id)
  await win.keyboard.press('d')
  await settle(win)
  const input = win.locator('[data-testid^=skdim-input-]')
  await expect(input).toBeVisible()
  await input.fill('50')
  await input.press('Enter')
  await settle(win)
  s = await sk(win)
  const dim = s.constraints.find((c: any) => c.type === 'distance')
  expect(dim.value).toBe(50)

  // a click on the dimension line selects it, no typing box
  const line = win.getByTestId(`skdim-line-${dim.id}`).locator('polyline').last()
  const box = (await line.boundingBox())!
  // away from the number, which sits on the middle of the line
  const mid = { x: box.x + box.width * 0.15, y: box.y + box.height / 2 }
  await win.mouse.click(mid.x, mid.y)
  expect(await win.evaluate(() => (window as any).__cad.skSelection.value)).toEqual([dim.id])
  await expect(input).toHaveCount(0)

  // dragging the line moves the dimension further away (one undo step)
  const before = (await win.getByTestId(`skdim-${dim.id}`).boundingBox())!
  await win.mouse.move(mid.x, mid.y)
  await win.mouse.down()
  await win.mouse.move(mid.x + 20, mid.y + 50, { steps: 6 })
  await win.mouse.up()
  const after = (await win.getByTestId(`skdim-${dim.id}`).boundingBox())!
  expect(after.y - before.y).toBeGreaterThan(35)
  s = await sk(win)
  expect(s.constraints.find((c: any) => c.id === dim.id).place).toBeTruthy()
  await win.screenshot({ path: 'test-results/sk-dim-moved.png' })
  // dragging the number moves it too, without opening the typing box
  const numBox = (await win.getByTestId(`skdim-${dim.id}`).boundingBox())!
  await win.mouse.move(numBox.x + numBox.width / 2, numBox.y + numBox.height / 2)
  await win.mouse.down()
  await win.mouse.move(numBox.x + numBox.width / 2 - 60, numBox.y + numBox.height / 2, { steps: 6 })
  await win.mouse.up()
  await expect(input).toHaveCount(0)
  const moved = (await win.getByTestId(`skdim-${dim.id}`).boundingBox())!
  expect(numBox.x - moved.x).toBeGreaterThan(40)
  await win.keyboard.press('Control+z')
  await settle(win)
  const undone = (await win.getByTestId(`skdim-${dim.id}`).boundingBox())!
  expect(Math.abs(undone.x - numBox.x)).toBeLessThan(3)

  // select by the arrow and delete: the dimension goes, the line stays
  const arrowHit = win.getByTestId(`skdim-line-${dim.id}`).locator('circle').first()
  await arrowHit.click({ force: true })
  expect(await win.evaluate(() => (window as any).__cad.skSelection.value)).toEqual([dim.id])
  await win.keyboard.press('Delete')
  await settle(win)
  s = await sk(win)
  expect(s.constraints.some((c: any) => c.id === dim.id)).toBe(false)
  expect(s.curves.some((c: any) => c.id === bottom.id)).toBe(true)
  expect(errors).toEqual([])
  await app.close()
})

test('badges: a fillet and a many-sided polygon do not pile badges on each other', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await startSketch(win)
  await win.keyboard.press('r')
  await clickAt(win, -70, 5)
  await clickAt(win, -10, 50)
  await settle(win)
  await win.click('[data-testid=sk-tool-fillet]')
  await win.fill('[data-testid=sk-fillet-r]', '20')
  await win.locator('[data-testid=sk-fillet-r]').press('Enter')
  await clickAt(win, -10, 50)
  await settle(win)
  const filleted = await sk(win)
  expect(filleted.curves.some((c: any) => c.kind === 'arc')).toBe(true)
  expect(filleted.constraints.filter((c: any) => c.type === 'tangent')).toHaveLength(2)
  // a 40-sided polygon
  await win.click('[data-testid=sk-tool-polygon]')
  await win.fill('[data-testid=sk-sides]', '40')
  await win.locator('[data-testid=sk-sides]').press('Enter')
  await clickAt(win, 40, 20)
  await clickAt(win, 60, 20)
  await settle(win)
  await win.keyboard.press('q')
  await win.waitForTimeout(300)
  await win.screenshot({ path: 'test-results/sk-badges.png' })
  const boxes = await overlayBoxes(win)
  expect(overlaps(boxes)).toBe(0)
  // the polygon has one badge for its 79 constraints
  const regular = win.locator('.sk-badge[data-type=regular]')
  await expect(regular).toHaveCount(1)
  expect(boxes.length).toBeLessThan(25)
  await regular.click()
  expect((await win.evaluate(() => (window as any).__cad.skSelection.value)).length).toBe(79)
  // zoomed far out, still nothing on top of anything
  await win.mouse.move(700, 400)
  for (let i = 0; i < 4; i++) await win.mouse.wheel(0, 400)
  await win.waitForTimeout(400)
  await win.screenshot({ path: 'test-results/sk-badges-far.png' })
  expect(overlaps(await overlayBoxes(win))).toBe(0)
  expect(errors).toEqual([])
  await app.close()
})
