import type { ProfileData, OutreachResult } from "./types.js";
import type { SenderConfig } from "./db.js";
import type { OutreachThreadRow } from "./lead-service.js";
import * as log from "./logger.js";

// Remote MinMAx instance (Tailscale) — kept for reference
const LLM_URL = "http://100.80.5.15:9084/v1/chat/completions";
// const LLM_MODEL = ""; // server default



// Remote Qwen instance (Tailscale) — kept for reference
// const LLM_URL = "http://100.126.179.17:8010/v1/chat/completions";
const LLM_MODEL = ""; // server default


// Local Ollama instance with Llama 3
// const LLM_URL = "http://localhost:11434/v1/chat/completions";
// // const LLM_MODEL = "qwen3:8b";
// const LLM_MODEL = "deepseek-r1:8b";

const MAX_POSTS_IN_PROMPT = 5;
const MAX_POST_TEXT_LENGTH = 1000;

function buildSenderContext(config: SenderConfig): string {
  const parts: string[] = [];
  if (config.sender_name) {
    parts.push(`My name is ${config.sender_name}.`);
  }
  if (config.company_name) {
    const desc = config.company_description
      ? `, ${config.company_description}`
      : "";
    parts.push(`I run ${config.company_name}${desc}`);
  }
  if (config.sender_role) {
    parts.push(config.sender_role);
  }
  return parts.join(" ") || "No sender context provided.";
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

function buildPrompt(profile: ProfileData, senderConfig: SenderConfig, customInstruction?: string): string {
  const posts = profile.posts
    .slice(0, MAX_POSTS_IN_PROMPT)
    .map((p, i) => {
      const text = p.text?.slice(0, MAX_POST_TEXT_LENGTH) ?? "(no text)";
      const date = p.publishedAt ?? "unknown date";
      const reactions = p.reactionsCount ?? "?";
      const comments = p.commentsCount ?? "?";
      return `Post ${i + 1} [${date}] (${reactions} reactions, ${comments} comments):\n${text}`;
    })
    .join("\n\n");

  const experienceText = profile.experience.length > 0
    ? profile.experience
        .map((e, i) => {
          const line = `${i + 1}. ${e.title ?? "Unknown title"} at ${e.company ?? "Unknown company"}${e.dateRange ? ` (${e.dateRange})` : ""}`;
          return e.description ? `${line}\n   ${e.description}` : line;
        })
        .join("\n")
    : "(not available)";

  const educationText = profile.education.length > 0
    ? profile.education
        .map((e, i) =>
          `${i + 1}. ${e.school ?? "Unknown school"}${e.degree ? ` - ${e.degree}` : ""}${e.dateRange ? ` (${e.dateRange})` : ""}`
        )
        .join("\n")
    : "(not available)";

  const recommendationsText = profile.recommendations.length > 0
    ? profile.recommendations
        .map((r, i) => {
          const header = `${i + 1}. ${r.recommenderName ?? "Unknown"}${r.recommenderHeadline ? ` — ${r.recommenderHeadline}` : ""}${r.relationship ? ` (${r.relationship})` : ""}`;
          return r.text ? `${header}\n   "${r.text}"` : header;
        })
        .join("\n\n")
    : "(not available)";

  const hasConversation = profile.messages.length > 0;
  const conversationText = hasConversation
    ? profile.messages
        .map((m) => {
          const prefix = m.sender === "self" ? "[self]" : "[them]";
          const ts = m.timestamp ? ` (${m.timestamp})` : "";
          return `${prefix}${ts}: ${m.text}`;
        })
        .join("\n")
    : "(no prior conversation)";

  const profileSection = [
    `Name: ${profile.name ?? "unknown"}`,
    `Headline: ${profile.headline ?? "unknown"}`,
    `Location: ${profile.location ?? "unknown"}`,
    `Profile URL: ${profile.url}`,
  ].join("\n");

  return `You are writing a LinkedIn outreach message on behalf of the sender described below.

SENDER CONTEXT:
${buildSenderContext(senderConfig)}

---

PROFILE TO ANALYZE:
${profileSection}

About:
${profile.about ?? "(not available)"}

Experience:
${experienceText}

Education:
${educationText}

Recommendations received (what others say about them):
${recommendationsText}

Existing conversation history:
${conversationText}

Recent posts (up to ${MAX_POSTS_IN_PROMPT}):
${posts || "(no posts available)"}

---

STEP 1 - ANALYZE THE PERSON:
Read the profile, about section, experience, education, and posts carefully. Extract:
- Their role and title
- Their company and what it does
- Their seniority level
- What they likely handle day to day
- Career trajectory from experience: how long at current company, previous companies, industries
- Any language or themes from their About section that reveal how they think about their work
- Any signals from posts: hiring activity, product launches, scaling challenges, tech stack mentions, conferences, initiatives

STEP 2 - CLASSIFY SENIORITY:
Choose exactly one of these labels based on their role:
- decision_maker: CTO, VP Engineering, Head of Product, Founder, CEO, Co-founder, Director of Engineering
- mid_level: Engineering Manager, Team Lead, Senior Engineer, Senior Developer, Staff Engineer, Principal Engineer
- junior: Engineer, Developer, Software Engineer without senior qualifier, Intern, Graduate
- recruiter: Recruiter, Talent Acquisition, HR, Hiring Manager
- non_technical: Sales, Marketing, Operations, Finance, Legal, or any non-engineering role

STEP 3 - CHOOSE AN OUTREACH ANGLE:
Based on the seniority label and posts, identify the single most genuine and relevant reason to reach out. Do not over-assume. If posts show a specific initiative or challenge, reference it lightly. If no strong angle exists, keep it simple and human.

STEP 4 - WRITE THE MESSAGE:
${hasConversation
    ? `There is an existing conversation with this person. Write a follow-up LinkedIn message that builds on what was previously discussed. This is still an outreach message for ${senderConfig.company_name}, but it should feel like a genuine continuation of the conversation, not a cold restart.`
    : "There is no prior conversation with this person. Write a LinkedIn first message following all rules below."}

MESSAGE RULES:
${senderConfig.message_tone}
${senderConfig.message_rules}
- Adapt the message strategy based on seniority:
  * decision_maker: Mention ${senderConfig.company_name} naturally, open a conversation about potential collaboration or overlap
  * mid_level: Connect as peers around shared craft, mention ${senderConfig.company_name} briefly and casually
  * junior: Be friendly, acknowledge their work, and politely ask if they can point you toward the right person for engineering partnerships
  * recruiter: Acknowledge their role, briefly mention that ${senderConfig.company_name} brings engineering capacity and might be relevant to teams they support
  * non_technical: Be warm and genuine, connect around their work, and ask who on their team handles engineering or product decisions
- ${senderConfig.outreach_goal}
- If there is an existing conversation history, build on it naturally. Reference what was previously discussed. If they came to you for a referral, asked a question, or shared something, acknowledge it. The message should feel like a genuine continuation, not a cold restart. But the goal is still outreach for ${senderConfig.company_name}
- If there is no existing conversation, write a first message as usual

---

OUTPUT FORMAT:
Return your response in exactly this format. Do not add anything outside this format.

ANALYSIS:
Role: <their role and title>
Company: <their company>
Seniority: <decision_maker | mid_level | junior | recruiter | non_technical>
Conversation status: <new | continuation>
Outreach angle: <one sentence describing the angle>

MESSAGE:
<the exact copy-paste LinkedIn message, nothing else after it>
${customInstruction ? `\nADDITIONAL INSTRUCTION FROM THE USER: ${customInstruction}\n` : ""}
`;
}

export function getPromptPreview(senderConfig: SenderConfig): string {
  const placeholderProfile: ProfileData = {
    url: "https://www.linkedin.com/in/jane-doe/",
    name: "Jane Doe",
    headline: "VP Engineering at Acme Corp",
    location: "San Francisco, CA",
    about: "Building high-performance engineering teams and scaling product infrastructure.",
    experience: [
      {
        title: "VP Engineering",
        company: "Acme Corp",
        dateRange: "Jan 2021 – Present",
        description: "Leading a team of 40+ engineers across product, platform, and data.",
      },
      {
        title: "Engineering Manager",
        company: "Initech",
        dateRange: "Mar 2018 – Dec 2020",
        description: "",
      },
    ],
    education: [
      { school: "Stanford University", degree: "BS Computer Science", dateRange: "2010 – 2014" },
    ],
    recommendations: [],
    posts: [
      {
        text: "Excited to share that our team just shipped a major infrastructure overhaul — reduced p99 latency by 40%.",
        publishedAt: "2024-11-15",
        reactionsCount: "312",
        commentsCount: "28",
      },
    ],
    messages: [],
    scrapedAt: new Date().toISOString(),
  };
  const full = buildPrompt(placeholderProfile, senderConfig);
  const outputIndex = full.indexOf("\nOUTPUT FORMAT:");
  return outputIndex !== -1 ? full.slice(0, outputIndex).trimEnd() : full;
}

export async function summarizeProfile(profile: ProfileData, senderConfig: SenderConfig, customInstruction?: string): Promise<string> {
  const prompt = buildPrompt(profile, senderConfig, customInstruction);
  log.info("summarizer", `Prompt built for "${profile.name ?? profile.url}" — ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens)`);
  log.info("summarizer", `Sending request to LLM at ${LLM_URL} (model: "${LLM_MODEL || "server default"}")`);

  const reqStart = Date.now();
  let response: Response;
  try {
    response = await fetch(LLM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    log.error("summarizer", `LLM connection failed after ${Date.now() - reqStart}ms: ${String(err)}`);
    throw new Error(
      `Cannot connect to local Ollama at ${LLM_URL}. Make sure Ollama is running and "${LLM_MODEL}" is pulled (run: ollama pull ${LLM_MODEL}).`
    );
  }

  const latencyMs = Date.now() - reqStart;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    log.error("summarizer", `LLM HTTP ${response.status} after ${latencyMs}ms${body ? `: ${body.slice(0, 200)}` : ""}`);
    throw new Error(
      `Ollama returned HTTP ${response.status}${body ? `: ${body}` : ""}`
    );
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const raw = data.choices[0].message.content;
  log.info("summarizer", `LLM response received in ${latencyMs}ms — ${raw.length} chars`);

  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (cleaned.length !== raw.length) {
    log.debug("summarizer", `Stripped <think> block(s) — cleaned length: ${cleaned.length} chars`);
  }
  return cleaned;
}

export function parseOutreachResponse(raw: string): OutreachResult {
  const field = (label: string): string => {
    const match = raw.match(new RegExp(`^${label}:\\s*(.+)$`, "m"));
    return match ? match[1].trim() : "";
  };

  const messageMatch = raw.match(/^MESSAGE:\s*\n([\s\S]+)/m);
  const message = messageMatch ? messageMatch[1].trim() : raw.trim();

  const conversationStatusRaw = field("Conversation status").toLowerCase();
  const conversationStatus: "new" | "continuation" =
    conversationStatusRaw === "continuation" ? "continuation" : "new";

  const result = {
    role: field("Role"),
    company: field("Company"),
    seniority: field("Seniority"),
    conversationStatus,
    outreachAngle: field("Outreach angle"),
    message,
  };

  log.info("summarizer", `Parsed outreach — role:"${result.role}" company:"${result.company}" seniority:"${result.seniority}" status:"${result.conversationStatus}" message:${result.message.length} chars`);

  return result;
}

// --- Follow-up generation ---

function getFollowUpToneGuidance(followUpNumber: number): string {
  switch (followUpNumber) {
    case 1:
      return `This is follow-up #1. Keep it brief — 2 to 3 sentences maximum. The energy is casual, like bumping something up in an inbox. Do not repeat or paraphrase the initial message. Sound like a real person, not a reminder bot. Low pressure.`;
    case 2:
      return `This is follow-up #2. Go a little deeper. Reference something specific from their profile — a recent post, a career move, a project they mentioned — or share something genuinely relevant to them. This shows you've actually paid attention. Slightly longer than the first follow-up, but still concise. Natural, not salesy.`;
    case 3:
      return `This is follow-up #3. This is the final reach-out. Be direct but warm. Acknowledge that this is the last time you'll follow up. Keep the door open — no guilt, no pressure. Graceful close. Concise. Leave them with a good impression.`;
    default:
      return `This is a follow-up message. Keep it brief, casual, and low-pressure. Sound like a real person.`;
  }
}

function buildFollowUpPrompt(
  profile: ProfileData,
  senderConfig: SenderConfig,
  priorMessages: OutreachThreadRow[],
  followUpNumber: number,
): string {
  const recipientSection = [
    `Name: ${profile.name ?? "unknown"}`,
    `Headline: ${profile.headline ?? "unknown"}`,
    `Current company: ${profile.experience[0]?.company ?? "unknown"}`,
  ].join("\n");

  const priorMessagesText = priorMessages.length > 0
    ? priorMessages
        .map((m) => {
          const ts = m.sent_at ? ` (${m.sent_at})` : "";
          return `[${m.message_type}]${ts}: ${m.message}`;
        })
        .join("\n\n")
    : "(no prior messages)";

  const toneGuidance = getFollowUpToneGuidance(followUpNumber);

  return `You are writing follow-up #${followUpNumber} for a LinkedIn outreach sequence.

Here is the sender's context, their prior messages, and the recipient's profile.
Generate ONLY the follow-up message — no analysis, no labels, just the message text ready to send.

---

SENDER CONTEXT:
${buildSenderContext(senderConfig)}

---

RECIPIENT:
${recipientSection}

---

PRIOR MESSAGES (chronological):
${priorMessagesText}

---

TONE GUIDANCE FOR THIS FOLLOW-UP:
${toneGuidance}

SENDER'S MESSAGE TONE AND RULES:
${senderConfig.message_tone}
${senderConfig.message_rules}

---

Write ONLY the follow-up message. No subject line, no greeting label, no explanation. Just the message text.`;
}

export async function generateFollowUp(
  profile: ProfileData,
  senderConfig: SenderConfig,
  priorMessages: OutreachThreadRow[],
  followUpNumber: number,
): Promise<string> {
  const prompt = buildFollowUpPrompt(profile, senderConfig, priorMessages, followUpNumber);
  log.info("summarizer", `Follow-up #${followUpNumber} prompt built for "${profile.name ?? profile.url}" — ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens)`);
  log.info("summarizer", `Sending follow-up #${followUpNumber} request to LLM at ${LLM_URL} (model: "${LLM_MODEL || "server default"}")`);

  const reqStart = Date.now();
  let response: Response;
  try {
    response = await fetch(LLM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    log.error("summarizer", `LLM connection failed after ${Date.now() - reqStart}ms: ${String(err)}`);
    throw new Error(
      `Cannot connect to LLM at ${LLM_URL}. Make sure the LLM server is running.`
    );
  }

  const latencyMs = Date.now() - reqStart;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    log.error("summarizer", `LLM HTTP ${response.status} after ${latencyMs}ms${body ? `: ${body.slice(0, 200)}` : ""}`);
    throw new Error(
      `LLM returned HTTP ${response.status}${body ? `: ${body}` : ""}`
    );
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const raw = data.choices[0].message.content;
  log.info("summarizer", `Follow-up #${followUpNumber} LLM response received in ${latencyMs}ms — ${raw.length} chars`);

  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (cleaned.length !== raw.length) {
    log.debug("summarizer", `Stripped <think> block(s) — cleaned length: ${cleaned.length} chars`);
  }
  return cleaned;
}

// --- Reply assist ---

function buildReplyAssistPrompt(
  profile: ProfileData,
  senderConfig: SenderConfig,
  conversationThread: OutreachThreadRow[],
): string {
  const recipientSection = [
    `Name: ${profile.name ?? "unknown"}`,
    `Headline: ${profile.headline ?? "unknown"}`,
    `Current company: ${profile.experience[0]?.company ?? "unknown"}`,
  ].join("\n");

  const threadText = conversationThread.length > 0
    ? conversationThread
        .map((m) => {
          const label = m.sender === "self" ? "You" : "Them";
          const ts = m.sent_at ? `, ${m.sent_at}` : "";
          return `${label} (${m.message_type}${ts}): ${m.message}`;
        })
        .join("\n\n")
    : "(no prior messages)";

  return `You are writing a reply in an ongoing LinkedIn conversation on behalf of the sender described below.

This is NOT cold outreach and NOT a follow-up to a non-responder. The contact has already replied — this is a genuine conversation continuation between two professionals.

---

SENDER CONTEXT:
${buildSenderContext(senderConfig)}

---

RECIPIENT:
${recipientSection}

---

CONVERSATION THREAD (chronological):
${threadText}

---

YOUR TASK:
Write a reply to the contact's most recent message above.

REPLY RULES:
- Directly address what the contact said in their last message. If they asked a question, answer it. If they expressed interest, acknowledge it and provide relevant info.
- Maintain the natural tone of the conversation — match the energy, not cold formality.
- Be genuine and conversational. No pitch language, no pushy calls to action.
- Advance the relationship without being aggressive. Move things forward naturally.
${senderConfig.message_tone}
${senderConfig.message_rules}

Write ONLY the reply message text. No labels, no subject line, no "MESSAGE:" prefix. Just the text ready to paste into LinkedIn.`;
}

export async function generateReplyAssist(
  profile: ProfileData,
  senderConfig: SenderConfig,
  conversationThread: OutreachThreadRow[],
): Promise<string> {
  const prompt = buildReplyAssistPrompt(profile, senderConfig, conversationThread);
  log.info("summarizer", `Reply assist prompt built for "${profile.name ?? profile.url}" — ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens)`);
  log.info("summarizer", `Sending reply assist request to LLM at ${LLM_URL} (model: "${LLM_MODEL || "server default"}")`);

  const reqStart = Date.now();
  let response: Response;
  try {
    response = await fetch(LLM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    log.error("summarizer", `LLM connection failed after ${Date.now() - reqStart}ms: ${String(err)}`);
    throw new Error(
      `Cannot connect to LLM at ${LLM_URL}. Make sure the LLM server is running.`
    );
  }

  const latencyMs = Date.now() - reqStart;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    log.error("summarizer", `LLM HTTP ${response.status} after ${latencyMs}ms${body ? `: ${body.slice(0, 200)}` : ""}`);
    throw new Error(
      `LLM returned HTTP ${response.status}${body ? `: ${body}` : ""}`
    );
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const raw = data.choices[0].message.content;
  log.info("summarizer", `Reply assist LLM response received in ${latencyMs}ms — ${raw.length} chars`);

  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (cleaned.length !== raw.length) {
    log.debug("summarizer", `Stripped <think> block(s) — cleaned length: ${cleaned.length} chars`);
  }
  return cleaned;
}

// --- Re-engagement ---

function buildReEngagementPrompt(
  profile: ProfileData,
  senderConfig: SenderConfig,
  priorThread: OutreachThreadRow[],
): string {
  const recipientSection = [
    `Name: ${profile.name ?? "unknown"}`,
    `Headline: ${profile.headline ?? "unknown"}`,
    `Current company: ${profile.experience[0]?.company ?? "unknown"}`,
  ].join("\n");

  const threadText = priorThread.length > 0
    ? priorThread
        .map((m) => {
          const label = m.sender === "self" ? "You" : "Them";
          const ts = m.sent_at ? `, ${m.sent_at}` : "";
          return `${label} (${m.message_type}${ts}): ${m.message}`;
        })
        .join("\n\n")
    : "(no prior messages)";

  return `You are writing a re-engagement LinkedIn message on behalf of the sender described below.

This person was previously contacted and the conversation went cold — either they never responded to the outreach and follow-ups, or there was a brief exchange that fizzled out. You are NOT writing a follow-up to an active sequence. This is a fresh attempt after a significant gap in time.

---

SENDER CONTEXT:
${buildSenderContext(senderConfig)}

---

RECIPIENT (freshly re-scraped profile — may contain new info since last contact):
${recipientSection}

About:
${profile.about ?? "(not available)"}

---

FULL PRIOR OUTREACH HISTORY (chronological):
${threadText}

---

YOUR TASK:
Write a re-engagement message to this person.

RE-ENGAGEMENT RULES:
- The full prior outreach history is shown above. DO NOT repeat the same opening, pitch, or angle used in any of those messages. The recipient has already seen that approach — it didn't land.
- Acknowledge that time has passed, but do so naturally. Avoid tired phrases like "I know it's been a while", "just circling back", "touching base", or "following up again".
- Offer a FRESH reason to connect. Use one of these approaches:
  * Reference something new from their profile — a new role, a company change, a recent post, or an updated headline if it differs from what they had before
  * Mention a new development on the sender's side that's genuinely relevant to them
  * Try a completely different angle than what was used in the prior outreach
- The tone must be warm and low-pressure. This person didn't engage before, so the message needs to feel genuinely different — not like another push in the same direction.
- Keep it concise. This is a re-opening, not a pitch deck.
${senderConfig.message_tone}
${senderConfig.message_rules}

Write ONLY the message text. No labels, no subject line, no "MESSAGE:" prefix. Just the text ready to paste into LinkedIn.`;
}

export async function generateReEngagement(
  profile: ProfileData,
  senderConfig: SenderConfig,
  priorThread: OutreachThreadRow[],
): Promise<string> {
  const prompt = buildReEngagementPrompt(profile, senderConfig, priorThread);
  log.info("summarizer", `Re-engagement prompt built for "${profile.name ?? profile.url}" — ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens)`);
  log.info("summarizer", `Sending re-engagement request to LLM at ${LLM_URL} (model: "${LLM_MODEL || "server default"}")`);

  const reqStart = Date.now();
  let response: Response;
  try {
    response = await fetch(LLM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    log.error("summarizer", `LLM connection failed after ${Date.now() - reqStart}ms: ${String(err)}`);
    throw new Error(
      `Cannot connect to LLM at ${LLM_URL}. Make sure the LLM server is running.`
    );
  }

  const latencyMs = Date.now() - reqStart;

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    log.error("summarizer", `LLM HTTP ${response.status} after ${latencyMs}ms${body ? `: ${body.slice(0, 200)}` : ""}`);
    throw new Error(
      `LLM returned HTTP ${response.status}${body ? `: ${body}` : ""}`
    );
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const raw = data.choices[0].message.content;
  log.info("summarizer", `Re-engagement LLM response received in ${latencyMs}ms — ${raw.length} chars`);

  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (cleaned.length !== raw.length) {
    log.debug("summarizer", `Stripped <think> block(s) — cleaned length: ${cleaned.length} chars`);
  }
  return cleaned;
}
