import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { idle, launch, nodes, selection } from './app'

const scene = (win: any) => win.evaluate(() => (window as any).__cad.doc.value.scene)
const box = (win: any, id: string) => win.evaluate((i: string) => (window as any).__cad.viewport.worldBoxes([i])[i], id)

test('the 3D model and the robotics field are separate scenes in one project', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.click('[data-testid=shape-box]')
  await idle(win)
  const boxId = (await nodes(win))[0].id

  await win.click('[data-testid=mode-robotics]')
  expect(await scene(win)).toBe('robo')
  expect(await nodes(win)).toEqual([])
  await win.click('[data-testid=tile-straight]')
  await win.click('[data-testid=obstacle-cylinder]')
  await idle(win)
  const field = await nodes(win)
  expect(field.map((n: any) => n.prim)).toEqual(['tile', 'cylinder'])
  // obstacles are bigger than the 20 mm modelling shapes, and lengths are shown in cm
  expect(field[1].transform.scale[0]).toBe(3)
  await expect(win.locator('.field-row-title').first()).toContainText('см')
  await expect(win.locator('[data-testid=size-0]')).toHaveValue('6')
  await win.fill('[data-testid=pos-0]', '20')
  await win.locator('[data-testid=pos-0]').press('Enter')
  expect((await nodes(win))[1].transform.position[0]).toBeCloseTo(200)

  await win.click('[data-testid=mode-3d]')
  expect(await scene(win)).toBe('model')
  expect((await nodes(win)).map((n: any) => n.id)).toEqual([boxId])
  await expect(win.locator('.field-row-title').first()).toContainText('мм')

  // one file holds both scenes
  const file = join(tmpdir(), `scenes-${Date.now()}.nerpa`)
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as any
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as any
  }, file)
  await win.keyboard.press('Control+S')
  await expect.poll(() => existsSync(file)).toBe(true)
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  expect(saved.version).toBe(6)
  expect(saved.doc.nodes).toHaveLength(1)
  expect(saved.doc.robo).toHaveLength(2)
  expect(await win.title()).not.toContain('•')

  await win.click('[data-testid=tb-new]')
  await win.click('[data-testid=tb-open]')
  await expect.poll(async () => (await nodes(win)).length).toBe(1)
  await win.click('[data-testid=mode-robotics]')
  expect(await nodes(win)).toHaveLength(2)
  // looking at the other scene does not make the project "unsaved"
  expect(await win.title()).not.toContain('•')
  rmSync(file)
  expect(errors).toEqual([])
  await app.close()
})

test('«To simulator» puts the model on the field in its real size and updates it when sent again', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.click('[data-testid=shape-box]')
  await win.click('[data-testid=shape-cylinder]')
  await idle(win)
  const model = await nodes(win)
  // a 40 mm wide box beside the cylinder
  await win.evaluate((id: string) => (window as any).__cad.selection.value = [id], model[0].id)
  await win.fill('[data-testid=size-0]', '40')
  await win.locator('[data-testid=size-0]').press('Enter')
  await idle(win)
  await win.evaluate(() => (window as any).__cad.actions.selectAll())
  const b3d = await win.evaluate((ids: string[]) => {
    const bs = Object.values((window as any).__cad.viewport.worldBoxes(ids)) as any[]
    return { min: [0, 1, 2].map((k) => Math.min(...bs.map((b) => b.min[k]))), max: [0, 1, 2].map((k) => Math.max(...bs.map((b) => b.max[k]))) }
  }, model.map((n: any) => n.id))

  await win.click('[data-testid=tb-to-sim]')
  await expect.poll(() => scene(win)).toBe('robo')
  await idle(win)
  const field = await nodes(win)
  expect(field).toHaveLength(1)
  const sent = field[0]
  expect(sent.prim).toBe('mesh')
  expect(await selection(win)).toEqual([sent.id])
  await win.waitForTimeout(300)
  const b = await box(win, sent.id)
  for (let k = 0; k < 3; k++) expect(b.max[k] - b.min[k]).toBeCloseTo(b3d.max[k] - b3d.min[k], 0)
  expect(b.min[2]).toBeCloseTo(0, 1)

  // move it on the field, change the model, send again: same object, new shape, same place
  await win.fill('[data-testid=pos-0]', '50')
  await win.locator('[data-testid=pos-0]').press('Enter')
  await win.click('[data-testid=mode-3d]')
  await win.evaluate((id: string) => (window as any).__cad.selection.value = [id], model[0].id)
  await win.fill('[data-testid=size-2]', '60')
  await win.locator('[data-testid=size-2]').press('Enter')
  await idle(win)
  await win.evaluate(() => (window as any).__cad.actions.selectAll())
  await win.click('[data-testid=tb-to-sim]')
  await expect.poll(() => scene(win)).toBe('robo')
  await idle(win)
  const again = await nodes(win)
  expect(again).toHaveLength(1)
  expect(again[0].id).toBe(sent.id)
  expect(again[0].transform.position[0]).toBeCloseTo(500)
  await win.waitForTimeout(300)
  const b2 = await box(win, sent.id)
  expect(b2.max[2] - b2.min[2]).toBeCloseTo(60, 0)

  // undo walks back through both scenes from here: the update, the model's change (made out of
  // sight, the field stays on screen), the move and finally the sending itself
  await win.keyboard.press('Control+Z')
  expect((await nodes(win))[0].params.meshId).toBe(sent.params.meshId)
  await win.keyboard.press('Control+Z')
  expect(await scene(win)).toBe('robo')
  await win.keyboard.press('Control+Z')
  expect((await nodes(win))[0].transform.position[0]).toBeCloseTo(sent.transform.position[0])
  await win.keyboard.press('Control+Z')
  await expect.poll(async () => (await nodes(win)).length).toBe(0)
  expect(errors).toEqual([])
  await app.close()
})
