import Database from "better-sqlite3";
import fs from "fs";
import type { ProfileData } from "./types.js";
import { getDbDir, getDbPath } from "./paths.js";

let db: Database.Database | null = null;

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profiles (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    linkedin_url     TEXT    UNIQUE NOT NULL,
    name             TEXT,
    headline         TEXT,
    location         TEXT,
    about            TEXT,
    first_scraped_at TEXT    NOT NULL,
    last_scraped_at  TEXT    NOT NULL,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experiences (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title       TEXT,
    company     TEXT,
    date_range  TEXT,
    description TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS educations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    school      TEXT,
    degree      TEXT,
    date_range  TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recommendations (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id           INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    recommender_name     TEXT,
    recommender_headline TEXT,
    relationship         TEXT,
    text                 TEXT,
    sort_order           INTEGER NOT NULL DEFAULT 0,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS linkedin_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    sender      TEXT    NOT NULL CHECK(sender IN ('self', 'them')),
    text        TEXT    NOT NULL,
    timestamp   TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    scraped_at  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id      INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    text            TEXT,
    published_at    TEXT,
    reactions_count TEXT,
    comments_count  TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    scraped_at      TEXT    NOT NULL,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outreach_messages (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id          INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role                TEXT,
    company             TEXT,
    seniority           TEXT    CHECK(seniority IN ('decision_maker', 'mid_level', 'junior', 'recruiter', 'non_technical')),
    conversation_status TEXT    NOT NULL CHECK(conversation_status IN ('new', 'continuation')),
    outreach_angle      TEXT,
    message             TEXT    NOT NULL,
    status              TEXT    NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'replied', 'ignored')),
    sent_at             TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scrape_sessions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id     INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    scraped_at     TEXT    NOT NULL,
    success        INTEGER NOT NULL DEFAULT 1,
    sections_found TEXT,
    error_message  TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id        INTEGER UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    stage             TEXT    NOT NULL DEFAULT 'prospecting'
                      CHECK(stage IN ('prospecting','draft','contacted','replied','converted','cold')),
    initial_message   TEXT,
    outreach_angle    TEXT,
    role              TEXT,
    company           TEXT,
    follow_up_count   INTEGER NOT NULL DEFAULT 0,
    max_follow_ups    INTEGER NOT NULL DEFAULT 3,
    initial_sent_at   TEXT,
    last_contacted_at TEXT,
    next_follow_up_at TEXT,
    replied_at        TEXT,
    closed_at         TEXT,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outreach_thread (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id      INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    message_type TEXT    NOT NULL
                 CHECK(message_type IN ('initial','follow_up_1','follow_up_2','follow_up_3','reply_sent','reply_received')),
    sender       TEXT    NOT NULL CHECK(sender IN ('self','them')),
    message      TEXT    NOT NULL,
    sent_at      TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stage_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id         INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    from_stage      TEXT,
    to_stage        TEXT    NOT NULL,
    transitioned_at TEXT    NOT NULL DEFAULT (datetime('now')),
    trigger         TEXT    NOT NULL CHECK("trigger" IN ('user','system','auto_cadence'))
);

CREATE TABLE IF NOT EXISTS sender_config (
    id                  INTEGER PRIMARY KEY CHECK(id = 1),
    sender_name         TEXT    NOT NULL DEFAULT '',
    company_name        TEXT    NOT NULL DEFAULT '',
    company_description TEXT    NOT NULL DEFAULT '',
    sender_role         TEXT    NOT NULL DEFAULT '',
    outreach_goal       TEXT    NOT NULL DEFAULT '',
    message_tone        TEXT    NOT NULL DEFAULT '',
    message_rules       TEXT    NOT NULL DEFAULT '',
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_experiences_profile_id    ON experiences(profile_id);
CREATE INDEX IF NOT EXISTS idx_experiences_company       ON experiences(company);
CREATE INDEX IF NOT EXISTS idx_educations_profile_id     ON educations(profile_id);
CREATE INDEX IF NOT EXISTS idx_educations_school         ON educations(school);
CREATE INDEX IF NOT EXISTS idx_recommendations_profile_id ON recommendations(profile_id);
CREATE INDEX IF NOT EXISTS idx_linkedin_messages_profile_id ON linkedin_messages(profile_id);
CREATE INDEX IF NOT EXISTS idx_posts_profile_id          ON posts(profile_id);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_profile_id ON outreach_messages(profile_id);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_status  ON outreach_messages(status);
CREATE INDEX IF NOT EXISTS idx_outreach_messages_seniority ON outreach_messages(seniority);
CREATE INDEX IF NOT EXISTS idx_scrape_sessions_profile_id ON scrape_sessions(profile_id);
CREATE INDEX IF NOT EXISTS idx_leads_profile_id         ON leads(profile_id);
CREATE INDEX IF NOT EXISTS idx_leads_stage              ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_outreach_thread_lead_id  ON outreach_thread(lead_id);
CREATE INDEX IF NOT EXISTS idx_stage_history_lead_id    ON stage_history(lead_id);
`;

function seedSenderConfig(database: Database.Database): void {
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM sender_config")
    .get() as { count: number };

  if (row.count > 0) return;

  database.prepare(`
    INSERT INTO sender_config (id, sender_name, company_name, company_description, sender_role, outreach_goal, message_tone, message_rules)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "",
    "Techsergy",
    "A software delivery company that supports startups and product teams with backend and full-stack engineering capacity.",
    "I stay involved as the senior technical lead while delivery is handled through my team.",
    "Explore whether it makes sense to connect around potential collaboration in engineering.",
    "Friendly and natural. Sound like a real human, not a tool. No selling, no pricing, no 'book a call'.",
    "No em dashes, no bullet points, no headers. Reference something specific from their profile if genuine. Open a real conversation.",
  );
}

export function initDatabase(): void {
  if (db) return;

  const dbDir = getDbDir();
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(getDbPath());

  // Run schema statements one by one — better-sqlite3's exec() handles multi-statement SQL.
  db.exec(SCHEMA_SQL);
  seedSenderConfig(db);
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

interface ProfileRow {
  id: number;
  linkedin_url: string;
  name: string | null;
  headline: string | null;
  location: string | null;
  about: string | null;
  first_scraped_at: string;
  last_scraped_at: string;
  created_at: string;
  updated_at: string;
}

/**
 * Detect which sections had data so scrape_sessions.sections_found is useful.
 */
function buildSectionsFound(profile: ProfileData): string {
  const sections: string[] = ["header"];
  if (profile.about) sections.push("about");
  if (profile.experience.length > 0) sections.push("experience");
  if (profile.education.length > 0) sections.push("education");
  if (profile.recommendations.length > 0) sections.push("recommendations");
  if (profile.messages.length > 0) sections.push("messages");
  if (profile.posts.length > 0) sections.push("posts");
  return sections.join(",");
}

/**
 * Persist a scraped profile. Upserts the profiles row, replaces all child
 * records (experience, education, recommendations, messages, posts), and
 * logs a scrape_sessions row. outreach_messages are never touched here.
 *
 * Returns the internal profile_id.
 */
export function upsertProfile(profile: ProfileData): number {
  const database = getDb();

  const existing = database
    .prepare<string, ProfileRow>("SELECT id, first_scraped_at FROM profiles WHERE linkedin_url = ?")
    .get(profile.url) as ProfileRow | undefined;

  const now = new Date().toISOString();
  const scrapedAt = profile.scrapedAt ?? now;

  const upsertFn = database.transaction((): number => {
    let profileId: number;

    if (existing) {
      database.prepare(`
        UPDATE profiles SET
          name             = ?,
          headline         = ?,
          location         = ?,
          about            = ?,
          last_scraped_at  = ?,
          updated_at       = ?
        WHERE id = ?
      `).run(
        profile.name,
        profile.headline,
        profile.location,
        profile.about,
        scrapedAt,
        now,
        existing.id,
      );
      profileId = existing.id;

      // Delete stale child records so fresh data replaces them.
      for (const table of ["experiences", "educations", "recommendations", "linkedin_messages", "posts"]) {
        database.prepare(`DELETE FROM ${table} WHERE profile_id = ?`).run(profileId);
      }
    } else {
      const result = database.prepare(`
        INSERT INTO profiles (linkedin_url, name, headline, location, about, first_scraped_at, last_scraped_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        profile.url,
        profile.name,
        profile.headline,
        profile.location,
        profile.about,
        scrapedAt,
        scrapedAt,
        now,
        now,
      );
      profileId = result.lastInsertRowid as number;
    }

    // Insert experiences.
    const insertExp = database.prepare(`
      INSERT INTO experiences (profile_id, title, company, date_range, description, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < profile.experience.length; i++) {
      const e = profile.experience[i];
      insertExp.run(profileId, e.title, e.company, e.dateRange, e.description, i);
    }

    // Insert educations.
    const insertEdu = database.prepare(`
      INSERT INTO educations (profile_id, school, degree, date_range, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < profile.education.length; i++) {
      const e = profile.education[i];
      insertEdu.run(profileId, e.school, e.degree, e.dateRange, i);
    }

    // Insert recommendations.
    const insertRec = database.prepare(`
      INSERT INTO recommendations (profile_id, recommender_name, recommender_headline, relationship, text, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < profile.recommendations.length; i++) {
      const r = profile.recommendations[i];
      insertRec.run(profileId, r.recommenderName, r.recommenderHeadline, r.relationship, r.text, i);
    }

    // Insert messages.
    const insertMsg = database.prepare(`
      INSERT INTO linkedin_messages (profile_id, sender, text, timestamp, sort_order, scraped_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < profile.messages.length; i++) {
      const m = profile.messages[i];
      insertMsg.run(profileId, m.sender, m.text, m.timestamp, i, scrapedAt);
    }

    // Insert posts.
    const insertPost = database.prepare(`
      INSERT INTO posts (profile_id, text, published_at, reactions_count, comments_count, sort_order, scraped_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < profile.posts.length; i++) {
      const p = profile.posts[i];
      insertPost.run(profileId, p.text, p.publishedAt, p.reactionsCount, p.commentsCount, i, scrapedAt);
    }

    // Log the scrape session.
    database.prepare(`
      INSERT INTO scrape_sessions (profile_id, scraped_at, success, sections_found)
      VALUES (?, ?, 1, ?)
    `).run(profileId, scrapedAt, buildSectionsFound(profile));

    return profileId;
  });

  return upsertFn() as number;
}

/**
 * Look up a profile row by LinkedIn URL.
 * Returns the row (including its id) or undefined if not found.
 */
export function getProfileByUrl(url: string): ProfileRow | undefined {
  const database = getDb();
  return database
    .prepare<string, ProfileRow>("SELECT * FROM profiles WHERE linkedin_url = ?")
    .get(url) as ProfileRow | undefined;
}

/**
 * Load a complete ProfileData object from the database by LinkedIn URL.
 * Reconstructs the same shape the scraper returns, including all child records.
 * Returns { profileId, profileData } or undefined if the URL is not found.
 */
export function getFullProfileData(
  url: string,
): { profileId: number; profileData: ProfileData; lastScrapedAt: string } | undefined {
  const database = getDb();

  const row = database
    .prepare<string, ProfileRow>("SELECT * FROM profiles WHERE linkedin_url = ?")
    .get(url) as ProfileRow | undefined;

  if (!row) return undefined;

  const experiences = database
    .prepare<number[], { title: string | null; company: string | null; date_range: string | null; description: string | null }>(
      "SELECT title, company, date_range, description FROM experiences WHERE profile_id = ? ORDER BY sort_order ASC"
    )
    .all(row.id) as { title: string | null; company: string | null; date_range: string | null; description: string | null }[];

  const educations = database
    .prepare<number[], { school: string | null; degree: string | null; date_range: string | null }>(
      "SELECT school, degree, date_range FROM educations WHERE profile_id = ? ORDER BY sort_order ASC"
    )
    .all(row.id) as { school: string | null; degree: string | null; date_range: string | null }[];

  const recommendations = database
    .prepare<number[], { recommender_name: string | null; recommender_headline: string | null; relationship: string | null; text: string | null }>(
      "SELECT recommender_name, recommender_headline, relationship, text FROM recommendations WHERE profile_id = ? ORDER BY sort_order ASC"
    )
    .all(row.id) as { recommender_name: string | null; recommender_headline: string | null; relationship: string | null; text: string | null }[];

  const messages = database
    .prepare<number[], { sender: string; text: string; timestamp: string | null }>(
      "SELECT sender, text, timestamp FROM linkedin_messages WHERE profile_id = ? ORDER BY sort_order ASC"
    )
    .all(row.id) as { sender: string; text: string; timestamp: string | null }[];

  const posts = database
    .prepare<number[], { text: string | null; published_at: string | null; reactions_count: string | null; comments_count: string | null }>(
      "SELECT text, published_at, reactions_count, comments_count FROM posts WHERE profile_id = ? ORDER BY sort_order ASC"
    )
    .all(row.id) as { text: string | null; published_at: string | null; reactions_count: string | null; comments_count: string | null }[];

  const profileData: ProfileData = {
    url: row.linkedin_url,
    name: row.name,
    headline: row.headline,
    location: row.location,
    about: row.about,
    scrapedAt: row.last_scraped_at,
    experience: experiences.map((e) => ({
      title: e.title,
      company: e.company,
      dateRange: e.date_range,
      description: e.description,
    })),
    education: educations.map((e) => ({
      school: e.school,
      degree: e.degree,
      dateRange: e.date_range,
    })),
    recommendations: recommendations.map((r) => ({
      recommenderName: r.recommender_name,
      recommenderHeadline: r.recommender_headline,
      relationship: r.relationship,
      text: r.text,
    })),
    messages: messages.map((m) => ({
      sender: m.sender as "self" | "them",
      text: m.text,
      timestamp: m.timestamp,
    })),
    posts: posts.map((p) => ({
      text: p.text,
      publishedAt: p.published_at,
      reactionsCount: p.reactions_count,
      commentsCount: p.comments_count,
    })),
  };

  return { profileId: row.id, profileData, lastScrapedAt: row.last_scraped_at };
}

/**
 * Return all profile rows ordered by most recently scraped first.
 */
export function getAllProfiles(): ProfileRow[] {
  const database = getDb();
  return database
    .prepare("SELECT * FROM profiles ORDER BY last_scraped_at DESC")
    .all() as ProfileRow[];
}

export interface SenderConfig {
  id: number;
  sender_name: string;
  company_name: string;
  company_description: string;
  sender_role: string;
  outreach_goal: string;
  message_tone: string;
  message_rules: string;
  updated_at: string;
}

type SenderConfigFields = Omit<SenderConfig, 'id' | 'updated_at'>;

const ALLOWED_SENDER_CONFIG_FIELDS: ReadonlyArray<keyof SenderConfigFields> = [
  'sender_name',
  'company_name',
  'company_description',
  'sender_role',
  'outreach_goal',
  'message_tone',
  'message_rules',
];

/**
 * Return the single sender_config row (id = 1).
 */
export function getSenderConfig(): SenderConfig {
  const database = getDb();
  return database
    .prepare<[], SenderConfig>("SELECT * FROM sender_config WHERE id = 1")
    .get() as SenderConfig;
}

/**
 * Update the sender_config row (id = 1) with the supplied fields.
 * Only whitelisted column names are accepted; always updates updated_at.
 * Returns the updated row.
 */
export function updateSenderConfig(fields: Partial<SenderConfigFields>): SenderConfig {
  const database = getDb();

  const setParts: string[] = [];
  const values: string[] = [];

  for (const key of ALLOWED_SENDER_CONFIG_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      setParts.push(`${key} = ?`);
      values.push(fields[key] ?? '');
    }
  }

  if (setParts.length > 0) {
    setParts.push("updated_at = datetime('now')");
    database
      .prepare(`UPDATE sender_config SET ${setParts.join(', ')} WHERE id = 1`)
      .run(...values);
  }

  return getSenderConfig();
}
