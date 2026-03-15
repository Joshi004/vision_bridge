export {}

declare global {
  interface ScrapeLogEntry {
    level: 'INFO' | 'DEBUG' | 'ERROR'
    component: string
    message: string
    timestamp: string
  }

  type ScrapeLogHandler = (event: unknown, entry: ScrapeLogEntry) => void

  interface ScrapeProfileSummary {
    id: number
    url: string
    name: string | null
    headline: string | null
    location: string | null
  }

  interface ScrapeOutreachSummary {
    id: number
    role: string
    company: string
    seniority: string
    conversationInitiator: string
    conversationType: string
    conversationStatus: 'new' | 'continuation'
    strategicGoal: string
    leverageValue: string
    outreachAngle: string
    message: string
  }

  interface ScrapeSuccessResult {
    success: true
    cached: boolean
    cachedAt?: string
    profile: ScrapeProfileSummary
    outreach: ScrapeOutreachSummary
  }

  interface ErrorResult {
    error: true
    message: string
  }

  type ScrapeResult = ScrapeSuccessResult | ErrorResult

  interface SenderConfig {
    sender_name: string
    company_name: string
    company_description: string
    sender_role: string
    outreach_goal: string
    message_tone: string
    message_rules: string
    updated_at?: string
  }

  interface DuplicateCheckResult {
    exists: boolean
    lead?: {
      stage: string
      name: string
      company: string
    }
  }

  interface CreateLeadSuccess {
    success: true
    lead: {
      id: number
      name: string
      stage: string
    }
  }

  interface CreateLeadDuplicateResult {
    success: false
    duplicate: true
    lead?: {
      stage: string
      name: string
      company: string
    }
  }

  interface CreateLeadErrorResult {
    success: false
    duplicate?: false
    message: string
    needsLogin?: boolean
  }

  type CreateLeadFromScrapeResult = CreateLeadSuccess | CreateLeadDuplicateResult | CreateLeadErrorResult

  interface LeadRecentMessage {
    sender: string
    content: string
    timestamp: string | null
  }

  interface OutreachThreadMessage {
    id: number
    lead_id: number
    message_type: string
    sender: string
    message: string
    sent_at: string | null
    created_at: string
  }

  interface LeadWithProfile {
    id: number
    profile_id: number
    stage: string
    initial_message: string | null
    outreach_angle: string | null
    role: string | null
    company: string | null
    follow_up_count: number
    max_follow_ups: number
    initial_sent_at: string | null
    last_contacted_at: string | null
    next_follow_up_at: string | null
    closed_at: string | null
    created_at: string
    updated_at: string
    profile: {
      name: string | null
      headline: string | null
      linkedin_url: string
    }
    recentMessages: LeadRecentMessage[]
  }

  interface BulkProgressProfileSummary {
    id: number
    url: string
    name: string | null
    headline: string | null
    location: string | null
  }

  interface BulkProgressEventProcessing {
    type: 'processing'
    current: number
    total: number
    url: string
  }

  interface BulkProgressEventUrlDone {
    type: 'url-done'
    current: number
    total: number
    url: string
    profile: BulkProgressProfileSummary
  }

  interface BulkProgressEventUrlError {
    type: 'url-error'
    current: number
    total: number
    url: string
    error: string
  }

  interface BulkProgressEventCancelled {
    type: 'cancelled'
    current: number
    total: number
    cancelled: number
    needsLogin?: boolean
  }

  interface BulkProgressEventComplete {
    type: 'complete'
    total: number
    succeeded: number
    failed: number
    cancelled: number
    invalidUrls: string[]
  }

  type BulkProgressEvent =
    | BulkProgressEventProcessing
    | BulkProgressEventUrlDone
    | BulkProgressEventUrlError
    | BulkProgressEventCancelled
    | BulkProgressEventComplete

  interface BulkScrapeSuccess {
    success: true
    total: number
    succeeded: number
    failed: number
    cancelled: number
    invalidUrls: string[]
  }

  type BulkScrapeResult = BulkScrapeSuccess | (ErrorResult & { needsLogin?: boolean })

  type BulkProgressHandler = (event: unknown, data: BulkProgressEvent) => void

  interface Window {
    api: {
      scrape(url: string, forceScrape: boolean): Promise<ScrapeResult>
      scrapeBulk(urls: string[], forceScrape: boolean): Promise<BulkScrapeResult>
      cancelBulkScrape(): Promise<{ success: true }>
      login(): Promise<{ success: true } | ErrorResult>
      onScrapeLog(callback: (entry: ScrapeLogEntry) => void): ScrapeLogHandler
      offScrapeLog(handler: ScrapeLogHandler): void
      onBulkProgress(callback: (data: BulkProgressEvent) => void): BulkProgressHandler
      offBulkProgress(handler: BulkProgressHandler): void
      openLogsFolder(): Promise<void>
      getSenderConfig(): Promise<{ success: true; config: SenderConfig } | { error: true; message: string }>
      saveSenderConfig(fields: Partial<SenderConfig>): Promise<{ success: true; config: SenderConfig } | { error: true; message: string }>
      getPromptPreview(): Promise<{ success: true; prompt: string } | { error: true; message: string }>
      getPromptPreviewWithReferral(): Promise<{ success: true; prompt: string } | { error: true; message: string }>
      checkDuplicate(url: string): Promise<DuplicateCheckResult>
      createLeadFromScrape(url: string, forceScrape: boolean): Promise<CreateLeadFromScrapeResult>
      getLeadsByStage(stage: string): Promise<LeadWithProfile[]>
      updateLeadDraft(leadId: number, message: string): Promise<{ success: true }>
      deleteLead(leadId: number): Promise<{ success: true }>
      sendLead(leadId: number, message?: string): Promise<{ success: true } | { success: false; error: string; needsLogin?: boolean }>
      regenerateDraft(leadId: number): Promise<LeadWithProfile | { success: false; error: string }>
      regenerateDraftWithInstruction(leadId: number, instruction: string): Promise<LeadWithProfile | { success: false; error: string }>
      refreshLeadProfile(leadId: number): Promise<LeadWithProfile | { success: false; error: string }>
      refreshLeadBoth(leadId: number): Promise<LeadWithProfile | { success: false; error: string }>
      generateFollowUp(leadId: number): Promise<
        | { success: true; followUpNumber: number; followUpType: string; generatedMessage: string; priorMessages: OutreachThreadMessage[] }
        | { success: false; error: string }
      >
      sendFollowUp(leadId: number, message: string): Promise<{ success: true } | { success: false; error: string; needsLogin?: boolean }>
      checkForReplies(leadId: number): Promise<{ success: true; hasReply: boolean; replyContent?: { sender: string; text: string }[] } | { success: false; error: string }>
      checkAllReplies(): Promise<{ success: true; checked: number; repliesFound: number; errors: number }>
      markCold(leadId: number): Promise<{ success: true } | { success: false; error: string }>
      getOverdueCount(): Promise<{ success: true; count: number }>
      generateReply(leadId: number): Promise<
        | { generatedReply: string; conversationThread: OutreachThreadMessage[] }
        | { success: false; error: string }
      >
      sendReply(leadId: number, message: string): Promise<
        { success: true } | { success: false; error: string; needsLogin?: boolean }
      >
      markConverted(leadId: number): Promise<
        { success: true } | { success: false; error: string }
      >
      reopenLead(leadId: number): Promise<{
        success: boolean;
        leadId?: number;
        newMessage?: string;
        error?: string;
      }>
      updateRepliedLead(leadId: number): Promise<
        | { newMessagesFound: boolean; newMessageCount: number; conversationThread: OutreachThreadMessage[] }
        | { success: false; error: string }
      >
    }
  }
}
