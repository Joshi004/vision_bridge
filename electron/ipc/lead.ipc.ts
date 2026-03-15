import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../src/shared/ipc-channels'
import { cookiesExist, deleteCookies } from '../../src/backend/auth'
import { scrapeProfiles } from '../../src/backend/scraper'
import { sendLinkedInMessage } from '../../src/backend/sender'
import { summarizeProfile, parseOutreachResponse, generateFollowUp, generateReplyAssist, generateReEngagement } from '../../src/backend/summarizer'
import {
  upsertProfile,
  getFullProfileData,
  getProfileByUrl,
  getSenderConfig,
  getDb,
} from '../../src/backend/db'
import {
  createLead,
  getLeadByProfileId,
  getLeadById,
  getProfileLinkedInUrl,
  addToThread,
  getLeadsWithProfileByStage,
  getLeadWithProfileById,
  updateLeadDraft,
  deleteLead,
  transitionStage,
  getNextFollowUpType,
  recordFollowUpSent,
  getOverdueFollowUpCount,
  getLeadsByStage,
  getConversationThread,
  autoTransitionToCold,
} from '../../src/backend/lead-service'
import * as log from '../../src/backend/logger'

const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000 // 3 days in milliseconds

function isLinkedInProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      (parsed.hostname === 'www.linkedin.com' || parsed.hostname === 'linkedin.com') &&
      parsed.pathname.startsWith('/in/')
    )
  } catch {
    return false
  }
}

/**
 * Safety net: if the LLM classifies a conversation as "referral_inbound"
 * but there are no self messages in the actual LinkedIn history, the model
 * has misclassified. Override to "referral_inbound_fresh" so the correct
 * initial decline message is used rather than a follow-up.
 */
function correctConversationType(
  outreach: ReturnType<typeof parseOutreachResponse>,
  profileMessages: Array<{ sender: string }>,
): ReturnType<typeof parseOutreachResponse> {
  if (outreach.conversationType === 'referral_inbound') {
    const selfCount = profileMessages.filter((m) => m.sender === 'self').length
    if (selfCount === 0) {
      log.error(
        'ipc/lead',
        `LLM classified as "referral_inbound" but no self messages exist — overriding to "referral_inbound_fresh"`,
      )
      return { ...outreach, conversationType: 'referral_inbound_fresh' }
    }
  }
  return outreach
}

