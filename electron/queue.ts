import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { sendLinkedInMessage } from '../src/backend/sender'
import { deleteCookies } from '../src/backend/auth'
import {
  transitionStage,
  addToThread,
  recordFollowUpSent,
} from '../src/backend/lead-service'
import { getDb } from '../src/backend/db'
import * as log from '../src/backend/logger'

// ─── Types ────────────────────────────────────────────────────────────────────

export type JobType =
  | 'scrape-profile'
  | 'refresh-profile'
  | 'refresh-both'
  | 'check-replies'
  | 'send-initial'
  | 'send-followup'
  | 'send-reply'

export type QueueName = 'data' | 'action'
export type JobStatus = 'queued' | 'active' | 'completed' | 'failed' | 'cancelled'

export interface QueueItem {
  id: string
  queue: QueueName
  type: JobType
  payload: Record<string, unknown>
  status: JobStatus
  result?: unknown
  error?: string
  createdAt: number
  completedAt?: number
}

export interface QueueStatusSnapshot {
  dataQueue: QueueItem[]
  actionQueue: QueueItem[]
}

export interface QueueDrainedInfo {
  queue: QueueName
  completed: number
  failed: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DATA_JOB_TYPES: ReadonlySet<JobType> = new Set([
  'scrape-profile',
  'refresh-profile',
  'refresh-both',
  'check-replies',
])

const ACTION_JOB_TYPES: ReadonlySet<JobType> = new Set([
  'send-initial',
  'send-followup',
  'send-reply',
])

const MAX_QUEUE_SIZE = 100
const ACTION_DELAY_MIN_MS = 3000
const ACTION_DELAY_MAX_MS = 10000
const DATA_DELAY_MIN_MS = 1000
const DATA_DELAY_MAX_MS = 3000

// ─── Internal state ───────────────────────────────────────────────────────────

const dataQueue: QueueItem[] = []
const actionQueue: QueueItem[] = []

let processing = false

// Pending promises for wait-for-result callers, keyed by job ID
const pendingResolvers = new Map<string, { resolve: (result: unknown) => void; reject: (err: Error) => void }>()

// Job handler registry
type JobHandler = (payload: Record<string, unknown>) => Promise<unknown>
const jobHandlers = new Map<JobType, JobHandler>()

// ─── Public EventEmitter ──────────────────────────────────────────────────────

export const queueEvents = new EventEmitter()

// ─── Helper utilities ─────────────────────────────────────────────────────────

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getQueueForType(type: JobType): QueueName {
  if (DATA_JOB_TYPES.has(type)) return 'data'
  if (ACTION_JOB_TYPES.has(type)) return 'action'
  throw new Error(`Unknown job type: ${type}`)
}

function getArray(queue: QueueName): QueueItem[] {
  return queue === 'data' ? dataQueue : actionQueue
}

function emitStatusChange(item: QueueItem): void {
  queueEvents.emit('job-status-change', item)
}

// ─── Executor ─────────────────────────────────────────────────────────────────

async function processNext(): Promise<void> {
  if (processing) return

  // Pick next job: data queue has priority
  const nextItem =
    dataQueue.find((j) => j.status === 'queued') ??
    actionQueue.find((j) => j.status === 'queued')

  if (!nextItem) return

  processing = true
  const prevQueue: QueueName = nextItem.queue
  nextItem.status = 'active'
  emitStatusChange(nextItem)

  const handler = jobHandlers.get(nextItem.type)
  if (!handler) {
    nextItem.status = 'failed'
    nextItem.error = `No handler registered for job type: ${nextItem.type}`
    nextItem.completedAt = Date.now()
    emitStatusChange(nextItem)

    const pending = pendingResolvers.get(nextItem.id)
    if (pending) {
      pending.reject(new Error(nextItem.error))
      pendingResolvers.delete(nextItem.id)
    }
  } else {
    try {
      const result = await handler(nextItem.payload)
      nextItem.status = 'completed'
      nextItem.result = result
      nextItem.completedAt = Date.now()
      emitStatusChange(nextItem)

      const pending = pendingResolvers.get(nextItem.id)
      if (pending) {
        pending.resolve(result)
        pendingResolvers.delete(nextItem.id)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      nextItem.status = 'failed'
      nextItem.error = errorMessage
      nextItem.completedAt = Date.now()
      emitStatusChange(nextItem)

      const pending = pendingResolvers.get(nextItem.id)
      if (pending) {
        pending.reject(err instanceof Error ? err : new Error(errorMessage))
        pendingResolvers.delete(nextItem.id)
      }

      // Cancel all remaining jobs if the session expired
      if (errorMessage.includes('SESSION_EXPIRED')) {
        deleteCookies()
        cancelAll()
        queueEvents.emit('session-expired')
      }
    }
  }

  // Emit drain event if the queue that was just active is now empty of active/queued items
  const prevArray = getArray(prevQueue)
  const hasPending = prevArray.some((j) => j.status === 'queued' || j.status === 'active')
  if (!hasPending) {
    const completed = prevArray.filter((j) => j.status === 'completed').length
    const failed = prevArray.filter((j) => j.status === 'failed').length
    const drainInfo: QueueDrainedInfo = { queue: prevQueue, completed, failed }
    queueEvents.emit('queue-drained', drainInfo)
  }

  // Delay before picking up the next job
  processing = false
  const delayQueue: QueueName = nextItem.queue
  if (delayQueue === 'action') {
    await randomDelay(ACTION_DELAY_MIN_MS, ACTION_DELAY_MAX_MS)
  } else {
    await randomDelay(DATA_DELAY_MIN_MS, DATA_DELAY_MAX_MS)
  }

  processNext()
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a handler function for a job type.
 * The executor calls this function when processing a job of that type.
 */
export function registerJobHandler(type: JobType, handler: JobHandler): void {
  jobHandlers.set(type, handler)
}

/**
 * Enqueue a job. Returns the job ID immediately.
 * If waitForResult is true, also returns a Promise that resolves with the job result.
 */
export function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  options?: { waitForResult?: boolean }
): { jobId: string; result: Promise<unknown> } | { jobId: string } {
  const queue = getQueueForType(type)
  const arr = getArray(queue)

  if (arr.filter((j) => j.status === 'queued' || j.status === 'active').length >= MAX_QUEUE_SIZE) {
    throw new Error(`Queue is full (${MAX_QUEUE_SIZE} items). Wait for some to complete before adding more.`)
  }

  // Duplicate check: same leadId + same type already queued or active
  if (payload.leadId !== undefined) {
    const duplicate = arr.find(
      (j) =>
        j.type === type &&
        j.payload.leadId === payload.leadId &&
        (j.status === 'queued' || j.status === 'active')
    )
    if (duplicate) {
      throw new Error(`Duplicate job: leadId ${payload.leadId} with type "${type}" is already queued or active.`)
    }
  }

  const item: QueueItem = {
    id: randomUUID(),
    queue,
    type,
    payload,
    status: 'queued',
    createdAt: Date.now(),
  }

  arr.push(item)
  emitStatusChange(item)

  if (options?.waitForResult) {
    const resultPromise = new Promise<unknown>((resolve, reject) => {
      pendingResolvers.set(item.id, { resolve, reject })
    })
    processNext()
    return { jobId: item.id, result: resultPromise }
  }

  processNext()
  return { jobId: item.id }
}

/**
 * Cancel a single queued (not active) job by ID.
 */
export function cancelJob(jobId: string): boolean {
  const item = [...dataQueue, ...actionQueue].find((j) => j.id === jobId)
  if (!item || item.status !== 'queued') return false

  item.status = 'cancelled'
  item.completedAt = Date.now()
  emitStatusChange(item)

  const pending = pendingResolvers.get(jobId)
  if (pending) {
    pending.reject(new Error('Job cancelled'))
    pendingResolvers.delete(jobId)
  }

  return true
}

/**
 * Cancel all queued (not active) items. If queueName is provided, only that queue.
 */
export function cancelAll(queueName?: QueueName): void {
  const queues: QueueName[] = queueName ? [queueName] : ['data', 'action']

  for (const name of queues) {
    const arr = getArray(name)
    for (const item of arr) {
      if (item.status === 'queued') {
        item.status = 'cancelled'
        item.completedAt = Date.now()
        emitStatusChange(item)

        const pending = pendingResolvers.get(item.id)
        if (pending) {
          pending.reject(new Error('Job cancelled'))
          pendingResolvers.delete(item.id)
        }
      }
    }
  }
}

/**
 * Returns the current state of both queues.
 */
export function getQueueStatus(): QueueStatusSnapshot {
  return {
    dataQueue: [...dataQueue],
    actionQueue: [...actionQueue],
  }
}

/**
 * Re-enqueues a failed job with its original type and payload.
 * The failed job remains in the queue history; a new job is created.
 */
export function retryJob(jobId: string): { success: boolean; newJobId?: string; error?: string } {
  const allItems = [...dataQueue, ...actionQueue]
  const failedJob = allItems.find((item) => item.id === jobId && item.status === 'failed')
  if (!failedJob) {
    return { success: false, error: 'Job not found or not in failed state' }
  }
  try {
    const result = enqueue(failedJob.type, failedJob.payload)
    return { success: true, newJobId: result.jobId }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Send Job Handlers ────────────────────────────────────────────────────────

registerJobHandler('send-initial', async (payload) => {
  const leadId = payload.leadId as number
  const linkedinUrl = payload.linkedinUrl as string
  const messageText = payload.messageText as string

  await sendLinkedInMessage(linkedinUrl, messageText)

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

  log.info('queue', `Lead ${leadId} sent and transitioned to contacted`)
})

registerJobHandler('send-followup', async (payload) => {
  const leadId = payload.leadId as number
  const linkedinUrl = payload.linkedinUrl as string
  const messageText = payload.messageText as string
  const followUpType = payload.followUpType as string

  await sendLinkedInMessage(linkedinUrl, messageText)

  addToThread(leadId, followUpType, 'self', messageText)
  recordFollowUpSent(leadId)

  log.info('queue', `Follow-up (${followUpType}) sent for lead ${leadId}`)
})

registerJobHandler('send-reply', async (payload) => {
  const leadId = payload.leadId as number
  const linkedinUrl = payload.linkedinUrl as string
  const messageText = payload.messageText as string

  await sendLinkedInMessage(linkedinUrl, messageText)

  addToThread(leadId, 'reply_sent', 'self', messageText)
  getDb()
    .prepare(`UPDATE leads SET last_contacted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(leadId)

  log.info('queue', `Reply sent for lead ${leadId} — stage stays replied`)
})
