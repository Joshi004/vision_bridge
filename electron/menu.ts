import { app, Menu, MenuItemConstructorOptions, BrowserWindow, dialog } from 'electron'
import { runLoginFlow } from '../src/backend/auth'

function sendToRenderer(channel: string, data?: unknown) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send(channel, data);
}

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
      label: 'Go',
      submenu: [
        {
          label: 'Compose',
          accelerator: isMac ? 'Cmd+1' : 'Ctrl+1',
          click: () => sendToRenderer('menu-navigate', '/'),
        },
        {
          label: 'Drafts',
          accelerator: isMac ? 'Cmd+2' : 'Ctrl+2',
          click: () => sendToRenderer('menu-navigate', '/drafts'),
        },
        {
          label: 'Tracking',
          accelerator: isMac ? 'Cmd+3' : 'Ctrl+3',
          click: () => sendToRenderer('menu-navigate', '/tracking'),
        },
        {
          label: 'Replies',
          accelerator: isMac ? 'Cmd+4' : 'Ctrl+4',
          click: () => sendToRenderer('menu-navigate', '/replies'),
        },
        {
          label: 'Closed',
          accelerator: isMac ? 'Cmd+5' : 'Ctrl+5',
          click: () => sendToRenderer('menu-navigate', '/closed'),
        },
        {
          label: 'Pipeline',
          accelerator: isMac ? 'Cmd+6' : 'Ctrl+6',
          click: () => sendToRenderer('menu-navigate', '/pipeline'),
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: isMac ? 'Cmd+,' : 'Ctrl+,',
          click: () => sendToRenderer('menu-navigate', '/settings'),
        },
        { type: 'separator' },
        {
          label: 'Command Palette',
          accelerator: isMac ? 'Cmd+K' : 'Ctrl+K',
          click: () => sendToRenderer('menu-action', 'command-palette'),
        },
        {
          label: 'Toggle Sidebar',
          accelerator: isMac ? 'Cmd+B' : 'Ctrl+B',
          click: () => sendToRenderer('menu-action', 'toggle-sidebar'),
        },
        {
          label: 'Toggle Bottom Panel',
          accelerator: isMac ? 'Cmd+J' : 'Ctrl+J',
          click: () => sendToRenderer('menu-action', 'toggle-panel'),
        },
        {
          label: 'Refresh View',
          accelerator: isMac ? 'Cmd+R' : 'Ctrl+R',
          click: () => sendToRenderer('menu-action', 'refresh'),
        },
        {
          label: 'New Lead',
          accelerator: isMac ? 'Cmd+N' : 'Ctrl+N',
          click: () => sendToRenderer('menu-action', 'new-lead'),
        },
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
