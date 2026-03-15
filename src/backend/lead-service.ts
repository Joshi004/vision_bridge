import { getDb } from "./db.js";

export interface LeadRow {
  id: number;
  profile_id: number;
  stage: string;
  initial_message: string | null;
  outreach_angle: string | null;
  role: string | null;
  company: string | null;
  conversation_type: string | null;
  strategic_goal: string | null;
  conversation_initiator: string | null;
  persona: string | null;
  message_state: string | null;
  follow_up_count: number;
  max_follow_ups: number;
  initial_sent_at: string | null;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  replied_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Cumulative day offsets from initial_sent_at: index 0 = FU1, 1 = FU2, 2 = FU3
const FOLLOW_UP_CADENCE_DAYS = [3, 10, 25] as const;
const AUTO_COLD_DAY = 40;
const AUTO_COLD_DAYS_AFTER_LAST_CONTACT = 15;

export interface OutreachThreadRow {
  id: number;
  lead_id: number;
  message_type: string;
  sender: string;
  message: string;
  sent_at: string | null;
  created_at: string;
}

export interface StageHistoryRow {
  id: number;
  lead_id: number;
  from_stage: string | null;
  to_stage: string;
  transitioned_at: string;
  trigger: string;
}

/**
 * Create a new lead for the given profile and record the initial stage
 * transition in stage_history. Both writes happen atomically.
 * Returns the new lead's id.
 */
export function createLead(profileId: number, stage: string): number {
  const db = getDb();

  const fn = db.transaction((): number => {
    const leadResult = db
      .prepare("INSERT INTO leads (profile_id, stage) VALUES (?, ?)")
      .run(profileId, stage);

    const leadId = leadResult.lastInsertRowid as number;

    db.prepare(`
      INSERT INTO stage_history (lead_id, from_stage, to_stage, trigger)
      VALUES (?, NULL, ?, 'system')
    `).run(leadId, stage);

    return leadId;
  });

  return fn() as number;
}

/**
 * Look up a lead by the associated profile_id.
 * Returns the lead row or undefined if no lead exists for that profile.
 */
export function getLeadByProfileId(profileId: number): LeadRow | undefined {
  const db = getDb();
  return db
    .prepare<number[], LeadRow>("SELECT * FROM leads WHERE profile_id = ?")
    .get(profileId) as LeadRow | undefined;
}

/**
 * Fetch all leads in the given pipeline stage, ordered most-recently-created first.
 */
export function getLeadsByStage(stage: string): LeadRow[] {
  const db = getDb();
  return db
    .prepare<string[], LeadRow>(
      "SELECT * FROM leads WHERE stage = ? ORDER BY created_at DESC"
    )
    .all(stage) as LeadRow[];
}

/**
 * Move a lead to a new stage and append a record to stage_history.
 * Both writes happen atomically.
 */
export function transitionStage(
  leadId: number,
  fromStage: string,
  toStage: string,
  trigger: string,
): void {
  const db = getDb();

  const fn = db.transaction((): void => {
    db.prepare(`
      UPDATE leads SET stage = ?, updated_at = datetime('now') WHERE id = ?
    `).run(toStage, leadId);

    db.prepare(`
      INSERT INTO stage_history (lead_id, from_stage, to_stage, trigger)
      VALUES (?, ?, ?, ?)
    `).run(leadId, fromStage, toStage, trigger);
  });

  fn();
}

/**
 * Append a message to the outreach thread for a lead.
 * Returns the new outreach_thread row id.
 */
export function addToThread(
  leadId: number,
  messageType: string,
  sender: string,
  message: string,
): number {
  const db = getDb();

  const result = db.prepare(`
    INSERT INTO outreach_thread (lead_id, message_type, sender, message, sent_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(leadId, messageType, sender, message);

  return result.lastInsertRowid as number;
}

export interface LeadWithProfile {
  id: number;
  profile_id: number;
  stage: string;
  initial_message: string | null;
  outreach_angle: string | null;
  role: string | null;
  company: string | null;
  conversation_type: string | null;
  persona: string | null;
  message_state: string | null;
  follow_up_count: number;
  max_follow_ups: number;
  initial_sent_at: string | null;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  profile: {
    name: string | null;
    headline: string | null;
    linkedin_url: string;
  };
  recentMessages: { sender: string; content: string; timestamp: string | null }[];
}

/**
 * Fetch all leads in the given pipeline stage, enriched with profile data and
 * the 4 most recent LinkedIn messages for each lead's profile.
 */
export function getLeadsWithProfileByStage(stage: string): LeadWithProfile[] {
  const db = getDb();

  type LeadJoinRow = {
    id: number;
    profile_id: number;
    stage: string;
    initial_message: string | null;
    outreach_angle: string | null;
    role: string | null;
    company: string | null;
    conversation_type: string | null;
    persona: string | null;
    message_state: string | null;
    follow_up_count: number;
    max_follow_ups: number;
    initial_sent_at: string | null;
    last_contacted_at: string | null;
    next_follow_up_at: string | null;
    closed_at: string | null;
    created_at: string;
    updated_at: string;
    name: string | null;
    headline: string | null;
    linkedin_url: string;
  };

  const rows = db
    .prepare<string[], LeadJoinRow>(`
      SELECT
        l.id, l.profile_id, l.stage, l.initial_message, l.outreach_angle,
        l.role, l.company, l.conversation_type, l.persona, l.message_state,
        l.follow_up_count, l.max_follow_ups,
        l.initial_sent_at, l.last_contacted_at, l.next_follow_up_at,
        l.closed_at, l.created_at, l.updated_at,
        p.name, p.headline, p.linkedin_url
      FROM leads l
      JOIN profiles p ON l.profile_id = p.id
      WHERE l.stage = ?
      ORDER BY l.created_at DESC
    `)
    .all(stage) as LeadJoinRow[];

  if (rows.length === 0) return [];

  const profileIds = [...new Set(rows.map((r) => r.profile_id))];
  const placeholders = profileIds.map(() => "?").join(",");

  type MsgRow = { profile_id: number; sender: string; text: string; timestamp: string | null };

  const msgRows = db
    .prepare<number[], MsgRow>(`
      SELECT profile_id, sender, text, timestamp
      FROM (
        SELECT profile_id, sender, text, timestamp,
               ROW_NUMBER() OVER (PARTITION BY profile_id ORDER BY sort_order DESC) AS rn
        FROM linkedin_messages
        WHERE profile_id IN (${placeholders})
      )
      WHERE rn <= 4
      ORDER BY profile_id, rn DESC
    `)
    .all(...profileIds) as MsgRow[];

  const msgMap = new Map<number, { sender: string; content: string; timestamp: string | null }[]>();
  for (const m of msgRows) {
    const existing = msgMap.get(m.profile_id) ?? [];
    existing.push({ sender: m.sender, content: m.text, timestamp: m.timestamp });
    msgMap.set(m.profile_id, existing);
  }

  return rows.map((r) => ({
    id: r.id,
    profile_id: r.profile_id,
    stage: r.stage,
    initial_message: r.initial_message,
    outreach_angle: r.outreach_angle,
    role: r.role,
    company: r.company,
    conversation_type: r.conversation_type,
    persona: r.persona,
    message_state: r.message_state,
    follow_up_count: r.follow_up_count,
    max_follow_ups: r.max_follow_ups,
    initial_sent_at: r.initial_sent_at,
    last_contacted_at: r.last_contacted_at,
    next_follow_up_at: r.next_follow_up_at,
    closed_at: r.closed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    profile: { name: r.name, headline: r.headline, linkedin_url: r.linkedin_url },
    recentMessages: msgMap.get(r.profile_id) ?? [],
  }));
}

/**
 * Fetch a single lead by id, enriched with profile data and the 4 most recent
 * LinkedIn messages. Returns undefined if the lead does not exist.
 */
export function getLeadWithProfileById(leadId: number): LeadWithProfile | undefined {
  const db = getDb();

  type LeadJoinRow = {
    id: number;
    profile_id: number;
    stage: string;
    initial_message: string | null;
    outreach_angle: string | null;
    role: string | null;
    company: string | null;
    conversation_type: string | null;
    persona: string | null;
    message_state: string | null;
    follow_up_count: number;
    max_follow_ups: number;
    initial_sent_at: string | null;
    last_contacted_at: string | null;
    next_follow_up_at: string | null;
    closed_at: string | null;
    created_at: string;
    updated_at: string;
    name: string | null;
    headline: string | null;
    linkedin_url: string;
  };

  const row = db
    .prepare<number[], LeadJoinRow>(`
      SELECT
        l.id, l.profile_id, l.stage, l.initial_message, l.outreach_angle,
        l.role, l.company, l.conversation_type, l.persona, l.message_state,
        l.follow_up_count, l.max_follow_ups,
        l.initial_sent_at, l.last_contacted_at, l.next_follow_up_at,
        l.closed_at, l.created_at, l.updated_at,
        p.name, p.headline, p.linkedin_url
      FROM leads l
      JOIN profiles p ON l.profile_id = p.id
      WHERE l.id = ?
    `)
    .get(leadId) as LeadJoinRow | undefined;

  if (!row) return undefined;

  type MsgRow = { sender: string; text: string; timestamp: string | null };

  const msgRows = db
    .prepare<number[], MsgRow>(`
      SELECT sender, text, timestamp
      FROM (
        SELECT sender, text, timestamp,
               ROW_NUMBER() OVER (ORDER BY sort_order DESC) AS rn
        FROM linkedin_messages
        WHERE profile_id = ?
      )
      WHERE rn <= 4
      ORDER BY rn DESC
    `)
    .all(row.profile_id) as MsgRow[];

  return {
    id: row.id,
    profile_id: row.profile_id,
    stage: row.stage,
    initial_message: row.initial_message,
    outreach_angle: row.outreach_angle,
    role: row.role,
    company: row.company,
    conversation_type: row.conversation_type,
    persona: row.persona,
    message_state: row.message_state,
    follow_up_count: row.follow_up_count,
    max_follow_ups: row.max_follow_ups,
    initial_sent_at: row.initial_sent_at,
    last_contacted_at: row.last_contacted_at,
    next_follow_up_at: row.next_follow_up_at,
    closed_at: row.closed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    profile: { name: row.name, headline: row.headline, linkedin_url: row.linkedin_url },
    recentMessages: msgRows.map((m) => ({ sender: m.sender, content: m.text, timestamp: m.timestamp })),
  };
}

/**
 * Update a draft lead's initial_message text and keep the outreach_thread
 * initial entry in sync.
 */
export function updateLeadDraft(leadId: number, message: string): void {
  const db = getDb();

  db.transaction((): void => {
    db.prepare(`
      UPDATE leads SET initial_message = ?, updated_at = datetime('now') WHERE id = ?
    `).run(message, leadId);

    db.prepare(`
      UPDATE outreach_thread SET message = ? WHERE lead_id = ? AND message_type = 'initial'
    `).run(message, leadId);
  })();
}

/**
 * Delete a lead by id. CASCADE constraints handle outreach_thread and
 * stage_history cleanup automatically.
 */
export function deleteLead(leadId: number): void {
  const db = getDb();
  db.prepare("DELETE FROM leads WHERE id = ?").run(leadId);
}

/**
 * Fetch the full outreach thread for a lead in chronological order.
 */
export function getConversationThread(leadId: number): OutreachThreadRow[] {
  const db = getDb();
  return db
    .prepare<number[], OutreachThreadRow>(
      "SELECT * FROM outreach_thread WHERE lead_id = ? ORDER BY sent_at ASC"
    )
    .all(leadId) as OutreachThreadRow[];
}

/**
 * Look up a lead by its primary key id.
 * Returns the lead row or undefined if not found.
 */
export function getLeadById(leadId: number): LeadRow | undefined {
  const db = getDb();
  return db
    .prepare<number[], LeadRow>("SELECT * FROM leads WHERE id = ?")
    .get(leadId) as LeadRow | undefined;
}

/**
 * Return the linkedin_url for a profile by its internal id.
 * Returns undefined if the profile does not exist.
 */
export function getProfileLinkedInUrl(profileId: number): string | undefined {
  const db = getDb();
  const row = db
    .prepare<number[], { linkedin_url: string }>(
      "SELECT linkedin_url FROM profiles WHERE id = ?"
    )
    .get(profileId) as { linkedin_url: string } | undefined;
  return row?.linkedin_url;
}

/**
 * Returns the next follow-up message_type for a lead based on how many
 * follow-ups have already been sent. Returns null when all follow-ups are
 * exhausted (follow_up_count >= max_follow_ups or beyond the cadence schedule).
 */
export function getNextFollowUpType(lead: LeadRow): string | null {
  if (
    lead.follow_up_count >= lead.max_follow_ups ||
    lead.follow_up_count >= FOLLOW_UP_CADENCE_DAYS.length
  ) {
    return null;
  }

  const types = ["follow_up_1", "follow_up_2", "follow_up_3"] as const;
  return types[lead.follow_up_count] ?? null;
}

/**
 * Calculates the ISO date string when the next follow-up is due, based on
 * the lead's initial_sent_at and follow_up_count using the cadence schedule.
 * Returns null if initial_sent_at is missing or all follow-ups are exhausted.
 */
export function calculateNextFollowUpDate(lead: LeadRow): string | null {
  if (!lead.initial_sent_at) return null;
  if (
    lead.follow_up_count >= lead.max_follow_ups ||
    lead.follow_up_count >= FOLLOW_UP_CADENCE_DAYS.length
  ) {
    return null;
  }

  const daysOffset = FOLLOW_UP_CADENCE_DAYS[lead.follow_up_count];
  const base = new Date(lead.initial_sent_at);
  base.setDate(base.getDate() + daysOffset);
  return base.toISOString();
}

/**
 * Returns the count of contacted leads that have an overdue follow-up:
 * stage = 'contacted', next_follow_up_at is in the past, and follow-ups
 * are not yet exhausted.
 */
export function getOverdueFollowUpCount(): number {
  const db = getDb();
  const row = db
    .prepare<[], { count: number }>(`
      SELECT COUNT(*) AS count
      FROM leads
      WHERE stage = 'contacted'
        AND next_follow_up_at IS NOT NULL
        AND next_follow_up_at < datetime('now')
        AND follow_up_count < max_follow_ups
    `)
    .get() as { count: number };
  return row?.count ?? 0;
}

/**
 * Returns all contacted leads that have an overdue follow-up (same criteria
 * as getOverdueFollowUpCount but returns the full rows).
 */
export function getOverdueLeads(): LeadRow[] {
  const db = getDb();
  return db
    .prepare<[], LeadRow>(`
      SELECT *
      FROM leads
      WHERE stage = 'contacted'
        AND next_follow_up_at IS NOT NULL
        AND next_follow_up_at < datetime('now')
        AND follow_up_count < max_follow_ups
      ORDER BY next_follow_up_at ASC
    `)
    .all() as LeadRow[];
}

/**
 * Automatically transitions contacted leads to cold when their follow-up
 * cadence is fully exhausted and at least AUTO_COLD_DAYS_AFTER_LAST_CONTACT
 * days have passed since last_contacted_at. Uses 'auto_cadence' as the trigger.
 * Returns the number of leads transitioned.
 */
export function autoTransitionToCold(): number {
  const db = getDb();

  const rows = db
    .prepare<[number], { id: number }>(`
      SELECT id FROM leads
      WHERE stage = 'contacted'
        AND follow_up_count >= max_follow_ups
        AND last_contacted_at IS NOT NULL
        AND julianday('now') - julianday(last_contacted_at) >= ?
    `)
    .all(AUTO_COLD_DAYS_AFTER_LAST_CONTACT) as { id: number }[];

  let count = 0;
  const migrate = db.transaction(() => {
    for (const row of rows) {
      transitionStage(row.id, 'contacted', 'cold', 'auto_cadence');
      db.prepare(
        `UPDATE leads SET closed_at = datetime('now') WHERE id = ?`
      ).run(row.id);
      count++;
    }
  });
  migrate();

  console.log(`[auto-cold] Transitioned ${count} leads to cold`);
  return count;
}

/**
 * Records that a follow-up was sent for a lead. In a single atomic transaction:
 * - Increments follow_up_count by 1
 * - Sets last_contacted_at to now
 * - Computes and sets next_follow_up_at (or NULL if all follow-ups are sent)
 * - Updates updated_at to now
 *
 * Throws if the lead is not found.
 */
export function recordFollowUpSent(leadId: number): void {
  const db = getDb();

  db.transaction((): void => {
    const lead = db
      .prepare<number[], LeadRow>("SELECT * FROM leads WHERE id = ?")
      .get(leadId) as LeadRow | undefined;

    if (!lead) {
      throw new Error(`recordFollowUpSent: lead ${leadId} not found`);
    }

    const newFollowUpCount = lead.follow_up_count + 1;

    // Calculate the next follow-up date using the updated count so we look
    // up the correct cadence slot for the follow-up after this one.
    const nextDueDate = calculateNextFollowUpDate({
      ...lead,
      follow_up_count: newFollowUpCount,
    });

    db.prepare(`
      UPDATE leads SET
        follow_up_count   = ?,
        last_contacted_at = datetime('now'),
        next_follow_up_at = ?,
        updated_at        = datetime('now')
      WHERE id = ?
    `).run(newFollowUpCount, nextDueDate ?? null, leadId);
  })();
}
