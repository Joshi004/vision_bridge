import { ipcMain, Menu, dialog, BrowserWindow } from 'electron'
import { IPC } from '../../src/shared/ipc-channels'

interface ContextMenuItemDescriptor {
  id: string
  label: string
  type?: 'separator'
  enabled?: boolean
  accelerator?: string
}

interface ConfirmDialogOptions {
  title: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
}

export function registerUiHandlers(): void {
  ipcMain.handle(IPC.CONTEXT_MENU_SHOW, async (_event, items: ContextMenuItemDescriptor[]) => {
    return new Promise<string | null>((resolve) => {
      const template = items.map((item): Electron.MenuItemConstructorOptions => {
        if (item.type === 'separator') {
          return { type: 'separator' }
        }
        return {
          label: item.label,
          enabled: item.enabled !== false,
          accelerator: item.accelerator,
          click: () => resolve(item.id),
        }
      })

      const menu = Menu.buildFromTemplate(template)
      const win = BrowserWindow.getFocusedWindow()
      if (!win) {
        resolve(null)
        return
      }

      menu.popup({
        window: win,
        callback: () => {
          // Resolve with null if the menu is dismissed without selecting an item.
          // The click handler above will have already resolved with an id if an item was clicked,
          // but Promise.resolve is idempotent so this safe-resolve is harmless.
          resolve(null)
        },
      })
    })
  })

  ipcMain.handle(IPC.DIALOG_CONFIRM, async (_event, options: ConfirmDialogOptions) => {
    const win = BrowserWindow.getFocusedWindow()
    const { response } = await dialog.showMessageBox(win ?? BrowserWindow.getAllWindows()[0], {
      type: 'warning',
      title: options.title,
      message: options.message,
      detail: options.detail,
      buttons: [options.confirmLabel ?? 'Confirm', options.cancelLabel ?? 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    })
    return response === 0
  })
}
