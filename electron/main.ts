import { app, BrowserWindow, Menu, shell, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { initPaths, getLogsDir } from '../src/backend/paths'
import { initDatabase, closeDatabase } from '../src/backend/db'
import { registerScrapeHandlers, registerBulkScrapeHandlers } from './ipc/scrape.ipc'
import { registerLoginHandlers } from './ipc/login.ipc'
import { registerSenderConfigHandlers } from './ipc/sender-config.ipc'
import { registerLeadHandlers } from './ipc/lead.ipc'
import { IPC } from '../src/shared/ipc-channels'
import { findChromePath } from '../src/backend/chrome-finder'
import { buildAppMenu } from './menu'
import { loadWindowState, attachWindowStateListeners, DEFAULT_WIDTH, DEFAULT_HEIGHT } from './window-state'
import { migrateOutreachToLeads } from '../src/backend/migrate-to-leads'
import { autoTransitionToCold } from '../src/backend/lead-service'

// Improve Puppeteer stability when spawning a separate Chrome process from Electron.
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors')

// Single instance lock — quit immediately if another instance is already running.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  function createWindow(): void {
    const preload = join(__dirname, '../preload/preload.mjs')
    const savedState = loadWindowState()

    const win = new BrowserWindow({
      width: savedState?.width ?? DEFAULT_WIDTH,
      height: savedState?.height ?? DEFAULT_HEIGHT,
      x: savedState?.x,
      y: savedState?.y,
      webPreferences: {
        preload,
        sandbox: false
      }
    })

    if (savedState?.isMaximized) {
      win.maximize()
    }

    attachWindowStateListeners(win)

    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    if (process.env.ELECTRON_RENDERER_URL) {
      win.loadURL(process.env.ELECTRON_RENDERER_URL)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'))
    }
  }

  app.whenReady().then(async () => {
    // Set the native application menu.
    Menu.setApplicationMenu(buildAppMenu())

    // Check for Chrome/Chromium — warn but don't quit (user can still view outreach data).
    try {
      const chromePath = findChromePath()
      console.log('[main] System Chrome found at:', chromePath)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.warn('[main] Chrome not found at startup:', message)
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Chrome Not Found',
        message: 'Google Chrome was not found on this machine.',
        detail:
          'Scraping and LinkedIn login require Google Chrome. You can still view existing outreach data.\n\n' +
          'Install Google Chrome or set the CHROME_PATH environment variable and restart the app.',
        buttons: ['OK'],
      })
    }

    // Initialize backend paths using Electron's userData directory.
    initPaths(app.getPath('userData'))

    // Initialize database — fatal error if it fails.
    try {
      initDatabase()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[main] Database initialization failed:', message)
      dialog.showErrorBox('Database Error', `Failed to initialize the database:\n\n${message}`)
      app.quit()
      return
    }

    // Run one-time data migration (non-fatal if it fails).
    try {
      migrateOutreachToLeads()
    } catch (e) {
      console.error('[main] Lead migration failed:', e instanceof Error ? e.message : String(e))
    }

    // Auto-transition exhausted contacted leads to cold (non-fatal if it fails).
    try {
      const coldCount = autoTransitionToCold()
      console.log(`[main] Auto-cold transition: ${coldCount} leads moved to cold`)
    } catch (e) {
      console.error('[main] Auto-cold transition failed:', e instanceof Error ? e.message : String(e))
    }

    registerScrapeHandlers()
    registerBulkScrapeHandlers()
    registerLoginHandlers()
    registerSenderConfigHandlers()
    registerLeadHandlers()

    ipcMain.handle(IPC.OPEN_LOGS_FOLDER, async () => {
      await shell.openPath(getLogsDir())
    })

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })

  app.on('will-quit', () => {
    console.log('[main] App quitting — cleaning up...')
    try {
      closeDatabase()
      console.log('[main] Database closed.')
    } catch (e) {
      console.error('[main] Error closing database:', e)
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