export function registerLeadHandlers(): void {
  ipcMain.handle(IPC.LEAD_CHECK_DUPLICATE, async (_event, { url }: { url: string }) => {
    if (!url || typeof url !== 'string' || url.trim() === '') {
      return { exists: false }
    }

    const trimmedUrl = url.trim()

    const profile = getProfileByUrl(trimmedUrl)
    if (!profile) {
      return { exists: false }
    }

    const lead = getLeadByProfileId(profile.id)
    if (!lead) {
      return { exists: false }
    }

    return {
      exists: true,
      lead: {
        stage: lead.stage,
        name: profile.name,
        company: lead.company,
      },
    }
  })

  ipcMain.handle(
    IPC.LEAD_CREATE_FROM_SCRAPE,
    async (_event, { url, forceScrape }: { url: string; forceScrape: boolean }) => {
      if (!url || typeof url !== 'string' || url.trim() === '') {
        return { success: false, message: "Request must include a non-empty 'url' field." }
      }

      const trimmedUrl = url.trim()

      if (!isLinkedInProfileUrl(trimmedUrl)) {
        return {
          success: false,
          message: "The 'url' field must be a valid LinkedIn profile URL (e.g. https://www.linkedin.com/in/username/).",
        }
      }

      if (!cookiesExist()) {
        return {
          success: false,
          needsLogin: true,
          message: 'No LinkedIn session found. Please log in to continue.',
        }
      }

      log.init()

      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        log.setLogForwarder((level, component, message, timestamp) => {
          if (!win.isDestroyed()) {
            win.webContents.send(IPC.SCRAPE_LOG, { level, component, message, timestamp })
          }
        })
      }

      try {
        // Step 1: Duplicate check — bail early if a lead already exists for this URL.
        const existingProfile = getProfileByUrl(trimmedUrl)
        if (existingProfile) {
          const existingLead = getLeadByProfileId(existingProfile.id)
          if (existingLead) {
            return {
              success: false,
              duplicate: true,
              lead: { stage: existingLead.stage, name: existingProfile.name },
            }
          }
        }

        // Step 2: Get or scrape the profile.
        let profileId: number
        let profileData: import('../../src/backend/types.js').ProfileData

        if (!forceScrape) {
          const cached = getFullProfileData(trimmedUrl)
          if (cached) {
            const ageMs = Date.now() - new Date(cached.lastScrapedAt).getTime()
            if (ageMs < CACHE_TTL_MS) {
              log.info('ipc/lead', `Using cached profile for: ${trimmedUrl} (scraped ${Math.round(ageMs / 3600000)}h ago)`)
              profileId = cached.profileId
              profileData = cached.profileData
            } else {
              const scraped = await runScrape(trimmedUrl)
              if ('error' in scraped) return { success: false as const, message: scraped.error, needsLogin: scraped.needsLogin }
              profileId = scraped.profileId
              profileData = scraped.profileData
            }
          } else {
            const scraped = await runScrape(trimmedUrl)
            if ('error' in scraped) return { success: false as const, message: scraped.error, needsLogin: scraped.needsLogin }
            profileId = scraped.profileId
            profileData = scraped.profileData
          }
        } else {
          const scraped = await runScrape(trimmedUrl)
          if ('error' in scraped) return { success: false as const, message: scraped.error, needsLogin: scraped.needsLogin }
          profileId = scraped.profileId
          profileData = scraped.profileData
        }

        // Step 3: Fetch sender config.
        const senderConfig = getSenderConfig()
        if (!senderConfig) {
          return { success: false, message: 'Sender configuration not found. Please set up your profile in Settings.' }
        }

        // Step 4: Summarize the profile.
        let rawSummary: string
        try {
          log.info('ipc/lead', `Generating outreach message for: ${profileData.name ?? trimmedUrl}`)
          rawSummary = await summarizeProfile(profileData, senderConfig)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          log.error('ipc/lead', `LLM call failed: ${message}`)
          return { success: false, message: `Outreach generation failed: ${message}` }
        }

        const outreach = correctConversationType(parseOutreachResponse(rawSummary), profileData.messages)

        // Step 5: Create the lead in 'draft' stage.
        let leadId: number
        try {
          leadId = createLead(profileId, 'draft')
          log.info('ipc/lead', `Lead created with id: ${leadId}`)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          log.error('ipc/lead', `Failed to create lead: ${message}`)
          return { success: false, message: `Failed to create lead: ${message}` }
        }

        // Step 6: Store the LLM output fields on the lead row.
        try {
          getDb()
            .prepare(
              `UPDATE leads SET initial_message = ?, role = ?, company = ?, outreach_angle = ?, conversation_type = ?, strategic_goal = ?, conversation_initiator = ?, persona = ?, message_state = ?, updated_at = datetime('now') WHERE id = ?`
            )
            .run(outreach.message, outreach.role || null, outreach.company || null, outreach.outreachAngle || null, outreach.conversationType || null, outreach.strategicGoal || null, outreach.conversationInitiator || null, outreach.persona || null, outreach.messageState || null, leadId)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          log.error('ipc/lead', `Failed to update lead fields: ${message}`)
          return { success: false, message: `Failed to update lead fields: ${message}` }
        }

        // Step 7: Append the initial message to the outreach thread.
        try {
          addToThread(leadId, 'initial', 'self', outreach.message)
          log.info('ipc/lead', `Message added to outreach thread for lead: ${leadId}`)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          log.error('ipc/lead', `Failed to add message to thread: ${message}`)
          return { success: false, message: `Failed to add message to thread: ${message}` }
        }

        // Step 8: Return success.
        return {
          success: true,
          lead: {
            id: leadId,
            name: profileData.name,
            stage: 'draft',
          },
        }
        } finally {
        log.clearLogForwarder()
      }
    }
  )

  ipcMain.handle(IPC.LEAD_LIST, (_event, { stage }: { stage: string }) => {
    return getLeadsWithProfileByStage(stage)
  })

  ipcMain.handle(
    IPC.LEAD_UPDATE_DRAFT,
    (_event, { leadId, message }: { leadId: number; message: string }) => {
      updateLeadDraft(leadId, message)
      return { success: true }
    }
  )

  ipcMain.handle(IPC.LEAD_DELETE, (_event, { leadId }: { leadId: number }) => {
    deleteLead(leadId)
    return { success: true }
  })

  ipcMain.handle(IPC.LEAD_REGENERATE, async (_event, { leadId }: { leadId: number }) => {
    return regenerateLeadDraft(leadId)
  })

  ipcMain.handle(
    IPC.LEAD_REGENERATE_WITH_INSTRUCTION,
    async (_event, { leadId, instruction }: { leadId: number; instruction: string }) => {
      if (!instruction || typeof instruction !== 'string' || instruction.trim() === '') {
        return { success: false, error: 'instruction must be a non-empty string.' }
      }
      return regenerateLeadDraft(leadId, instruction.trim())
    }
  )

  ipcMain.handle(
    IPC.LEAD_SEND,
    async (_event, { leadId, message }: { leadId: number; message?: string }) => {
      const lead = getLeadById(leadId)
      if (!lead) {
        return { success: false, error: `Lead with id ${leadId} not found.` }
      }
      if (lead.stage !== 'draft') {
        return { success: false, error: `Lead ${leadId} is not in draft stage (current stage: ${lead.stage}).` }
      }

      const linkedinUrl = getProfileLinkedInUrl(lead.profile_id)
      if (!linkedinUrl) {
        return { success: false, error: `Profile for lead ${leadId} not found.` }
      }

      const messageText = message ?? lead.initial_message
      if (!messageText) {
        return { success: false, error: 'No message to send. Please set a draft message first.' }
      }

      try {
        await sendLinkedInMessage(linkedinUrl, messageText)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        if (errMsg === 'SESSION_EXPIRED') {
          deleteCookies()
          log.error('ipc/lead', 'LinkedIn session expired during send; cookies deleted')
          return { success: false, needsLogin: true, error: 'Your LinkedIn session has expired. Please log in again.' }
        }
        log.error('ipc/lead', `sendLinkedInMessage failed: ${errMsg}`)
        return { success: false, error: `Failed to send message: ${errMsg}` }
      }

      transitionStage(leadId, 'draft', 'contacted', 'user')

      getDb()
        .prepare(
          `UPDATE leads SET initial_sent_at = datetime('now'), last_contacted_at = datetime('now'), next_follow_up_at = datetime('now', '+3 days'), follow_up_count = 0, updated_at = datetime('now') WHERE id = ?`
        )
        .run(leadId)

      const db = getDb()
      const existingThread = db
        .prepare(`SELECT id FROM outreach_thread WHERE lead_id = ? AND message_type = 'initial'`)
        .get(leadId) as { id: number } | undefined

      if (existingThread) {
        db.prepare(`UPDATE outreach_thread SET sent_at = datetime('now') WHERE id = ?`).run(existingThread.id)
      } else {
        addToThread(leadId, 'initial', 'self', messageText)
      }

      log.info('ipc/lead', `Lead ${leadId} sent and transitioned to contacted`)
      return { success: true }
    }
  )

  ipcMain.handle(
    IPC.LEAD_REFRESH_PROFILE,
    async (_event, { leadId }: { leadId: number }) => {
      const lead = getLeadById(leadId)
      if (!lead) {
        return { success: false, error: `Lead with id ${leadId} not found.` }
      }

      const linkedinUrl = getProfileLinkedInUrl(lead.profile_id)
      if (!linkedinUrl) {
        return { success: false, error: `Profile for lead ${leadId} not found.` }
      }

      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        log.setLogForwarder((level, component, message, timestamp) => {
          if (!win.isDestroyed()) {
            win.webContents.send(IPC.SCRAPE_LOG, { level, component, message, timestamp })
          }
        })
      }

      try {
        const scrapeResult = await runScrape(linkedinUrl)
        if ('error' in scrapeResult) return scrapeResult

        log.info('ipc/lead', `Profile refreshed for lead ${leadId}`)
        const updated = getLeadWithProfileById(leadId)
        if (!updated) {
          return { success: false, error: `Lead ${leadId} not found after profile refresh.` }
        }
        return updated
      } finally {
        log.clearLogForwarder()
      }
    }
  )

  ipcMain.handle(
    IPC.LEAD_REFRESH_BOTH,
    async (_event, { leadId }: { leadId: number }) => {
      const lead = getLeadById(leadId)
      if (!lead) {
        return { success: false, error: `Lead with id ${leadId} not found.` }
      }

      const linkedinUrl = getProfileLinkedInUrl(lead.profile_id)
      if (!linkedinUrl) {
        return { success: false, error: `Profile for lead ${leadId} not found.` }
      }

      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        log.setLogForwarder((level, component, message, timestamp) => {
          if (!win.isDestroyed()) {
            win.webContents.send(IPC.SCRAPE_LOG, { level, component, message, timestamp })
          }
        })
      }

      try {
        const scrapeResult = await runScrape(linkedinUrl)
        if ('error' in scrapeResult) return scrapeResult

        const regenResult = await regenerateLeadDraft(leadId)
        if ('success' in regenResult && regenResult.success === false) return regenResult

        log.info('ipc/lead', `Profile and draft refreshed for lead ${leadId}`)
        const updated = getLeadWithProfileById(leadId)
        if (!updated) {
          return { success: false, error: `Lead ${leadId} not found after refresh.` }
        }
        return updated
      } finally {
        log.clearLogForwarder()
      }
    }
  )

  ipcMain.handle(
    IPC.LEAD_GENERATE_FOLLOWUP,
    async (_event, { leadId }: { leadId: number }) => {
      const lead = getLeadById(leadId)
      if (!lead) {
        return { success: false, error: `Lead with id ${leadId} not found.` }
      }

      const followUpType = getNextFollowUpType(lead)
      if (!followUpType) {
        return { success: false, error: `All follow-ups exhausted for lead ${leadId}.` }
      }

      const followUpNumber = parseInt(followUpType.slice(-1), 10)

      const linkedinUrl = getProfileLinkedInUrl(lead.profile_id)
      if (!linkedinUrl) {
        return { success: false, error: `Profile for lead ${leadId} not found.` }
      }

      const profileResult = getFullProfileData(linkedinUrl)
      if (!profileResult) {
        return { success: false, error: `No stored profile data found for lead ${leadId}.` }
      }

      const senderConfig = getSenderConfig()
      if (!senderConfig) {
        return { success: false, error: 'Sender configuration not found. Please set up your profile in Settings.' }
      }

      const db = getDb()
      const priorMessages = db
        .prepare<number[], import('../../src/backend/lead-service.js').OutreachThreadRow>(
          'SELECT * FROM outreach_thread WHERE lead_id = ? ORDER BY sent_at ASC'
        )
        .all(leadId) as import('../../src/backend/lead-service.js').OutreachThreadRow[]

      let generatedMessage: string
      try {
        log.info('ipc/lead', `Generating follow-up #${followUpNumber} for lead ${leadId}`)
        generatedMessage = await generateFollowUp(profileResult.profileData, senderConfig, priorMessages, followUpNumber, lead.conversation_type ?? undefined, lead.strategic_goal ?? undefined, lead.conversation_initiator ?? undefined, lead.persona ?? undefined)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error('ipc/lead', `Follow-up generation failed: ${message}`)
        return { success: false, error: `Follow-up generation failed: ${message}` }
      }

      return {
        success: true,
        followUpNumber,
        followUpType,
        generatedMessage,
        priorMessages,
      }
    }
  )

  ipcMain.handle(
    IPC.LEAD_SEND_FOLLOWUP,
    async (_event, { leadId, message }: { leadId: number; message: string }) => {
      if (!message || typeof message !== 'string' || message.trim() === '') {
        return { success: false, error: 'message must be a non-empty string.' }
      }

      const lead = getLeadById(leadId)
      if (!lead) {
        return { success: false, error: `Lead with id ${leadId} not found.` }
      }
      if (lead.stage !== 'contacted') {
        return { success: false, error: `Lead ${leadId} is not in contacted stage (current stage: ${lead.stage}).` }
      }

      const followUpType = getNextFollowUpType(lead)
      if (!followUpType) {
        return { success: false, error: `All follow-ups exhausted for lead ${leadId}.` }
      }

      const linkedinUrl = getProfileLinkedInUrl(lead.profile_id)
      if (!linkedinUrl) {
        return { success: false, error: `Profile for lead ${leadId} not found.` }
      }

      try {
        await sendLinkedInMessage(linkedinUrl, message.trim())
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        if (errMsg === 'SESSION_EXPIRED') {
          deleteCookies()
          log.error('ipc/lead', 'LinkedIn session expired during follow-up send; cookies deleted')
          return { success: false, needsLogin: true, error: 'Your LinkedIn session has expired. Please log in again.' }
        }
        log.error('ipc/lead', `sendLinkedInMessage failed for follow-up: ${errMsg}`)
        return { success: false, error: `Failed to send follow-up: ${errMsg}` }
      }

      addToThread(leadId, followUpType, 'self', message.trim())
      recordFollowUpSent(leadId)

      log.info('ipc/lead', `Follow-up (${followUpType}) sent for lead ${leadId}`)
      return { success: true }
    }
  )

  ipcMain.handle(
    IPC.LEAD_CHECK_FOR_REPLIES,
    async (_event, { leadId }: { leadId: number }) => {
      const lead = getLeadById(leadId)
      if (!lead) {
        return { success: false, error: `Lead with id ${leadId} not found.` }
      }

      const linkedinUrl = getProfileLinkedInUrl(lead.profile_id)
      if (!linkedinUrl) {
        return { success: false, error: `Profile for lead ${leadId} not found.` }
      }

      // Capture stored messages before the scrape overwrites linkedin_messages.
      const db = getDb()
      const storedMessages = db
        .prepare<number[], { sender: string; text: string }>(
          'SELECT sender, text FROM linkedin_messages WHERE profile_id = ? ORDER BY sort_order ASC'
        )
        .all(lead.profile_id) as { sender: string; text: string }[]

      const storedKeys = new Set<string>(storedMessages.map((m) => `${m.sender}::${m.text}`))

      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        log.setLogForwarder((level, component, message, timestamp) => {
          if (!win.isDestroyed()) {
            win.webContents.send(IPC.SCRAPE_LOG, { level, component, message, timestamp })
          }
        })
      }

      try {
        const scrapeResult = await runScrape(linkedinUrl)
        if ('error' in scrapeResult) return scrapeResult

        // Read fresh messages after the scrape has updated linkedin_messages.
        const freshMessages = db
          .prepare<number[], { sender: string; text: string }>(
            'SELECT sender, text FROM linkedin_messages WHERE profile_id = ? ORDER BY sort_order ASC'
          )
          .all(lead.profile_id) as { sender: string; text: string }[]

        const newReplies = freshMessages.filter(
          (m) => m.sender !== 'self' && !storedKeys.has(`${m.sender}::${m.text}`)
        )

        if (newReplies.length > 0) {
          transitionStage(leadId, 'contacted', 'replied', 'system')
          db.prepare(
            `UPDATE leads SET replied_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
          ).run(leadId)

          for (const reply of newReplies) {
            addToThread(leadId, 'reply_received', 'them', reply.text)
          }

          log.info('ipc/lead', `Reply detected for lead ${leadId} — transitioned to replied`)
          return { success: true, hasReply: true, replyContent: newReplies }
        }

        return { success: true, hasReply: false }
      } finally {
        log.clearLogForwarder()
      }
    }
  )

  ipcMain.handle(IPC.LEAD_CHECK_ALL_REPLIES, async () => {
    const contactedLeads = getLeadsByStage('contacted')
    const results = { checked: 0, repliesFound: 0, errors: 0 }

    for (const lead of contactedLeads) {
      results.checked++

      const linkedinUrl = getProfileLinkedInUrl(lead.profile_id)
      if (!linkedinUrl) {
        log.error('ipc/lead', `No LinkedIn URL for lead ${lead.id} — skipping`)
        results.errors++
        continue
      }

      try {
        const db = getDb()
        const storedMessages = db
          .prepare<number[], { sender: string; text: string }>(
            'SELECT sender, text FROM linkedin_messages WHERE profile_id = ? ORDER BY sort_order ASC'
          )
          .all(lead.profile_id) as { sender: string; text: string }[]

        const storedKeys = new Set<string>(storedMessages.map((m) => `${m.sender}::${m.text}`))

        const scrapeResult = await runScrape(linkedinUrl)
        if ('error' in scrapeResult) {
          log.error('ipc/lead', `Scrape failed for lead ${lead.id}: ${scrapeResult.error}`)
          results.errors++
          continue
        }

        const freshMessages = db
          .prepare<number[], { sender: string; text: string }>(
            'SELECT sender, text FROM linkedin_messages WHERE profile_id = ? ORDER BY sort_order ASC'
          )
          .all(lead.profile_id) as { sender: string; text: string }[]

        const newReplies = freshMessages.filter(
          (m) => m.sender !== 'self' && !storedKeys.has(`${m.sender}::${m.text}`)
        )

        if (newReplies.length > 0) {
          transitionStage(lead.id, 'contacted', 'replied', 'system')
          db.prepare(
            `UPDATE leads SET replied_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
          ).run(lead.id)

          for (const reply of newReplies) {
            addToThread(lead.id, 'reply_received', 'them', reply.text)
          }

          log.info('ipc/lead', `Reply detected for lead ${lead.id} during check-all`)
          results.repliesFound++
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        log.error('ipc/lead', `Error checking replies for lead ${lead.id}: ${errMsg}`)
        results.errors++
      }
    }

    log.info('ipc/lead', `check-all-replies complete: checked=${results.checked} replies=${results.repliesFound} errors=${results.errors}`)

    let autoColdCount = 0
    try {
      autoColdCount = autoTransitionToCold()
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      log.error('ipc/lead', `Auto-cold transition failed: ${errMsg}`)
    }

    return { success: true, ...results, autoColdCount }
  })

  ipcMain.handle(IPC.LEAD_MARK_COLD, (_event, { leadId }: { leadId: number }) => {
    const lead = getLeadById(leadId)
    if (!lead) {
      return { success: false, error: `Lead with id ${leadId} not found.` }
    }
    if (lead.stage !== 'contacted' && lead.stage !== 'replied') {
      return { success: false, error: `Lead ${leadId} is not in contacted or replied stage (current stage: ${lead.stage}).` }
    }

    transitionStage(leadId, lead.stage, 'cold', 'user')
    getDb()
      .prepare(`UPDATE leads SET closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(leadId)

    log.info('ipc/lead', `Lead ${leadId} marked as cold`)
    return { success: true }
  })

  ipcMain.handle(IPC.LEAD_OVERDUE_COUNT, () => {
    const count = getOverdueFollowUpCount()
    return { success: true, count }
  })

  ipcMain.handle(
    IPC.LEAD_GENERATE_REPLY,
    async (_event, { leadId }: { leadId: number }) => {
      const lead = getLeadById(leadId)
      if (!lead) {
        return { success: false, error: `Lead with id ${leadId} not found.` }
      }
      if (lead.stage !== 'replied') {
        return { success: false, error: `Lead ${leadId} is not in replied stage (current stage: ${lead.stage}).` }
      }

      const linkedinUrl = getProfileLinkedInUrl(lead.profile_id)
      if (!linkedinUrl) {
        return { success: false, error: `Profile for lead ${leadId} not found.` }
      }

      const profileResult = getFullProfileData(linkedinUrl)
      if (!profileResult) {
        return { success: false, error: `No stored profile data found for lead ${leadId}.` }
      }

      const senderConfig = getSenderConfig()
      if (!senderConfig) {
        return { success: false, error: 'Sender configuration not found. Please set up your profile in Settings.' }
      }

      const conversationThread = getConversationThread(leadId)

      let generatedReply: string
      try {
        log.info('ipc/lead', `Generating reply assist for lead ${leadId}`)
        generatedReply = await generateReplyAssist(profileResult.profileData, senderConfig, conversationThread, lead.conversation_type ?? undefined, lead.strategic_goal ?? undefined, lead.conversation_initiator ?? undefined, lead.persona ?? undefined)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error('ipc/lead', `Reply assist generation failed: ${message}`)
        return { success: false, error: `Reply generation failed: ${message}` }
      }

      return { generatedReply, conversationThread }
    }
  )

  ipcMain.handle(
    IPC.LEAD_SEND_REPLY,
    async (_event, { leadId, message }: { leadId: number; message: string }) => {
      if (!message || typeof message !== 'string' || message.trim() === '') {
        return { success: false, error: 'message must be a non-empty string.' }
      }

      const lead = getLeadById(leadId)
      if (!lead) {
        return { success: false, error: `Lead with id ${leadId} not found.` }
      }
      if (lead.stage !== 'replied') {
        return { success: false, error: `Lead ${leadId} is not in replied stage (current stage: ${lead.stage}).` }
      }

      const linkedinUrl = getProfileLinkedInUrl(lead.profile_id)
      if (!linkedinUrl) {
        return { success: false, error: `Profile for lead ${leadId} not found.` }
      }

      try {
        await sendLinkedInMessage(linkedinUrl, message.trim())
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        if (errMsg === 'SESSION_EXPIRED') {
          deleteCookies()
          log.error('ipc/lead', 'LinkedIn session expired during reply send; cookies deleted')
          return { success: false, needsLogin: true, error: 'Your LinkedIn session has expired. Please log in again.' }
        }
        log.error('ipc/lead', `sendLinkedInMessage failed for reply: ${errMsg}`)
        return { success: false, error: `Failed to send reply: ${errMsg}` }
      }

      addToThread(leadId, 'reply_sent', 'self', message.trim())
      getDb()
        .prepare(`UPDATE leads SET last_contacted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
        .run(leadId)

      log.info('ipc/lead', `Reply sent for lead ${leadId} — stage stays replied`)
      return { success: true }
    }
  )

  ipcMain.handle(IPC.LEAD_MARK_CONVERTED, (_event, { leadId }: { leadId: number }) => {
    const lead = getLeadById(leadId)
    if (!lead) {
      return { success: false, error: `Lead with id ${leadId} not found.` }
    }
    if (lead.stage !== 'replied') {
      return { success: false, error: `Lead ${leadId} is not in replied stage (current stage: ${lead.stage}).` }
    }

    transitionStage(leadId, 'replied', 'converted', 'user')
    getDb()
      .prepare(`UPDATE leads SET closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(leadId)

    log.info('ipc/lead', `Lead ${leadId} marked as converted`)
    return { success: true }
  })

  ipcMain.handle(
    IPC.LEAD_UPDATE_REPLIED,
    async (_event, { leadId }: { leadId: number }) => {
      const lead = getLeadById(leadId)
      if (!lead) {
        return { success: false, error: `Lead with id ${leadId} not found.` }
      }

      const linkedinUrl = getProfileLinkedInUrl(lead.profile_id)
      if (!linkedinUrl) {
        return { success: false, error: `Profile for lead ${leadId} not found.` }
      }

      // Capture stored messages before the scrape overwrites linkedin_messages.
      const db = getDb()
      const storedMessages = db
        .prepare<number[], { sender: string; text: string }>(
          'SELECT sender, text FROM linkedin_messages WHERE profile_id = ? ORDER BY sort_order ASC'
        )
        .all(lead.profile_id) as { sender: string; text: string }[]

      const storedKeys = new Set<string>(storedMessages.map((m) => `${m.sender}::${m.text}`))

      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        log.setLogForwarder((level, component, message, timestamp) => {
          if (!win.isDestroyed()) {
            win.webContents.send(IPC.SCRAPE_LOG, { level, component, message, timestamp })
          }
        })
      }

      try {
        const scrapeResult = await runScrape(linkedinUrl)
        if ('error' in scrapeResult) return scrapeResult

        // Read fresh messages after the scrape has updated linkedin_messages.
        const freshMessages = db
          .prepare<number[], { sender: string; text: string }>(
            'SELECT sender, text FROM linkedin_messages WHERE profile_id = ? ORDER BY sort_order ASC'
          )
          .all(lead.profile_id) as { sender: string; text: string }[]

        const newReplies = freshMessages.filter(
          (m) => m.sender !== 'self' && !storedKeys.has(`${m.sender}::${m.text}`)
        )

        for (const reply of newReplies) {
          addToThread(leadId, 'reply_received', 'them', reply.text)
        }

        if (newReplies.length > 0) {
          log.info('ipc/lead', `${newReplies.length} new message(s) added to thread for lead ${leadId}`)
        }

        const conversationThread = getConversationThread(leadId)

        return {
          newMessagesFound: newReplies.length > 0,
          newMessageCount: newReplies.length,
          conversationThread,
        }
      } finally {
        log.clearLogForwarder()
      }
    }
  )

  ipcMain.handle(IPC.LEAD_REOPEN, async (_event, { leadId }: { leadId: number }) => {
    const lead = getLeadById(leadId)
    if (!lead) {
      return { success: false, error: `Lead with id ${leadId} not found.` }
    }
    if (lead.stage !== 'cold') {
      return { success: false, error: 'Only cold leads can be reopened. Converted is a terminal state.' }
    }

    const linkedinUrl = getProfileLinkedInUrl(lead.profile_id)
    if (!linkedinUrl) {
      return { success: false, error: `Profile for lead ${leadId} not found.` }
    }

    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      log.setLogForwarder((level, component, message, timestamp) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.SCRAPE_LOG, { level, component, message, timestamp })
        }
      })
    }

    try {
      // Step 1: Re-scrape the profile to get fresh data.
      const scrapeResult = await runScrape(linkedinUrl)
      if ('error' in scrapeResult) return scrapeResult

      // Step 2: Fetch context for LLM.
      const profileResult = getFullProfileData(linkedinUrl)
      if (!profileResult) {
        return { success: false, error: `No profile data found after scrape for URL: ${linkedinUrl}` }
      }

      const senderConfig = getSenderConfig()
      if (!senderConfig) {
        return { success: false, error: 'Sender configuration not found. Please set up your profile in Settings.' }
      }

      const priorThread = getConversationThread(leadId)

      // Step 3: Generate re-engagement message.
      let reEngagementMessage: string
      try {
        log.info('ipc/lead', `Generating re-engagement message for lead ${leadId}`)
        reEngagementMessage = await generateReEngagement(profileResult.profileData, senderConfig, priorThread, lead.conversation_type ?? undefined, lead.strategic_goal ?? undefined, lead.conversation_initiator ?? undefined, lead.persona ?? undefined)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error('ipc/lead', `Re-engagement LLM call failed: ${message}`)
        return { success: false, error: `Re-engagement generation failed: ${message}` }
      }

      // Step 4: Transition stage and reset all follow-up tracking fields.
      transitionStage(leadId, 'cold', 'draft', 'user')

      getDb()
        .prepare(
          `UPDATE leads SET
            initial_message   = ?,
            closed_at         = NULL,
            follow_up_count   = 0,
            next_follow_up_at = NULL,
            initial_sent_at   = NULL,
            last_contacted_at = NULL,
            replied_at        = NULL,
            updated_at        = datetime('now')
          WHERE id = ?`
        )
        .run(reEngagementMessage, leadId)

      addToThread(leadId, 'initial', 'self', reEngagementMessage)

      log.info('ipc/lead', `Lead ${leadId} reopened and transitioned to draft`)
      return { success: true, leadId, newMessage: reEngagementMessage }
    } finally {
      log.clearLogForwarder()
    }
  })
}

async function regenerateLeadDraft(
  leadId: number,
  customInstruction?: string,
): Promise<import('../../src/backend/lead-service.js').LeadWithProfile | { success: false; error: string }> {
  const lead = getLeadById(leadId)
  if (!lead) {
    return { success: false, error: `Lead with id ${leadId} not found.` }
  }

  const linkedinUrl = getProfileLinkedInUrl(lead.profile_id)
  if (!linkedinUrl) {
    return { success: false, error: `Profile for lead ${leadId} not found.` }
  }

  const profileResult = getFullProfileData(linkedinUrl)
  if (!profileResult) {
    return { success: false, error: `No stored profile data found for URL: ${linkedinUrl}` }
  }

  const senderConfig = getSenderConfig()
  if (!senderConfig) {
    return { success: false, error: 'Sender configuration not found. Please set up your profile in Settings.' }
  }

  let rawSummary: string
  try {
    log.info('ipc/lead', `Regenerating draft for lead ${leadId}${customInstruction ? ' (with instruction)' : ''}`)
    rawSummary = await summarizeProfile(profileResult.profileData, senderConfig, customInstruction)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('ipc/lead', `LLM call failed during regeneration: ${message}`)
    return { success: false, error: `Outreach regeneration failed: ${message}` }
  }

  const outreach = correctConversationType(parseOutreachResponse(rawSummary), profileResult.profileData.messages)

  getDb()
    .prepare(
      `UPDATE leads SET initial_message = ?, outreach_angle = ?, conversation_type = ?, strategic_goal = ?, conversation_initiator = ?, persona = ?, message_state = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .run(outreach.message, outreach.outreachAngle || null, outreach.conversationType || null, outreach.strategicGoal || null, outreach.conversationInitiator || null, outreach.persona || null, outreach.messageState || null, leadId)

  getDb()
    .prepare(
      `UPDATE outreach_thread SET message = ? WHERE lead_id = ? AND message_type = 'initial'`
    )
    .run(outreach.message, leadId)

  log.info('ipc/lead', `Draft regenerated for lead ${leadId}`)

  const updated = getLeadWithProfileById(leadId)
  if (!updated) {
    return { success: false, error: `Lead ${leadId} not found after regeneration.` }
  }
  return updated
}

type ScrapeResult =
  | { profileId: number; profileData: import('../../src/backend/types.js').ProfileData }
  | { success: false; error: string; needsLogin?: boolean }

async function runScrape(trimmedUrl: string): Promise<ScrapeResult> {
  let profiles: import('../../src/backend/types.js').ProfileData[]
  try {
    profiles = await scrapeProfiles([trimmedUrl])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === 'SESSION_EXPIRED') {
      deleteCookies()
      log.error('ipc/lead', 'LinkedIn session expired; cookies deleted')
      return { success: false, needsLogin: true, error: 'Your LinkedIn session has expired. Please log in again.' }
    }
    log.error('ipc/lead', `Scrape failed: ${message}`)
    return { success: false, error: `Scraping failed: ${message}` }
  }

  const profile = profiles[0]
  if (!profile) {
    return { success: false, error: 'Scraper returned no data for the provided URL.' }
  }

  let profileId: number
  try {
    profileId = upsertProfile(profile)
    log.info('ipc/lead', `Profile saved to DB with id: ${profileId}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('ipc/lead', `DB upsert failed: ${message}`)
    return { success: false, error: `Failed to save profile to database: ${message}` }
  }

  return { profileId, profileData: profile }
}
