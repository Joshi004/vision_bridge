import { ipcMain } from 'electron'
import { IPC } from '../../src/shared/ipc-channels'
import { runLoginFlow } from '../../src/backend/auth'
import { findChromePath } from '../../src/backend/chrome-finder'

export function registerLoginHandlers(): void {
  ipcMain.handle(IPC.LOGIN_RUN, async () => {
    try {
      let executablePath: string | undefined
      try {
        executablePath = findChromePath()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { error: true, message: `Chrome not found: ${message}` }
      }

      await runLoginFlow(executablePath)
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { error: true, message }
    }
  })
}
