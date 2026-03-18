import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../src/shared/ipc-channels'
import { cookiesExist, deleteCookies } from '../../src/backend/auth'
import { scrapeProfiles } from '../../src/backend/scraper'
import { summarizeProfile, parseOutreachResponse } from '../../src/backend/summarizer'
import { upsertProfile, getFullProfileData, getSenderConfig } from '../../src/backend/db'
import type { SenderConfig } from '../../src/backend/db'
import * as log from '../../src/backend/logger'
import { enqueue, registerJobHandler } from '../queue'

// Step definitions in the order they execute for a fresh scrape
const SCRAPE_STEPS: Array<{ stepId: string; label: string }> = [
  { stepId: 'load-profile',                label: 'Loading profile page' },
  { stepId: 'extract-about',               label: 'Extracting about section' },
  { stepId: 'extract-experience-education', label: 'Extracting experience & education' },
  { stepId: 'read-recommendations',        label: 'Reading recommendations' },
  { stepId: 'scrape-messages',             label: 'Scraping message history' },
  { stepId: 'analyze-posts',              label: 'Analyzing recent posts' },
  { stepId: 'save-lead',                   label: 'Saving profile to database' },
  { stepId: 'generate-draft',              label: 'Generating outreach draft' },
]

function makeEmitStep(win: BrowserWindow, jobId?: string) {
  const stepTimestamps: Record<string, number> = {}

  return function emitStep(
    stepId: string,
    status: 'pending' | 'active' | 'completed' | 'failed' | 'skipped',
    detail?: string,
    error?: string
  ) {
    if (win.isDestroyed()) return

    const stepDef = SCRAPE_STEPS.find(s => s.stepId === stepId)
    const label = stepDef?.label ?? stepId
    const now = Date.now()

    let startedAt: number | undefined
    let completedAt: number | undefined

    if (status === 'active') {
      stepTimestamps[stepId] = now
      startedAt = now
    } else if (status === 'completed' || status === 'failed' || status === 'skipped') {
      startedAt = stepTimestamps[stepId]
      completedAt = now
    }

    const step = { stepId, label, status, detail, error, startedAt, completedAt, jobId }
    win.webContents.send(IPC.SCRAPE_ACTIVITY, step)
  }
}

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

type SingleUrlResult =
  | {
      success: true
      cached: boolean
      cachedAt?: string
      profile: { id: number; url: string; name: string | null; headline: string | null; location: string | null }
      outreach: {
        id: number
        role: string
        company: string
        seniority: string
        persona: string
        messageState: string
        conversationInitiator: string
        conversationType: string
        conversationStatus: string
        strategicGoal: string
        leverageValue: string
        outreachAngle: string
        message: string
      }
    }
  | { error: true; needsLogin?: boolean; message: string }

type EmitStep = ReturnType<typeof makeEmitStep>

