/// <reference types="vite/client" />
import type { CadApi } from '../preload'

declare global {
  interface Window {
    api: CadApi
  }
  /** the program version from package.json, e.g. "0.2.0" */
  const __APP_VERSION__: string
  const __APP_HOMEPAGE__: string
  const __APP_AUTHOR__: string
  const __APP_REPO__: string
}
