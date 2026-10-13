import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell } from 'electron'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { basename, extname, join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// Custom scheme so the packaged renderer (and its WebAssembly + worker) load from a
// secure, fetch-capable origin instead of file://.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  },
  // the files of mods (their 3D models): mod://<folder key>/<file>
  {
    scheme: 'mod',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

type FileKind = 'project' | 'stl' | 'obj' | 'dxf' | 'svg' | 'png' | 'webm'

interface UiState {
  dirty: boolean
  title: string
  lang: 'ru' | 'en' | 'zh'
  dark: boolean
  /** a project left by a crash is offered and not answered yet: its copy must stay */
  keepAutosave?: boolean
}

const MSG = {
  ru: {
    project: 'Проект NerpaCad',
    stl: 'STL-модель',
    obj: 'OBJ-модель',
    dxf: 'Чертёж DXF',
    svg: 'Рисунок SVG',
    png: 'Картинка PNG',
    webm: 'Видео WebM',
    unsavedTitle: 'Несохранённые изменения',
    unsaved: 'В проекте есть несохранённые изменения. Закрыть без сохранения?',
    close: 'Закрыть без сохранения',
    cancel: 'Отмена'
  },
  en: {
    project: 'NerpaCad project',
    stl: 'STL model',
    obj: 'OBJ model',
    dxf: 'DXF drawing',
    svg: 'SVG drawing',
    png: 'PNG picture',
    webm: 'WebM video',
    unsavedTitle: 'Unsaved changes',
    unsaved: 'The project has unsaved changes. Close without saving?',
    close: 'Close without saving',
    cancel: 'Cancel'
  },
  zh: {
    project: 'NerpaCad 项目',
    stl: 'STL 模型',
    obj: 'OBJ 模型',
    dxf: 'DXF 图纸',
    svg: 'SVG 图形',
    png: 'PNG 图片',
    webm: 'WebM 视频',
    unsavedTitle: '未保存的更改',
    unsaved: '项目有未保存的更改。不保存就关闭吗？',
    close: '不保存并关闭',
    cancel: '取消'
  }
}

let mainWindow: BrowserWindow | null = null
let uiState: UiState = { dirty: false, title: 'NerpaCad', lang: 'ru', dark: true }

function filters(kind: FileKind): Electron.FileFilter[] {
  const m = MSG[uiState.lang]
  if (kind === 'project') return [{ name: m.project, extensions: ['nerpa', 'tcad'] }]
  if (kind === 'stl') return [{ name: m.stl, extensions: ['stl'] }]
  if (kind === 'dxf') return [{ name: m.dxf, extensions: ['dxf'] }]
  if (kind === 'svg') return [{ name: m.svg, extensions: ['svg'] }]
  if (kind === 'png') return [{ name: m.png, extensions: ['png'] }]
  if (kind === 'webm') return [{ name: m.webm, extensions: ['webm'] }]
  return [{ name: m.obj, extensions: ['obj'] }]
}

/** A project file passed on the command line (double-click in Explorer): .nerpa or an old .tcad. */
function projectArg(argv: string[]): string | null {
  const args = argv.slice(app.isPackaged ? 1 : 2)
  return args.find((a) => /\.(nerpa|tcad)$/i.test(a)) ?? null
}

// One window only: opening another project from Explorer hands it to the running app.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', async (_e, argv) => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
    const f = projectArg(argv)
    if (f) {
      try {
        mainWindow.webContents.send('app:openFile', await readForRenderer(f))
      } catch {
        /* unreadable file: ignore */
      }
    }
  })
}

async function readForRenderer(path: string) {
  const buf = await readFile(path)
  return {
    path,
    name: basename(path),
    data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  }
}

// ---------------------------------------------------------------- autosave

/** where the project is written every minute or so while it has unsaved changes */
const autosaveDir = () => process.env.CAD_AUTOSAVE_DIR || join(app.getPath('userData'), 'autosave')
const AUTOSAVE = 'autosave.nerpa'
const AUTOSAVE_META = 'autosave.json'

interface AutosaveMeta {
  savedAt: number
  name: string | null
  path: string | null
}

/** writes and clears one after another (a clear never runs in the middle of a write) */
let autosaveQueue: Promise<unknown> = Promise.resolve()
function queued<T>(job: () => Promise<T>): Promise<T> {
  const run = autosaveQueue.then(job, job)
  autosaveQueue = run.catch(() => undefined)
  return run
}

