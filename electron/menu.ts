import { app, Menu, MenuItemConstructorOptions, BrowserWindow, dialog } from 'electron'
import { runLoginFlow } from '../src/backend/auth'

export function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    // macOS application menu (first menu is always the app name on macOS)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),

    {
      label: 'File',
      submenu: [
        {
          label: 'LinkedIn Login',
          accelerator: isMac ? 'Cmd+Shift+L' : 'Ctrl+Shift+L',
          click: async () => {
            const win = BrowserWindow.getFocusedWindow()
            try {
              await runLoginFlow()
              dialog.showMessageBox(win ?? BrowserWindow.getAllWindows()[0], {
                type: 'info',
                title: 'LinkedIn Login',
                message: 'Login successful! Your session has been saved.',
              })
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              dialog.showErrorBox('LinkedIn Login Failed', message)
            }
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },

    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
            ]
          : [{ role: 'delete' as const }, { type: 'separator' as const }, { role: 'selectAll' as const }]),
      ],
    },

    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },

    {
      role: 'help' as const,
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            const { shell } = await import('electron')
            await shell.openExternal('https://github.com')
          },
        },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}
