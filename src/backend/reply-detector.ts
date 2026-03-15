import { getDb } from "./db.js";

/**
 * Compare freshly scraped LinkedIn messages for a profile against what is
 * stored in the database, and identify any new replies from the other person.
 *
 * A "new reply" is a message where:
 *   - sender is NOT "self" (i.e. it came from "them")
 *   - the combination of sender + text does NOT already exist in stored messages
 *
 * Returns whether at least one new reply was found and the list of new messages.
 */
export function detectNewReplies(
  profileId: number,
  freshMessages: Array<{ sender: string; text: string }>,
): { hasNewReply: boolean; newMessages: Array<{ sender: string; text: string }> } {
  const db = getDb();

  const storedRows = db
    .prepare<number[], { sender: string; text: string }>(
      "SELECT sender, text FROM linkedin_messages WHERE profile_id = ? ORDER BY sort_order ASC"
    )
    .all(profileId) as { sender: string; text: string }[];

  const storedKeys = new Set<string>(
    storedRows.map((m) => `${m.sender}::${m.text}`)
  );

  const newMessages = freshMessages.filter(
    (m) => m.sender !== "self" && !storedKeys.has(`${m.sender}::${m.text}`)
  );

  return { hasNewReply: newMessages.length > 0, newMessages };
}
