import { getDb } from './db.js';
import { createLead, addToThread } from './lead-service.js';

interface OutreachMessageRow {
  id: number;
  profile_id: number;
  role: string | null;
  company: string | null;
  outreach_angle: string | null;
  message: string;
  status: 'draft' | 'sent' | 'replied' | 'ignored';
  sent_at: string | null;
  created_at: string;
}

function mapStatusToStage(status: string): string {
  switch (status) {
    case 'draft':    return 'draft';
    case 'sent':     return 'contacted';
    case 'replied':  return 'replied';
    case 'ignored':  return 'cold';
    default:         return 'draft';
  }
}

export function migrateOutreachToLeads(): void {
  const db = getDb();

  const leadsCount = (db
    .prepare('SELECT COUNT(*) AS count FROM leads')
    .get() as { count: number }).count;

  if (leadsCount > 0) {
    console.log('[migration] Migration skipped — leads table already has data');
    return;
  }

  const outreachCount = (db
    .prepare('SELECT COUNT(*) AS count FROM outreach_messages')
    .get() as { count: number }).count;

  if (outreachCount === 0) {
    console.log('[migration] Migration skipped — no outreach data to migrate');
    return;
  }

  // Select the latest outreach_message per profile to avoid violating
  // the leads.profile_id UNIQUE constraint.
  const rows = db.prepare<[], OutreachMessageRow>(`
    SELECT om.id, om.profile_id, om.role, om.company, om.outreach_angle,
           om.message, om.status, om.sent_at, om.created_at
    FROM outreach_messages om
    INNER JOIN (
      SELECT profile_id, MAX(id) AS max_id
      FROM outreach_messages
      GROUP BY profile_id
    ) latest ON om.id = latest.max_id
  `).all() as OutreachMessageRow[];

  console.log(`[migration] Starting migration of ${rows.length} outreach record(s)...`);

  const migrate = db.transaction((): number => {
    let created = 0;

    for (const row of rows) {
      const stage = mapStatusToStage(row.status);
      const leadId = createLead(row.profile_id, stage);

      // Build the UPDATE for columns createLead doesn't set.
      if (row.status === 'sent') {
        db.prepare(`
          UPDATE leads SET
            initial_message   = ?,
            role              = ?,
            company           = ?,
            outreach_angle    = ?,
            initial_sent_at   = ?,
            last_contacted_at = ?,
            updated_at        = datetime('now')
          WHERE id = ?
        `).run(
          row.message,
          row.role,
          row.company,
          row.outreach_angle,
          row.sent_at,
          row.sent_at,
          leadId,
        );
      } else if (row.status === 'replied') {
        db.prepare(`
          UPDATE leads SET
            initial_message = ?,
            role            = ?,
            company         = ?,
            outreach_angle  = ?,
            initial_sent_at = ?,
            replied_at      = ?,
            updated_at      = datetime('now')
          WHERE id = ?
        `).run(
          row.message,
          row.role,
          row.company,
          row.outreach_angle,
          row.sent_at,       // may be null — that's fine
          row.created_at,    // approximation per spec
          leadId,
        );
      } else {
        // 'draft' and 'cold' (ignored) — only copy the base fields
        db.prepare(`
          UPDATE leads SET
            initial_message = ?,
            role            = ?,
            company         = ?,
            outreach_angle  = ?,
            updated_at      = datetime('now')
          WHERE id = ?
        `).run(
          row.message,
          row.role,
          row.company,
          row.outreach_angle,
          leadId,
        );
      }

      addToThread(leadId, 'initial', 'self', row.message);
      created += 1;
    }

    return created;
  });

  const count = migrate() as number;
  console.log(`[migration] Migration complete: ${count} leads created from outreach_messages`);
}
