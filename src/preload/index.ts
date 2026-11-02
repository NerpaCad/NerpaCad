import { contextBridge, ipcRenderer, webUtils } from 'electron'

export type FileKind = 'project' | 'stl' | 'obj' | 'dxf' | 'svg' | 'png' | 'webm'

export interface OpenedFile {
  path: string
  name: string
  data: ArrayBuffer
}

const api = {
  openFile: (kind: FileKind): Promise<OpenedFile | null> => ipcRenderer.invoke('file:open', kind),
  saveFile: (opts: {
    kind: FileKind
    data: ArrayBuffer | string
    defaultName: string
    path?: string | null
  }): Promise<{ path: string; name: string } | null> => ipcRenderer.invoke('file:save', opts),
  startupFile: (): Promise<OpenedFile | null> => ipcRenderer.invoke('app:startupFile'),
  setState: (s: { dirty: boolean; title: string; lang: 'ru' | 'en' | 'zh'; dark: boolean; keepAutosave?: boolean }): void =>
    ipcRenderer.send('app:state', s),
  toggleDevTools: (): void => ipcRenderer.send('app:toggleDevTools'),
  /** Called when another project is opened from Explorer while the app is running. */
  onOpenFile: (cb: (f: OpenedFile) => void): void => {
    ipcRenderer.on('app:openFile', (_e, f: OpenedFile) => cb(f))
  },
  /** Autosave: write the project (with its name and file), forget it, or find one left by a crash. */
  autosaveWrite: (data: string, meta: { name: string | null; path: string | null }): Promise<boolean> =>
    ipcRenderer.invoke('autosave:write', data, meta),
  autosaveClear: (): Promise<boolean> => ipcRenderer.invoke('autosave:clear'),
  autosaveCheck: (): Promise<{ data: string; savedAt: number; name: string | null; path: string | null } | null> => ipcRenderer.invoke('autosave:check'),
  /** Mods: the folders found (with their mod.json) and opening the mods folder. */
  modsList: (): Promise<{ key: string; folder: string; path: string; manifest: string | null }[]> => ipcRenderer.invoke('mods:list'),
  modsOpenFolder: (): Promise<string> => ipcRenderer.invoke('mods:openFolder'),
  /** Recent projects: the list (each with whether its file is still there), add one, forget one, open one. */
  recentList: (): Promise<{ path: string; name: string; at: number; thumb?: string; missing: boolean }[]> => ipcRenderer.invoke('recent:list'),
  recentAdd: (entry: { path: string; name: string; thumb?: string }): Promise<boolean> => ipcRenderer.invoke('recent:add', entry),
  recentRemove: (path: string): Promise<boolean> => ipcRenderer.invoke('recent:remove', path),
  recentOpen: (path: string): Promise<OpenedFile | null> => ipcRenderer.invoke('recent:open', path),
  /** how often to autosave, ms (tests make it short) */
  autosaveEvery: Number(process.env.CAD_AUTOSAVE_MS) || 60_000,
  /** Full path of a file dropped onto the window. */
  pathForFile: (file: File): string => webUtils.getPathForFile(file)
}

export type CadApi = typeof api

contextBridge.exposeInMainWorld('api', api)
