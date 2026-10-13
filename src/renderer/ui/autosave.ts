/**
 * Autosave: while the project has unsaved changes it is written every minute or so to the app's
 * own folder. A normal close (saved, or the changes given up) removes that copy; after a crash it
 * is still there, and on the next start the app offers to bring the project back.
 */
import { effect, signal } from '@preact/signals'
import { dirty, doc, fileName, filePath, loadDoc, markUnsaved } from '../core/doc/store'
import type { Doc } from '../core/doc/model'
import { parseDoc, serializeDoc } from '../core/io/formats'

/** A project left by a crash, offered for restoring (null: none). */
export const recoverOffer = signal<{ doc: Doc; savedAt: number; name: string | null; path: string | null } | null>(null)

let timer = 0
/** the document as last autosaved (nothing is written twice) */
let written: Doc | null = null
/** a copy of this session's work is on disk (it goes when the project is saved) */
let onDisk = false
/** writes and clears one after another, in the order asked */
let chain: Promise<void> = Promise.resolve()
const queue = (job: () => Promise<void>) => (chain = chain.then(job, job))

/** Remove the copy (this session's, or one left by a crash that was given up). */
function clearCopy(): Promise<void> {
  onDisk = false
  return queue(async () => {
    await window.api.autosaveClear().catch(() => undefined)
  })
}

/** Write the project now if it has changes not yet autosaved. */
export function autosaveNow(): Promise<void> {
  const d = doc.peek()
  // a project left by a crash waits for an answer: its copy is not to be overwritten yet
  if (!dirty.peek() || d === written || recoverOffer.peek()) return chain
  written = d
  return queue(async () => {
    // saved while waiting its turn: nothing to keep; changed meanwhile: the newest goes
    if (!dirty.peek()) return
    const now = doc.peek()
    written = now
    try {
      await window.api.autosaveWrite(serializeDoc(now), { name: fileName.peek(), path: filePath.peek() })
      onDisk = true
    } catch {
      // the copy could not be written (no space, no rights): it is tried again next time
      if (written === now) written = null
    }
    // saved while it was being written: the copy is out of date at once (cleared right here:
    // this job is the queue's current one)
    if (!dirty.peek() && onDisk) {
      onDisk = false
      await window.api.autosaveClear().catch(() => undefined)
    }
  })
}

/** Start autosaving, and look for a project left by a crash. */
export async function startAutosave(): Promise<void> {
  if (timer) return
  // saved (or opened, or made new): the copy is not needed any more
  effect(() => {
    if (dirty.value) return
    written = null
    if (onDisk) void clearCopy()
  })
  timer = window.setInterval(() => void autosaveNow(), window.api.autosaveEvery)
  const left = await window.api.autosaveCheck().catch(() => null)
  if (!left) return
  try {
    recoverOffer.value = { doc: parseDoc(left.data), savedAt: left.savedAt, name: left.name, path: left.path }
  } catch {
    // an unreadable copy is of no use
    void clearCopy()
  }
}

/** Bring the project back (it opens as not saved: Ctrl+S puts it into its file). */
export function recover(): void {
  const r = recoverOffer.peek()
  recoverOffer.value = null
  if (!r) return
  loadDoc(r.doc, r.path, r.name)
  markUnsaved()
  // the copy on disk is this session's work now: saving the project removes it
  onDisk = true
}

/** Give the left project up. */
export function dismissRecover(): void {
  recoverOffer.value = null
  void clearCopy()
}