async function processSingleUrl(
  trimmedUrl: string,
  forceScrape: boolean,
  senderConfig: SenderConfig,
  emitStep?: EmitStep
): Promise<SingleUrlResult> {
  // Emit all steps as pending upfront so the UI shows the full list immediately.
  if (emitStep) {
    for (const step of SCRAPE_STEPS) {
      emitStep(step.stepId, 'pending')
    }
  }

  // Check whether a fresh-enough cached profile exists (unless force scrape requested).
  if (!forceScrape) {
    const cached = getFullProfileData(trimmedUrl)
    if (cached) {
      const ageMs = Date.now() - new Date(cached.lastScrapedAt).getTime()
      if (ageMs < CACHE_TTL_MS) {
        log.info('ipc/scrape', `Using cached profile for: ${trimmedUrl} (scraped ${Math.round(ageMs / 3600000)}h ago)`)

        // Cached path: skip all scrape steps, only run draft generation.
        if (emitStep) {
          const scrapeStepIds = ['load-profile', 'extract-about', 'extract-experience-education', 'read-recommendations', 'scrape-messages', 'analyze-posts']
          for (const stepId of scrapeStepIds) {
            emitStep(stepId, 'skipped', 'Using cached profile data')
          }
        }

        emitStep?.('generate-draft', 'active')
        let rawSummary: string
        try {
          rawSummary = await summarizeProfile(cached.profileData, senderConfig)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          log.error('ipc/scrape', `LLM call failed (cached path): ${message}`)
          emitStep?.('generate-draft', 'failed', undefined, message)
          return { error: true, message: `Outreach generation failed: ${message}` }
        }
        emitStep?.('generate-draft', 'completed')
        emitStep?.('save-lead', 'skipped', 'Profile already in database')

        const outreach = parseOutreachResponse(rawSummary)

        return {
          success: true,
          cached: true,
          cachedAt: cached.lastScrapedAt,
          profile: {
            id: cached.profileId,
            url: cached.profileData.url,
            name: cached.profileData.name,
            headline: cached.profileData.headline,
            location: cached.profileData.location,
          },
          outreach: {
            id: 0,
            role: outreach.role,
            company: outreach.company,
            seniority: outreach.seniority,
            persona: outreach.persona,
            messageState: outreach.messageState,
            conversationInitiator: outreach.conversationInitiator,
            conversationType: outreach.conversationType,
            conversationStatus: outreach.conversationStatus,
            strategicGoal: outreach.strategicGoal,
            leverageValue: outreach.leverageValue,
            outreachAngle: outreach.outreachAngle,
            message: outreach.message,
          },
        }
      }
    }
  }

  log.info('ipc/scrape', `Starting scrape for URL: ${trimmedUrl}`)

  let profiles
  try {
    profiles = await scrapeProfiles([trimmedUrl], emitStep
      ? (stepId, status, detail) => emitStep(stepId, status, detail)
      : undefined
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message === 'SESSION_EXPIRED') {
      deleteCookies()
      log.error('ipc/scrape', 'LinkedIn session expired; cookies deleted')
      return { error: true, needsLogin: true, message: 'Your LinkedIn session has expired. Please log in again.' }
    }
    log.error('ipc/scrape', `Scrape failed: ${message}`)
    return { error: true, message: `Scraping failed: ${message}` }
  }

  const profile = profiles[0]
  if (!profile) {
    return { error: true, message: 'Scraper returned no data for the provided URL.' }
  }

  let profileId: number
  emitStep?.('save-lead', 'active')
  try {
    profileId = upsertProfile(profile)
    log.info('ipc/scrape', `Profile saved to DB with id: ${profileId}`)
    emitStep?.('save-lead', 'completed')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('ipc/scrape', `DB upsert failed: ${message}`)
    emitStep?.('save-lead', 'failed', undefined, message)
    return { error: true, message: `Failed to save profile to database: ${message}` }
  }

  let rawSummary: string
  emitStep?.('generate-draft', 'active')
  try {
    log.info('ipc/scrape', `Generating outreach message for: ${profile.name ?? trimmedUrl}`)
    rawSummary = await summarizeProfile(profile, senderConfig)
    emitStep?.('generate-draft', 'completed')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('ipc/scrape', `LLM call failed: ${message}`)
    emitStep?.('generate-draft', 'failed', undefined, message)
    return { error: true, message: `Outreach generation failed: ${message}` }
  }

  const outreach = parseOutreachResponse(rawSummary)

  return {
    success: true,
    cached: false,
    profile: {
      id: profileId,
      url: profile.url,
      name: profile.name,
      headline: profile.headline,
      location: profile.location,
    },
    outreach: {
      id: 0,
      role: outreach.role,
      company: outreach.company,
      seniority: outreach.seniority,
      persona: outreach.persona,
      messageState: outreach.messageState,
      conversationInitiator: outreach.conversationInitiator,
      conversationType: outreach.conversationType,
      conversationStatus: outreach.conversationStatus,
      strategicGoal: outreach.strategicGoal,
      leverageValue: outreach.leverageValue,
      outreachAngle: outreach.outreachAngle,
      message: outreach.message,
    },
  }
}

