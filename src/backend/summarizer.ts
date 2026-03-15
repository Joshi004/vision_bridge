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
  const name = config.sender_name || "the sender";
  const company = config.company_name || "";
  const desc = config.company_description || "";
  const role = config.sender_role || "";
  const goal = config.outreach_goal || "";

  const sections: string[] = [];

  if (company && desc) {
    sections.push(`My name is ${name}. I'm the founder of ${company}, ${desc}`);
  } else if (company) {
    sections.push(`My name is ${name}. I run ${company}.`);
  } else {
    sections.push(`My name is ${name}.`);
  }

  if (role) sections.push(role);
  if (goal) sections.push(`Outreach goals:\n${goal}`);

  return sections.join("\n\n") || "No sender context provided.";
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

  const selfMessageCount = profile.messages.filter((m) => m.sender === "self").length;
  const themMessageCount = profile.messages.filter((m) => m.sender !== "self").length;

  const conversationStateText = hasConversation
    ? [
        `CONVERSATION STATE (computed from message history — do not contradict):`,
        `- Messages from you (self): ${selfMessageCount}`,
        `- Messages from them: ${themMessageCount}`,
        selfMessageCount === 0
          ? `- You have NOT sent any messages in this conversation yet.`
          : `- You have sent ${selfMessageCount} message(s) in this conversation.`,
      ].join("\n")
    : `CONVERSATION STATE (computed): No messages exist in this conversation.`;

  const initiator = profile.messages.length > 0 ? profile.messages[0].sender : null;
  const initiatorText = initiator === "self"
    ? "You (the sender) messaged first"
    : initiator === "them"
      ? "They messaged first"
      : "No prior conversation";

  const profileSection = [
    `Name: ${profile.name ?? "unknown"}`,
    `Headline: ${profile.headline ?? "unknown"}`,
    `Location: ${profile.location ?? "unknown"}`,
    `Profile URL: ${profile.url}`,
    `Conversation initiator: ${initiatorText}`,
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

${conversationStateText}

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

STEP 2.5 - CLASSIFY THE CONVERSATION:
Look at the "Conversation initiator" field and the conversation history to classify this interaction into exactly one category:

- referral_inbound_fresh: They reached out asking for a referral/job opportunity at Tether, but you have NOT responded yet. The conversation only contains their message(s). They initiated. No [self] messages exist in the conversation history.
- referral_inbound: They reached out asking for a referral/job opportunity at Tether. You already declined and redirected to Lucas D. Both their request AND your decline exist in the conversation history. They initiated.
- recruiter_inbound: A recruiter or HR person reached out to you about a job opportunity. They initiated.
- recruiter_outbound: You reached out to a recruiter because you identified they are hiring for positions where Techsergy could help. You initiated.
- cold_outreach_no_reply: You previously reached out and they never responded. You initiated.
- cold_outreach_engaged: You previously reached out and they responded — there was back-and-forth. You initiated, but they engaged.
- professional_exchange: A mutual professional conversation — shared interests, tech discussions, congratulations, etc.
- other_inbound: They reached out for some other reason (asking a question, seeking advice, etc.). They initiated.
- no_conversation: No prior conversation exists.

CRITICAL CLASSIFICATION RULE:
- "referral_inbound" REQUIRES that [self] messages exist in the conversation history. If the CONVERSATION STATE above shows "Messages from you (self): 0", you MUST NOT classify as "referral_inbound". Use "referral_inbound_fresh" instead when they asked for a referral and you have not replied yet.
- Only use "referral_inbound" when BOTH their referral request AND your decline/redirect to Lucas D. are present in the conversation history.

STEP 3 - CHOOSE STRATEGIC GOAL AND OUTREACH ANGLE:
Based on the conversation type and seniority, choose a strategic goal:

- client_acquisition: This person (or their company) could be a client for Techsergy. The message should explore whether their team needs engineering capacity.
- talent_pipeline: This person is job-seeking. The message should build goodwill and direct them to the Techsergy LinkedIn page (https://www.linkedin.com/company/110898506) for future opportunities.
- blended: Both angles apply. Offer the talent pipeline AND casually ask about their company's vendor setup.
- standard_outreach: No special context. Standard cold outreach.

Then choose the single most genuine outreach angle based on their profile, posts, and the conversation context.

KNOWN PATTERN - YOUR STANDARD REFERRAL DECLINE:
When people ask you for a Tether referral, you typically send a message that:
- Empathizes with their job search
- Explains that Tether encourages referring only people you've worked with directly
- Redirects them to Lucas D. (Tether recruitment manager) on LinkedIn
- Leaves the door open for future help

If you see this pattern in the conversation history, you know this person came to you for a Tether referral and you've already redirected them. Build on this — don't repeat the referral decline, and don't pretend the conversation didn't happen.

STEP 4 - WRITE THE MESSAGE:
Based on the conversation type and strategic goal from your analysis, follow the appropriate strategy:

A. NO CONVERSATION (no_conversation):
   Write a cold outreach message. Use their profile, posts, and experience to find a genuine connection point. Mention Techsergy naturally. Adapt based on seniority.

B0. FRESH REFERRAL REQUEST (referral_inbound_fresh):
   This person just reached out asking for a referral or job opportunity at Tether. You have NOT responded yet. Generate the referral decline message.

   The message must follow this structure (personalize it slightly based on their name and the specific role/context they mentioned):
   1. Empathize with their job search genuinely
   2. Explain that at Tether, you're encouraged to refer only people you've worked with directly in a professional capacity
   3. Redirect them to Lucas D., who manages recruitment at Tether (LinkedIn: https://www.linkedin.com/in/lucas-dd)
   4. Leave the door open warmly for future help

   Keep the tone warm and supportive. Do NOT mention Techsergy in this message — that comes in a later follow-up. This message is purely about being helpful with their referral request.

   If they mentioned a specific role, acknowledge it. If they shared context about their background, reflect that briefly. The goal is to make the standard decline feel personal, not copy-pasted.

B1. REFERRAL INBOUND - FOLLOW UP (referral_inbound):
   This person reached out to you for a Tether referral. You sent your standard decline (redirected to Lucas D.). Now you're following up after some time.

   First, check in on their situation: "Did you connect with Lucas? How's the search going?"

   Then pivot based on seniority and strategic goal:

   TALENT PIPELINE (junior/mid-level, still job-seeking):
   - Mention Techsergy is growing, no open roles right now, but things could change
   - Share the Techsergy LinkedIn page: https://www.linkedin.com/company/110898506
   - "If something opens up that fits, I'd genuinely be happy to keep you in mind"

   CLIENT ACQUISITION (senior/decision-maker, or someone now employed):
   - Acknowledge the referral conversation warmly
   - Bridge to Techsergy as a service their company might need
   - Ask if their team works with external engineering partners
   - Ask who handles vendor decisions if they can't answer directly

   BLENDED (mid-level at an interesting company):
   - Offer the talent pipeline angle AND casually ask about their company's setup
   - "Also, out of curiosity, does [company] ever work with external engineering teams?"

C. RECRUITER INBOUND (recruiter_inbound):
   They reached out about a role for you. Acknowledge it gracefully.
   Reframe: "I'm not actively looking, but I run a company called Techsergy that provides engineering capacity to teams. If you're scaling your engineering org, we might actually be able to help fill those positions faster and more flexibly than individual hiring."
   Position staff augmentation as solving their hiring problem, not competing with them.

D. RECRUITER OUTBOUND (recruiter_outbound):
   You reached out to them because they're hiring. Be direct about why: "I noticed you're hiring for [roles]. I run Techsergy — we provide embedded engineering teams that can ramp up faster than individual hires."
   Offer a specific value prop: faster time-to-fill, flexible capacity, no long-term commitment.

E. COLD OUTREACH (cold_outreach_no_reply / cold_outreach_engaged):
   No reply: treat as a fresh start with a new angle. Do not reference the old message.
   Engaged: continue naturally, advance toward exploring collaboration.

F. PROFESSIONAL EXCHANGE / OTHER (professional_exchange, other_inbound):
   Build on the genuine connection. Introduce Techsergy as part of what you're up to.

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

MESSAGE DEPTH RULES:
- If the profile has rich data (detailed about section, multiple posts, recommendations), use that data. Reference a specific post topic, career achievement, or company initiative. This makes the message feel personal and researched.
- If the profile is sparse (minimal about, no posts, basic experience), keep the message shorter and simpler. Don't fabricate specificity. A clean 2-3 sentence message is better than a bloated one that reaches for connections that don't exist.
- If their recent posts show hiring activity, team scaling, or technical challenges, these are HIGH-VALUE signals. Staff augmentation is directly relevant to companies that are scaling. Reference these naturally.
- If posts show they're job-seeking (posting about being open to work, sharing job hunt experiences), this confirms the talent pipeline approach is appropriate.

EXAMPLES OF GOOD MESSAGES:

--- EXAMPLE 1 (referral_inbound + junior, talent_pipeline) ---

Prior conversation:
[them]: Hi Naresh, I came across your profile. I'm looking for opportunities at Tether. Could you refer me for a backend engineer role?
[self]: Hi. I completely understand how exhausting and discouraging the job application process can be. I believe you would be a great fit for the role. Unfortunately, I may not be able to directly help with a referral at this time, as at Tether we're encouraged to refer only those we've worked with directly in a professional capacity. That said, you might consider reaching out to Lucas D., who manages recruitment at Tether. I'd love to help in any way I can. Wishing you the very best.

Good follow-up message:
Hey [name], hope you're doing well. Just wanted to check in — did you end up connecting with Lucas? I hope things are moving in the right direction with the search. On a slightly different note, I've been building my own company called Techsergy where we do software delivery and engineering work. We don't have any open roles at the moment, but we're growing and things could change. If you want, feel free to follow our page (https://www.linkedin.com/company/110898506) and if something opens up that fits your background, I'd genuinely be happy to keep you in mind. Either way, rooting for you.

--- EXAMPLE 2 (referral_inbound + decision_maker, client_acquisition) ---

Prior conversation:
[them]: Hi Naresh, I saw you're at Tether. I'm a VP Engineering exploring the crypto/fintech space. Any chance you could refer me or connect me with the right people?
[self]: Hi. I completely understand how exhausting the process can be. Unfortunately, at Tether we're encouraged to refer only those we've worked with directly. You might consider reaching out to Lucas D., who manages recruitment at Tether. I'd love to help in any way I can. Wishing you the very best.

Good follow-up message:
Hey [name], good to reconnect. I hope the exploration into crypto/fintech has been going well since we last chatted. Wanted to reach out about something on a completely different front. I run a company called Techsergy — we provide engineering teams to product companies, basically staff augmentation and managed delivery. Given your background leading engineering orgs, I'm curious if your team at [company] has ever considered working with an external engineering partner for extra capacity. Would love to hear your thoughts if you're open to it, no pressure at all.

--- EXAMPLE 2.5 (referral_inbound_fresh, referral decline) ---

Prior conversation:
[them]: Hi Naresh, I'm a backend developer with 3 years of experience. I saw you're at Tether and was wondering if you could refer me for a backend engineer position? I'd really appreciate any help.

Good message:
Hi [name], thanks for reaching out. I completely understand how tough the job search process can be, and based on what you've shared, I think you'd bring a lot to the table. Unfortunately, at Tether we're encouraged to refer only those we've worked with directly in a professional capacity, so I wouldn't be able to put in a referral this time. That said, I'd suggest reaching out to Lucas D., who manages recruitment at Tether — he might be able to point you in the right direction. https://www.linkedin.com/in/lucas-dd I'd love to help in any way I can down the line, so don't hesitate to reach out if there's anything else. Wishing you the best with the search.

--- EXAMPLE 3 (recruiter_inbound) ---

Prior conversation:
[them]: Hi Naresh, I'm a Technical Recruiter at [Company]. We have a Lead Engineer opening that matches your profile perfectly. Would you be interested in discussing?

Good message:
Hey [name], thanks for thinking of me for the role. I'm actually pretty settled in my current setup, but your message got me thinking. I run a company called Techsergy where we provide engineering teams to product companies — think staff augmentation and managed delivery. If [Company] is scaling the engineering org, we might actually be able to help you fill capacity faster and more flexibly than individual hiring. Would that be worth a quick chat? Totally understand if it's outside your scope.

--- EXAMPLE 4 (recruiter_outbound) ---

Prior conversation:
[self]: Hi [name], I noticed you're actively hiring engineers at [Company]. I run Techsergy and wanted to reach out.

Good follow-up:
Hey [name], just a quick follow-up. I run Techsergy where we provide embedded engineering teams to product companies. I noticed [Company] has several engineering roles open — we've helped teams like yours ramp up capacity faster than individual hiring, with senior devs who can plug in and start delivering quickly. If that's something worth exploring, happy to share more details. If not, no worries at all.

---

OUTPUT FORMAT:
Return your response in exactly this format. Do not add anything outside this format.

ANALYSIS:
Role: <their role and title>
Company: <their company>
Seniority: <decision_maker | mid_level | junior | recruiter | non_technical>
Conversation initiator: <self | them | none>
Conversation type: <referral_inbound_fresh | referral_inbound | recruiter_inbound | recruiter_outbound | cold_outreach_no_reply | cold_outreach_engaged | professional_exchange | other_inbound | no_conversation>
Conversation status: <new | continuation>
Strategic goal: <client_acquisition | talent_pipeline | blended | standard_outreach>
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

export function getPromptPreviewWithReferral(senderConfig: SenderConfig): string {
  const placeholderProfile: ProfileData = {
    url: "https://www.linkedin.com/in/john-smith/",
    name: "John Smith",
    headline: "Senior Software Engineer at FinTech Startup",
    location: "New York, NY",
    about: "Passionate backend engineer with 5 years of experience in fintech. Looking for new opportunities in the blockchain and crypto space.",
    experience: [
      {
        title: "Senior Software Engineer",
        company: "FinTech Startup",
        dateRange: "Mar 2022 – Present",
        description: "Building payment infrastructure and APIs for a Series B fintech company.",
      },
      {
        title: "Software Engineer",
        company: "Acme Bank",
        dateRange: "Jun 2019 – Feb 2022",
        description: "",
      },
    ],
    education: [
      { school: "NYU Tandon School of Engineering", degree: "BS Computer Science", dateRange: "2015 – 2019" },
    ],
    recommendations: [],
    posts: [
      {
        text: "Excited about the intersection of traditional finance and crypto. Been diving deep into DeFi protocols lately.",
        publishedAt: "2024-10-20",
        reactionsCount: "45",
        commentsCount: "8",
      },
    ],
    messages: [
      {
        sender: "them",
        text: "Hi Naresh, I came across your profile and saw you're at Tether. I'm a backend engineer with 5 years of experience and would love to work in the crypto/fintech space. Would you be able to refer me for any open backend engineering roles at Tether?",
        timestamp: "2024-11-01",
      },
      {
        sender: "self",
        text: "Hi John,\n\nI completely understand how exhausting and discouraging the job application process can be. I believe you would be a great fit for the role.\n\nUnfortunately, I may not be able to directly help with a referral at this time, as at Tether we're encouraged to refer only those we've worked with directly in a professional capacity.\n\nThat said, you might consider reaching out to @Lucas D., who manages recruitment at Tether — he may be able to guide or assist you further.\n\nI'd love to help in any way I can, so please don't hesitate to reach out if there's anything else I can support you with. Wishing you the very best.\n\nhttps://www.linkedin.com/in/lucas-dd",
        timestamp: "2024-11-01",
      },
    ],
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

  const conversationInitiatorRaw = field("Conversation initiator").toLowerCase();
  const conversationInitiator: "self" | "them" | "none" =
    conversationInitiatorRaw.startsWith("you") || conversationInitiatorRaw === "self"
      ? "self"
      : conversationInitiatorRaw.startsWith("they") || conversationInitiatorRaw === "them"
        ? "them"
        : "none";

  const conversationType = field("Conversation type");
  const strategicGoal = field("Strategic goal");
  const leverageValue =
    field("Their leverage/value") || field("Their leverage") || field("Leverage/value");

  const result = {
    role: field("Role"),
    company: field("Company"),
    seniority: field("Seniority"),
    conversationInitiator,
    conversationType,
    conversationStatus,
    strategicGoal,
    leverageValue,
    outreachAngle: field("Outreach angle"),
    message,
  };

  log.info(
    "summarizer",
    `Parsed outreach — role:"${result.role}" company:"${result.company}" seniority:"${result.seniority}" initiator:"${result.conversationInitiator}" type:"${result.conversationType}" goal:"${result.strategicGoal}" status:"${result.conversationStatus}" message:${result.message.length} chars`
  );

  return result;
}

// --- Follow-up generation ---

function getFollowUpToneGuidance(followUpNumber: number, conversationType?: string): string {
  let base: string;
  switch (followUpNumber) {
    case 1:
      base = `This is follow-up #1. Keep it brief — 2 to 3 sentences maximum. The energy is casual, like bumping something up in an inbox. Do not repeat or paraphrase the initial message. Sound like a real person, not a reminder bot. Low pressure.`;
      break;
    case 2:
      base = `This is follow-up #2. Go a little deeper. Reference something specific from their profile — a recent post, a career move, a project they mentioned — or share something genuinely relevant to them. This shows you've actually paid attention. Slightly longer than the first follow-up, but still concise. Natural, not salesy.`;
      break;
    case 3:
      base = `This is follow-up #3. This is the final reach-out. Be direct but warm. Acknowledge that this is the last time you'll follow up. Keep the door open — no guilt, no pressure. Graceful close. Concise. Leave them with a good impression.`;
      break;
    default:
      base = `This is a follow-up message. Keep it brief, casual, and low-pressure. Sound like a real person.`;
  }

  if (!conversationType) return base;

  const typeGuidance: Record<string, string> = {
    referral_inbound: "Your initial message was a referral-conversation pivot. If they haven't responded, gently check in about their job search or their thoughts on the Techsergy angle. Don't re-pitch.",
    recruiter_inbound: "You reframed a recruiter's outreach as a staff augmentation opportunity. Try a different angle -- maybe a success story or a different value prop.",
    talent_pipeline: "You offered them the Techsergy page. Don't push again. Share something genuinely useful or just check in.",
  };

  const extra = typeGuidance[conversationType];
  return extra ? `${base}\n\n${extra}` : base;
}

function buildFollowUpPrompt(
  profile: ProfileData,
  senderConfig: SenderConfig,
  priorMessages: OutreachThreadRow[],
  followUpNumber: number,
  conversationType?: string,
  strategicGoal?: string,
  conversationInitiator?: string,
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

  const toneGuidance = getFollowUpToneGuidance(followUpNumber, conversationType);

  const conversationContextSection = (conversationType || strategicGoal || conversationInitiator)
    ? `\n---\n\nCONVERSATION CONTEXT:\n${conversationType ? `Conversation type: ${conversationType}\n` : ""}${strategicGoal ? `Strategic goal: ${strategicGoal}\n` : ""}${conversationInitiator ? `Conversation initiator: ${conversationInitiator}\n` : ""}`
    : "";

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
${conversationContextSection}
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
  conversationType?: string,
  strategicGoal?: string,
  conversationInitiator?: string,
): Promise<string> {
  const prompt = buildFollowUpPrompt(profile, senderConfig, priorMessages, followUpNumber, conversationType, strategicGoal, conversationInitiator);
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
  conversationType?: string,
  strategicGoal?: string,
  conversationInitiator?: string,
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

  const relationshipGuidance: Record<string, string> = {
    referral_inbound: "This person originally came to you for a Tether referral. You pivoted to discuss Techsergy. Keep advancing that angle naturally.",
    recruiter_inbound: "This person is a recruiter who reached out to you. You reframed around staff augmentation. Continue that thread.",
    talent_pipeline: "This person is in your talent pipeline. Be supportive, build the relationship. Don't push services.",
  };

  const contextLines: string[] = [];
  if (conversationType) contextLines.push(`Conversation type: ${conversationType}`);
  if (strategicGoal) contextLines.push(`Strategic goal: ${strategicGoal}`);
  if (conversationInitiator) contextLines.push(`Conversation initiator: ${conversationInitiator}`);
  if (conversationType && relationshipGuidance[conversationType]) {
    contextLines.push(relationshipGuidance[conversationType]);
  }

  const relationshipContextSection = contextLines.length > 0
    ? `\n---\n\nRELATIONSHIP CONTEXT:\n${contextLines.join("\n")}\n`
    : "";

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
${relationshipContextSection}
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
  conversationType?: string,
  strategicGoal?: string,
  conversationInitiator?: string,
): Promise<string> {
  const prompt = buildReplyAssistPrompt(profile, senderConfig, conversationThread, conversationType, strategicGoal, conversationInitiator);
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
  conversationType?: string,
  strategicGoal?: string,
  conversationInitiator?: string,
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

  const reEngagementAngleGuidance: Record<string, string> = {
    referral_inbound: "You tried the referral pivot before. Try a completely different angle -- maybe reference something new from their profile, or lead with the talent pipeline.",
    recruiter_outbound: "Your staff augmentation pitch didn't land. Try approaching from a different direction -- maybe a relevant case study or a different problem they might have.",
  };

  const contextLines: string[] = [];
  if (conversationType) contextLines.push(`Prior conversation type: ${conversationType}`);
  if (strategicGoal) contextLines.push(`Prior strategic goal: ${strategicGoal}`);
  if (conversationInitiator) contextLines.push(`Conversation initiator: ${conversationInitiator}`);
  if (conversationType && reEngagementAngleGuidance[conversationType]) {
    contextLines.push(reEngagementAngleGuidance[conversationType]);
  } else if (conversationType) {
    contextLines.push("Use a completely different angle from the prior outreach. Don't repeat the same approach.");
  }

  const priorContextSection = contextLines.length > 0
    ? `\n---\n\nPRIOR CONVERSATION CONTEXT:\n${contextLines.join("\n")}\n`
    : "";

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
${priorContextSection}
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
  conversationType?: string,
  strategicGoal?: string,
  conversationInitiator?: string,
): Promise<string> {
  const prompt = buildReEngagementPrompt(profile, senderConfig, priorThread, conversationType, strategicGoal, conversationInitiator);
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
