import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../src/shared/ipc-channels'

contextBridge.exposeInMainWorld('api', {
  scrape: (url: string, forceScrape: boolean) =>
    ipcRenderer.invoke(IPC.SCRAPE_RUN, { url, forceScrape }),

  scrapeBulk: (urls: string[], forceScrape: boolean) =>
    ipcRenderer.invoke(IPC.SCRAPE_BULK_RUN, { urls, forceScrape }),

  cancelBulkScrape: () =>
    ipcRenderer.invoke(IPC.SCRAPE_BULK_CANCEL),

  login: () =>
    ipcRenderer.invoke(IPC.LOGIN_RUN),

  onScrapeLog: (callback: (entry: { level: string; component: string; message: string; timestamp: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: { level: string; component: string; message: string; timestamp: string }) => callback(entry)
    ipcRenderer.on(IPC.SCRAPE_LOG, handler)
    return handler
  },

  offScrapeLog: (handler: (event: unknown, entry: unknown) => void) => {
    ipcRenderer.off(IPC.SCRAPE_LOG, handler as Parameters<typeof ipcRenderer.off>[1])
  },

  onBulkProgress: (callback: (event: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on(IPC.SCRAPE_BULK_PROGRESS, handler)
    return handler
  },

  offBulkProgress: (handler: (event: unknown, data: unknown) => void) => {
    ipcRenderer.off(IPC.SCRAPE_BULK_PROGRESS, handler as Parameters<typeof ipcRenderer.off>[1])
  },

  openLogsFolder: () =>
    ipcRenderer.invoke(IPC.OPEN_LOGS_FOLDER),

  getSenderConfig: () =>
    ipcRenderer.invoke(IPC.SENDER_CONFIG_GET),

  saveSenderConfig: (fields: Record<string, string>) =>
    ipcRenderer.invoke(IPC.SENDER_CONFIG_SAVE, fields),

  getPromptPreview: () =>
    ipcRenderer.invoke(IPC.PROMPT_PREVIEW),

  getPromptPreviewWithReferral: () =>
    ipcRenderer.invoke(IPC.PROMPT_PREVIEW_REFERRAL),

  checkDuplicate: (url: string) =>
    ipcRenderer.invoke(IPC.LEAD_CHECK_DUPLICATE, { url }),

  createLeadFromScrape: (url: string, forceScrape: boolean) =>
    ipcRenderer.invoke(IPC.LEAD_CREATE_FROM_SCRAPE, { url, forceScrape }),

  getLeadsByStage: (stage: string) =>
    ipcRenderer.invoke(IPC.LEAD_LIST, { stage }),

  updateLeadDraft: (leadId: number, message: string) =>
    ipcRenderer.invoke(IPC.LEAD_UPDATE_DRAFT, { leadId, message }),

  deleteLead: (leadId: number) =>
    ipcRenderer.invoke(IPC.LEAD_DELETE, { leadId }),

  deleteLeads: (ids: number[]) =>
    ipcRenderer.invoke(IPC.LEAD_BULK_DELETE, { ids }),

  regenerateDraft: (leadId: number) =>
    ipcRenderer.invoke(IPC.LEAD_REGENERATE, { leadId }),

  regenerateDraftWithInstruction: (leadId: number, instruction: string) =>
    ipcRenderer.invoke(IPC.LEAD_REGENERATE_WITH_INSTRUCTION, { leadId, instruction }),

  sendLead: (leadId: number, message?: string) =>
    ipcRenderer.invoke(IPC.LEAD_SEND, { leadId, message }),

  refreshLeadProfile: (leadId: number) =>
    ipcRenderer.invoke(IPC.LEAD_REFRESH_PROFILE, { leadId }),

  refreshLeadBoth: (leadId: number) =>
    ipcRenderer.invoke(IPC.LEAD_REFRESH_BOTH, { leadId }),

  generateFollowUp: (leadId: number) =>
    ipcRenderer.invoke(IPC.LEAD_GENERATE_FOLLOWUP, { leadId }),

  sendFollowUp: (leadId: number, message: string) =>
    ipcRenderer.invoke(IPC.LEAD_SEND_FOLLOWUP, { leadId, message }),

  checkForReplies: (leadId: number) =>
    ipcRenderer.invoke(IPC.LEAD_CHECK_FOR_REPLIES, { leadId }),

  checkAllReplies: () =>
    ipcRenderer.invoke(IPC.LEAD_CHECK_ALL_REPLIES),

  markCold: (leadId: number) =>
    ipcRenderer.invoke(IPC.LEAD_MARK_COLD, { leadId }),

  getOverdueCount: () =>
    ipcRenderer.invoke(IPC.LEAD_OVERDUE_COUNT),

  generateReply: (leadId: number) =>
    ipcRenderer.invoke(IPC.LEAD_GENERATE_REPLY, { leadId }),

  sendReply: (leadId: number, message: string) =>
    ipcRenderer.invoke(IPC.LEAD_SEND_REPLY, { leadId, message }),

  markConverted: (leadId: number) =>
    ipcRenderer.invoke(IPC.LEAD_MARK_CONVERTED, { leadId }),

  updateRepliedLead: (leadId: number) =>
    ipcRenderer.invoke(IPC.LEAD_UPDATE_REPLIED, { leadId }),

  reopenLead: (leadId: number) =>
    ipcRenderer.invoke(IPC.LEAD_REOPEN, { leadId }),

  queue: {
    getStatus: () =>
      ipcRenderer.invoke(IPC.QUEUE_STATUS),

    cancel: (jobId: string) =>
      ipcRenderer.invoke(IPC.QUEUE_CANCEL, { jobId }),

    cancelAll: (queueName?: string) =>
      ipcRenderer.invoke(IPC.QUEUE_CANCEL, { queueName }),

    retry: (jobId: string) =>
      ipcRenderer.invoke(IPC.QUEUE_RETRY, { jobId }),

    onProgress: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(IPC.QUEUE_PROGRESS, handler)
      return handler
    },

    removeProgressListener: (handler: (event: unknown, data: unknown) => void) => {
      ipcRenderer.off(IPC.QUEUE_PROGRESS, handler as Parameters<typeof ipcRenderer.off>[1])
    },

    onDrained: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
      ipcRenderer.on(IPC.QUEUE_DRAINED, handler)
      return handler
    },

    removeDrainedListener: (handler: (event: unknown, data: unknown) => void) => {
      ipcRenderer.off(IPC.QUEUE_DRAINED, handler as Parameters<typeof ipcRenderer.off>[1])
    },

    onSessionExpired: (callback: () => void) => {
      const handler = (_event: Electron.IpcRendererEvent) => callback()
      ipcRenderer.on(IPC.QUEUE_SESSION_EXPIRED, handler)
      return handler
    },

    removeSessionExpiredListener: (handler: (event: unknown) => void) => {
      ipcRenderer.off(IPC.QUEUE_SESSION_EXPIRED, handler as Parameters<typeof ipcRenderer.off>[1])
    },
  },
})
