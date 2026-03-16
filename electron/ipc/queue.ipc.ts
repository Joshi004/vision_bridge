import { ipcMain, BrowserWindow, Notification } from 'electron'
import { IPC } from '../../src/shared/ipc-channels'
import {
  getQueueStatus,
  cancelJob,
  cancelAll,
  retryJob,
  queueEvents,
  QueueName,
} from '../queue'

export function registerQueueHandlers(win: BrowserWindow): void {
  ipcMain.handle(IPC.QUEUE_STATUS, () => {
    return getQueueStatus()
  })

  ipcMain.handle(IPC.QUEUE_CANCEL, (_event, args: { jobId?: string; queueName?: QueueName }) => {
    if (args?.jobId) {
      const cancelled = cancelJob(args.jobId)
      return { success: cancelled }
    }
    cancelAll(args?.queueName)
    return { success: true }
  })

  ipcMain.handle(IPC.QUEUE_RETRY, (_event, args: { jobId: string }) => {
    return retryJob(args.jobId)
  })

  queueEvents.on('job-status-change', (item) => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.QUEUE_PROGRESS, item)
    }
  })

  queueEvents.on('queue-drained', (drainInfo) => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.QUEUE_DRAINED, drainInfo)
    }

    // Native OS notification — only for bulk operations (2+ items) when window is unfocused
    const total = drainInfo.completed + drainInfo.failed
    if (total >= 2 && !win.isDestroyed() && !win.isFocused()) {
      const title =
        drainInfo.queue === 'action' ? 'All messages sent' : 'Bulk operation complete'
      const body =
        drainInfo.queue === 'action'
          ? `${drainInfo.completed} succeeded, ${drainInfo.failed} failed.`
          : `${total} profiles processed.`
      new Notification({ title, body }).show()
    }
  })

  queueEvents.on('session-expired', () => {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.QUEUE_SESSION_EXPIRED)
    }
  })
}