// Register the scrape-profile job handler with the queue executor.
// Called for both single and bulk scrape jobs.
registerJobHandler('scrape-profile', async (payload, jobId) => {
  const url = payload.url as string
  const forceScrape = payload.forceScrape as boolean
  const senderConfig = payload.senderConfig as SenderConfig

  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    log.setLogForwarder((level, component, message, timestamp) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.SCRAPE_LOG, { level, component, message, timestamp })
      }
    })
  }

  const emitStep = win ? makeEmitStep(win, jobId) : undefined

  try {
    return await processSingleUrl(url, forceScrape, senderConfig, emitStep)
  } finally {
    log.clearLogForwarder()
  }
})

export function registerScrapeHandlers(): void {
  ipcMain.handle(IPC.SCRAPE_RUN, async (_event, { url, forceScrape }: { url?: string; forceScrape?: boolean }) => {
    if (!url || typeof url !== 'string' || url.trim() === '') {
      return { error: true, message: "Request body must include a non-empty 'url' field." }
    }

    const trimmedUrl = url.trim()

    if (!isLinkedInProfileUrl(trimmedUrl)) {
      return {
        error: true,
        message: "The 'url' field must be a valid LinkedIn profile URL (e.g. https://www.linkedin.com/in/username/).",
      }
    }

    if (!cookiesExist()) {
      return {
        error: true,
        needsLogin: true,
        message: "No LinkedIn session found. Please log in to continue.",
      }
    }

    log.init()

    const senderConfig = getSenderConfig()
    if (!senderConfig) {
      return { error: true, message: 'Sender configuration not found. Please set up your profile in Settings.' }
    }

    try {
      const enqueued = enqueue(
        'scrape-profile',
        { url: trimmedUrl, forceScrape: forceScrape ?? false, senderConfig },
        { waitForResult: true }
      ) as { jobId: string; result: Promise<unknown> }
      return await enqueued.result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('ipc/scrape', `scrape-profile job failed: ${message}`)
      return { error: true, message }
    }
  })
}

export function registerBulkScrapeHandlers(): void {
  ipcMain.handle(
    IPC.SCRAPE_BULK_RUN,
    async (_event, { urls, forceScrape }: { urls?: string[]; forceScrape?: boolean }) => {
      if (!Array.isArray(urls) || urls.length === 0) {
        return { error: true, message: 'urls must be a non-empty array.' }
      }

      if (!cookiesExist()) {
        return {
          error: true,
          needsLogin: true,
          message: 'No LinkedIn session found. Please log in to continue.',
        }
      }

      // Deduplicate and validate URLs upfront.
      const seen = new Set<string>()
      const validUrls: string[] = []
      const invalidUrls: string[] = []

      for (const raw of urls) {
        const trimmed = typeof raw === 'string' ? raw.trim() : ''
        if (!trimmed) continue
        if (seen.has(trimmed)) continue
        seen.add(trimmed)
        if (isLinkedInProfileUrl(trimmed)) {
          validUrls.push(trimmed)
        } else {
          invalidUrls.push(trimmed)
        }
      }

      if (validUrls.length === 0) {
        return { error: true, message: 'No valid LinkedIn profile URLs found in the provided list.' }
      }

      log.init()

      const senderConfig = getSenderConfig()
      if (!senderConfig) {
        return { error: true, message: 'Sender configuration not found. Please set up your profile in Settings.' }
      }

      for (const url of validUrls) {
        enqueue('scrape-profile', { url, forceScrape: forceScrape ?? false, senderConfig })
      }

      return { success: true, enqueued: validUrls.length, invalidUrls }
    }
  )
}
