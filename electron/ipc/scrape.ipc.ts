import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../src/shared/ipc-channels'
import { cookiesExist, deleteCookies } from '../../src/backend/auth'
import { scrapeProfiles } from '../../src/backend/scraper'
import { summarizeProfile, parseOutreachResponse } from '../../src/backend/summarizer'
import { upsertProfile, getFullProfileData, getSenderConfig } from '../../src/backend/db'
import type { SenderConfig } from '../../src/backend/db'
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

type SingleUrlResult =
  | {
      success: true
      cached: boolean
      cachedAt?: string
      profile: { id: number; url: string; name: string | null; headline: string | null; location: string | null }
      outreach: { id: number; role: string; company: string; seniority: string; conversationStatus: string; outreachAngle: string; message: string }
    }
  | { error: true; needsLogin?: boolean; message: string }

async function processSingleUrl(trimmedUrl: string, forceScrape: boolean, senderConfig: SenderConfig): Promise<SingleUrlResult> {
  // Check whether a fresh-enough cached profile exists (unless force scrape requested).
  if (!forceScrape) {
    const cached = getFullProfileData(trimmedUrl)
    if (cached) {
      const ageMs = Date.now() - new Date(cached.lastScrapedAt).getTime()
      if (ageMs < CACHE_TTL_MS) {
        log.info('ipc/scrape', `Using cached profile for: ${trimmedUrl} (scraped ${Math.round(ageMs / 3600000)}h ago)`)

        let rawSummary: string
        try {
          rawSummary = await summarizeProfile(cached.profileData, senderConfig)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          log.error('ipc/scrape', `LLM call failed (cached path): ${message}`)
          return { error: true, message: `Outreach generation failed: ${message}` }
        }

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
            conversationStatus: outreach.conversationStatus,
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
    profiles = await scrapeProfiles([trimmedUrl])
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
  try {
    profileId = upsertProfile(profile)
    log.info('ipc/scrape', `Profile saved to DB with id: ${profileId}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('ipc/scrape', `DB upsert failed: ${message}`)
    return { error: true, message: `Failed to save profile to database: ${message}` }
  }

  let rawSummary: string
  try {
    log.info('ipc/scrape', `Generating outreach message for: ${profile.name ?? trimmedUrl}`)
    rawSummary = await summarizeProfile(profile, senderConfig)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('ipc/scrape', `LLM call failed: ${message}`)
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
      conversationStatus: outreach.conversationStatus,
      outreachAngle: outreach.outreachAngle,
      message: outreach.message,
    },
  }
}

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

    // Set up real-time log forwarding to the renderer window.
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      log.setLogForwarder((level, component, message, timestamp) => {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.SCRAPE_LOG, { level, component, message, timestamp })
        }
      })
    }

    const senderConfig = getSenderConfig()
    if (!senderConfig) {
      return { error: true, message: 'Sender configuration not found. Please set up your profile in Settings.' }
    }

    try {
      return await processSingleUrl(trimmedUrl, forceScrape ?? false, senderConfig)
    } finally {
      log.clearLogForwarder()
    }
  })
}

// Cancellation flag shared between the bulk handler and the cancel handler.
let bulkCancelRequested = false

export function registerBulkScrapeHandlers(): void {
  ipcMain.handle(IPC.SCRAPE_BULK_CANCEL, async () => {
    bulkCancelRequested = true
    return { success: true }
  })

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

      const win = BrowserWindow.getAllWindows()[0]
      const sendProgress = (payload: object) => {
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC.SCRAPE_BULK_PROGRESS, payload)
        }
      }

      // Forward scrape logs to the renderer window during bulk processing.
      if (win) {
        log.setLogForwarder((level, component, message, timestamp) => {
          if (!win.isDestroyed()) {
            win.webContents.send(IPC.SCRAPE_LOG, { level, component, message, timestamp })
          }
        })
      }

      const senderConfig = getSenderConfig()
      if (!senderConfig) {
        return { error: true, message: 'Sender configuration not found. Please set up your profile in Settings.' }
      }

      bulkCancelRequested = false

      const total = validUrls.length
      let succeeded = 0
      let failed = 0
      let cancelled = 0

      try {
        for (let i = 0; i < validUrls.length; i++) {
          // Check cancellation before starting each URL.
          if (bulkCancelRequested) {
            cancelled = total - i
            sendProgress({ type: 'cancelled', current: i, total, cancelled })
            break
          }

          const url = validUrls[i]

          sendProgress({ type: 'processing', current: i, total, url })

          const result = await processSingleUrl(url, forceScrape ?? false, senderConfig)

          if ('error' in result) {
            failed++
            sendProgress({ type: 'url-error', current: i + 1, total, url, error: result.message })
            // If session expired, abort the batch.
            if ('needsLogin' in result && result.needsLogin) {
              cancelled = total - (i + 1)
              sendProgress({ type: 'cancelled', current: i + 1, total, cancelled, needsLogin: true })
              break
            }
          } else {
            succeeded++
            sendProgress({
              type: 'url-done',
              current: i + 1,
              total,
              url,
              profile: result.profile,
            })
          }
        }
      } finally {
        log.clearLogForwarder()
      }

      const summary = { total, succeeded, failed, cancelled, invalidUrls }
      sendProgress({ type: 'complete', ...summary })
      return { success: true, ...summary }
    }
  )
}