/**
 * The page died (it crashed, ran out of memory) or hangs: the autosaved copy is the work it had,
 * so closing the window now must not remove it.
 */
let pageTrouble = false
/** when the page was last reloaded after a crash (it is reloaded at most every half minute) */
let lastRevive = 0

function registerAutosave(): void {
  ipcMain.handle('autosave:write', (_e, data: string, meta: Omit<AutosaveMeta, 'savedAt'>) => queued(() => writeAutosave(data, meta)))
  ipcMain.handle('autosave:clear', () =>
    queued(async () => {
      const dir = autosaveDir()
      await rm(join(dir, AUTOSAVE), { force: true })
      await rm(join(dir, AUTOSAVE_META), { force: true })
      return true
    })
  )
  ipcMain.handle('autosave:check', async () => {
    const dir = autosaveDir()
    try {
      const data = await readFile(join(dir, AUTOSAVE), 'utf8')
      let meta: AutosaveMeta = { savedAt: 0, name: null, path: null }
      try {
        meta = { ...meta, ...JSON.parse(await readFile(join(dir, AUTOSAVE_META), 'utf8')) }
      } catch {
        /* no note about it: still offer the project */
      }
      return { data, ...meta }
    } catch {
      return null
    }
  })
}

async function writeAutosave(data: string, meta: Omit<AutosaveMeta, 'savedAt'>): Promise<boolean> {
  const dir = autosaveDir()
  await mkdir(dir, { recursive: true })
  // written next to it first, then put in place: a crash while writing leaves the old one whole
  await writeFile(join(dir, AUTOSAVE + '.tmp'), data)
  await rename(join(dir, AUTOSAVE + '.tmp'), join(dir, AUTOSAVE))
  const m: AutosaveMeta = { savedAt: Date.now(), name: meta.name ?? null, path: meta.path ?? null }
  await writeFile(join(dir, AUTOSAVE_META), JSON.stringify(m))
  return true
}

/**
 * The window closed the normal way (saved, or the changes given up): the autosave is not needed.
 * It stays when the page had crashed or hung, or when a project left by a crash is still offered.
 */
function clearAutosave(): void {
  if (pageTrouble || uiState.keepAutosave) return
  try {
    rmSync(join(autosaveDir(), AUTOSAVE), { force: true })
    rmSync(join(autosaveDir(), AUTOSAVE_META), { force: true })
  } catch {
    /* nothing to clear */
  }
}

// ---------------------------------------------------------------- mods

/**
 * Where mods are looked for: the app's own folder for them (made when first opened) and, while
 * developing, `mods/` next to the project (it is not part of the repository). `CAD_MODS_DIR`
 * replaces both (tests).
 */
const userModsDir = () => process.env.CAD_MODS_DIR || join(app.getPath('userData'), 'mods')
const modDirs = (): string[] => (process.env.CAD_MODS_DIR || app.isPackaged ? [userModsDir()] : [userModsDir(), join(app.getAppPath(), 'mods')])
/** mod://<key>/… → the mod's folder (only folders found by the last scan are served) */
const modRoots = new Map<string, string>()

interface FoundMod {
  key: string
  folder: string
  path: string
  /** the text of its mod.json (null: there is none) */
  manifest: string | null
}

async function scanMods(): Promise<FoundMod[]> {
  modRoots.clear()
  const out: FoundMod[] = []
  for (const dir of modDirs()) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const path = join(dir, e.name)
      const key = `m${modRoots.size}`
      modRoots.set(key, path)
      const manifest = await readFile(join(path, 'mod.json'), 'utf8').catch(() => null)
      out.push({ key, folder: e.name, path, manifest })
    }
  }
  return out
}

function registerMods(): void {
  ipcMain.handle('mods:list', () => scanMods())
  ipcMain.handle('mods:openFolder', async () => {
    const dir = userModsDir()
    await mkdir(dir, { recursive: true })
    return shell.openPath(dir)
  })
  // a mod's files, for its own folder only; the page is on another origin, so CORS allows it
  protocol.handle('mod', async (req) => {
    const { host, pathname } = new URL(req.url)
    const root = modRoots.get(host)
    const file = root ? normalize(join(root, decodeURIComponent(pathname))) : ''
    if (!root || !file.startsWith(root + sep)) return new Response('Not found', { status: 404 })
    const r = await net.fetch(pathToFileURL(file).toString()).catch(() => null)
    if (!r || !r.ok) return new Response('Not found', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } })
    return new Response(r.body, { status: 200, headers: { 'Content-Type': r.headers.get('Content-Type') ?? 'application/octet-stream', 'Access-Control-Allow-Origin': '*' } })
  })
}

