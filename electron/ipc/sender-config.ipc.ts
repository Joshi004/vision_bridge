import { ipcMain } from 'electron'
import { IPC } from '../../src/shared/ipc-channels'
import { getSenderConfig, updateSenderConfig } from '../../src/backend/db'
import { getPromptPreview } from '../../src/backend/summarizer'

export function registerSenderConfigHandlers(): void {
  ipcMain.handle(IPC.SENDER_CONFIG_GET, () => {
    try {
      const config = getSenderConfig()
      return { success: true, config }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { error: true, message: `Failed to get sender config: ${message}` }
    }
  })

  ipcMain.handle(IPC.SENDER_CONFIG_SAVE, (_event, fields: unknown) => {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return { error: true, message: 'fields must be a non-null object.' }
    }

    try {
      const config = updateSenderConfig(fields as Record<string, string>)
      return { success: true, config }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { error: true, message: `Failed to save sender config: ${message}` }
    }
  })

  ipcMain.handle(IPC.PROMPT_PREVIEW, () => {
    try {
      const config = getSenderConfig()
      const prompt = getPromptPreview(config)
      return { success: true, prompt }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { error: true, message: `Failed to generate prompt preview: ${message}` }
    }
  })
}
