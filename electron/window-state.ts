import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import fs from 'fs'

interface WindowState {
  x: number | undefined
  y: number | undefined
  width: number
  height: number
  isMaximized: boolean
}

const DEFAULT_WIDTH = 1400
const DEFAULT_HEIGHT = 900

function getStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

export function loadWindowState(): WindowState | null {
  try {
    const raw = fs.readFileSync(getStatePath(), 'utf-8')
    const parsed = JSON.parse(raw) as WindowState
    if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

export function saveWindowState(win: BrowserWindow): void {
  try {
    const isMaximized = win.isMaximized()
    const bounds = win.getNormalBounds()
    const state: WindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized,
    }
    fs.writeFileSync(getStatePath(), JSON.stringify(state, null, 2), 'utf-8')
  } catch (err) {
    console.warn('[window-state] Failed to save window state:', err)
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function debouncedSave(win: BrowserWindow): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveWindowState(win)
    saveTimer = null
  }, 300)
}

export function attachWindowStateListeners(win: BrowserWindow): void {
  win.on('resize', () => debouncedSave(win))
  win.on('move', () => debouncedSave(win))
  win.on('close', () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    saveWindowState(win)
  })
}

export { DEFAULT_WIDTH, DEFAULT_HEIGHT }