function registerIpc(): void {
  registerAutosave()
  registerMods()
  ipcMain.handle('file:open', async (_e, kind: FileKind) => {
    if (!mainWindow) return null
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: filters(kind)
    })
    if (r.canceled || r.filePaths.length === 0) return null
    return readForRenderer(r.filePaths[0])
  })

  ipcMain.handle(
    'file:save',
    async (
      _e,
      opts: { kind: FileKind; data: ArrayBuffer | string; defaultName: string; path?: string | null }
    ) => {
      if (!mainWindow) return null
      const data = typeof opts.data === 'string' ? opts.data : Buffer.from(opts.data)
      const ask = async (defaultPath: string) => {
        const r = await dialog.showSaveDialog(mainWindow!, { defaultPath, filters: filters(opts.kind) })
        if (r.canceled || !r.filePath) return null
        const want = opts.kind === 'project' ? '.nerpa' : `.${opts.kind}`
        return extname(r.filePath).toLowerCase() !== want ? r.filePath + want : r.filePath
      }
      let target = opts.path ?? null
      if (target) {
        try {
          await writeFile(target, data)
          return { path: target, name: basename(target) }
        } catch (err) {
          // its folder is gone (a project restored after a crash, a removed USB stick): ask where
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
          target = await ask(basename(target))
        }
      } else target = await ask(opts.defaultName)
      if (!target) return null
      await writeFile(target, data)
      return { path: target, name: basename(target) }
    }
  )

  ipcMain.handle('app:startupFile', async () => {
    const f = projectArg(process.argv)
    if (!f) return null
    try {
      return await readForRenderer(f)
    } catch {
      return null
    }
  })

  ipcMain.on('app:state', (_e, s: UiState) => {
    uiState = s
    // a live page that reports its state is fine again (reloaded after a crash)
    pageTrouble = false
    nativeTheme.themeSource = s.dark ? 'dark' : 'light'
    if (mainWindow) {
      mainWindow.setTitle(s.title)
      mainWindow.setBackgroundColor(s.dark ? '#07080e' : '#eeeeee')
    }
  })

  ipcMain.on('app:toggleDevTools', () => mainWindow?.webContents.toggleDevTools())
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'NerpaCad',
    backgroundColor: '#07080e',
    autoHideMenuBar: true,
    // packaged builds take the icon from the .exe; in development use the PNG
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', clearAutosave)
  // the page crashed: keep its autosaved work and load the page again — it offers to restore it
  mainWindow.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit') return
    pageTrouble = true
    if (Date.now() - lastRevive < 30_000) return
    lastRevive = Date.now()
    setTimeout(() => mainWindow?.webContents.reload(), 500)
  })
  mainWindow.on('unresponsive', () => (pageTrouble = true))
  mainWindow.on('responsive', () => (pageTrouble = false))

  mainWindow.on('close', (e) => {
    if (!uiState.dirty || process.env.CAD_SKIP_CLOSE_PROMPT) return
    const m = MSG[uiState.lang]
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      title: m.unsavedTitle,
      message: m.unsaved,
      buttons: [m.close, m.cancel],
      defaultId: 1,
      cancelId: 1
    })
    if (choice !== 0) e.preventDefault()
  })

  // never let a dropped file or a stray link replace the app page
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  mainWindow.webContents.setWindowOpenHandler((d) => {
    shell.openExternal(d.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadURL('app://bundle/index.html')
  }
}

app.whenReady().then(() => {
  if (!gotLock) return
  const root = normalize(join(__dirname, '../renderer'))
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url)
    const file = normalize(join(root, decodeURIComponent(pathname)))
    if (file !== root && !file.startsWith(root + sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(file).toString())
  })

  Menu.setApplicationMenu(null)
  // dark window frame, dialogs and native controls to match the cyberpunk theme
  nativeTheme.themeSource = 'dark'
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
