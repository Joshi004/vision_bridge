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

STEP 2 - CLASSIFY PERSONA:
Choose exactly one persona label based on their role:
- c_level: Director, VP, CTO, CEO, Founder, Co-founder, Chief [X] Officer
- management: Manager, Senior Manager, Hiring Manager, Engineering Manager, Head of [X]
- top_engineer: Staff Engineer, Principal Engineer, Distinguished Engineer
- mid_engineer: Tech Lead, Lead Engineer, Architect, System Architect, Senior Engineer, Senior Developer
- junior_engineer: Software Engineer I/II, Associate Engineer, Junior Engineer, Software Engineer (without senior qualifier), Intern, Graduate, Entry-level
- recruiter: Recruiter, Talent Acquisition, HR, Staffing
- procurement: Procurement Manager, Vendor Management, Sourcing Manager, Procurement Lead
- other: Anyone not fitting the categories above (Sales, Marketing, Operations, Finance, Legal, non-engineering roles)

STEP 2.5 - CLASSIFY MESSAGE STATE:
Based on the "Conversation initiator" field and the conversation history, classify this into exactly one state:

- inbound_referral: They messaged you asking for a referral or job opportunity (at Tether or elsewhere). They initiated.
- outbound_referral: You messaged them previously about a referral situation. You initiated.
- inbound_recruitment: A recruiter or HR person reached out to you about a job opportunity. They initiated.
- outbound_recruitment: You reached out to a recruiter or company about recruitment/hiring needs. You initiated.
- inbound_other: They messaged you for any other reason (question, advice, professional exchange, etc.). They initiated.
- outbound_other: You messaged them for any other reason (cold outreach, professional connection, etc.). You initiated.

If no prior conversation exists, output: none

SUB-STATE FLAGS (output these after the main state):
- fresh: You have NOT sent any reply yet (no [self] messages in conversation history). Only applicable to inbound states.
- engaged: Both parties have exchanged messages. Applicable to outbound states when they have replied.
- no_reply: You messaged them but they never responded. Applicable to outbound states.

CRITICAL CLASSIFICATION RULE:
- "inbound_referral" with sub-state "fresh" REQUIRES that [self] messages are ABSENT in the conversation history. If the CONVERSATION STATE above shows "Messages from you (self): 0", you MUST use sub-state "fresh". If [self] messages exist, sub-state is "engaged".
- Only use sub-state "n/a" when no sub-state applies (e.g. no prior conversation, or outbound with no reply yet that doesn't fit the above).

STEP 3 - CHOOSE STRATEGIC GOAL AND OUTREACH ANGLE:
Based on the persona and message state, choose a strategic goal:

- client_acquisition: This person (or their company) could be a client for Techsergy. The message should explore whether their team needs engineering capacity.
- talent_pipeline: This person is job-seeking. The message should build goodwill and direct them to the Techsergy LinkedIn page (https://www.linkedin.com/company/110898506) for future opportunities.
- blended: Both angles apply. Offer the talent pipeline AND casually ask about their company's vendor setup.
- standard_outreach: No special context. Standard cold outreach.

Strategic goal by persona when no prior conversation exists:
- c_level / management: client_acquisition (they likely make or influence vendor decisions)
- top_engineer / mid_engineer: blended (they may be job-seeking and can also refer you upward)
- junior_engineer: talent_pipeline (job-seeking likely, ask for intro to decision-maker)
- recruiter: client_acquisition (staff augmentation angle)
- procurement: client_acquisition (directly controls vendor budgets)
- other: standard_outreach (model decides based on profile)

Then choose the single most genuine outreach angle based on their profile, posts, and the conversation context.

KNOWN PATTERN - YOUR STANDARD REFERRAL DECLINE:
When people ask you for a Tether referral, you typically send a message that:
- Empathizes with their job search
- Explains that Tether encourages referring only people you've worked with directly
- Redirects them to Lucas D. (Tether recruitment manager) on LinkedIn
- Leaves the door open for future help

If you see this pattern in the conversation history, you know this person came to you for a Tether referral and you've already redirected them. Build on this — don't repeat the referral decline, and don't pretend the conversation didn't happen.

STEP 4 - WRITE THE MESSAGE:
Based on the persona and message state from your analysis, follow the matching strategy:

A. NO PRIOR CONVERSATION (message state = none):
   Write a cold outreach message. Use their profile, posts, and experience to find a genuine connection point. Adapt based on persona:

   - c_level: Peer connection — mention ${senderConfig.company_name} naturally, open a conversation about potential collaboration or engineering capacity.
   - management: Peer connection — mention ${senderConfig.company_name} briefly and casually. Ask about their team's engineering setup.
   - top_engineer / mid_engineer: Connect on technical interests — mention ${senderConfig.company_name} casually, ask for an intro to whoever handles engineering vendor decisions.
   - junior_engineer: Light connection — be friendly and genuine, ask for an intro or who handles engineering partnerships at their company.
   - procurement: Direct — ${senderConfig.company_name}'s services are directly relevant to their vendor management role. Be clear and concise.
   - recruiter: Staff augmentation angle — ${senderConfig.company_name} can help fill engineering capacity faster than individual hiring.
   - other: Model reads the profile and decides the most natural approach. No forced strategy.

B. INBOUND REFERRAL (message state = inbound_referral):

   B1. FRESH (sub-state = fresh, no reply sent yet):
   This person just reached out asking for a referral or job opportunity at Tether. You have NOT responded yet. Generate the referral decline message.

   The message must follow this structure (personalize it slightly based on their name and the specific role/context they mentioned):
   1. Empathize with their job search genuinely
   2. Explain that at Tether, you're encouraged to refer only people you've worked with directly in a professional capacity
   3. Redirect them to Lucas D., who manages recruitment at Tether (LinkedIn: https://www.linkedin.com/in/lucas-dd)
   4. Leave the door open warmly for future help

   Keep the tone warm and supportive. Do NOT mention ${senderConfig.company_name} in this message — that comes in a later follow-up. This message is purely about being helpful with their referral request.

   If they mentioned a specific role, acknowledge it. If they shared context about their background, reflect that briefly. The goal is to make the standard decline feel personal, not copy-pasted.

   B2. REPLIED (sub-state != fresh — you already sent the referral decline):
   This is a follow-up to the referral decline. Check in first: "Did you connect with Lucas? How's the search going?"

   Then pivot based on persona:
   - junior_engineer / mid_engineer / top_engineer: Check in on their search. Introduce ${senderConfig.company_name} — growing, no open roles right now, but things could change. Share the LinkedIn page (https://www.linkedin.com/company/110898506). Ask if they know anyone they can connect you to who handles engineering partnerships or vendor decisions at their company.
   - management / c_level: Check in briefly. Pivot to ${senderConfig.company_name} as a service their team might need. Ask if they work with external engineering partners or about their capacity situation.
   - recruiter: Unlikely scenario — reframe around staff augmentation. Ask if their team ever works with external engineering vendors.
   - procurement: Very relevant — connect the ${senderConfig.company_name} pitch directly to their vendor management role. Ask if they manage engineering vendor relationships.
   - other: Introduce ${senderConfig.company_name} as what you're building. Ask if they know someone who handles engineering partnerships at their company.

C. INBOUND RECRUITMENT (message state = inbound_recruitment):
   A recruiter reached out about a role for you. Acknowledge it gracefully.
   Reframe: "I'm not actively looking, but I run a company called ${senderConfig.company_name} that provides engineering capacity to teams. If you're scaling your engineering org, we might actually be able to help fill those positions faster and more flexibly than individual hiring."
   Position staff augmentation as solving their hiring problem, not competing with them.

D. OUTBOUND RECRUITMENT (message state = outbound_recruitment):
   You reached out to them because they're hiring. Be direct: "I noticed you're hiring for [roles]. I run ${senderConfig.company_name} — we provide embedded engineering teams that can ramp up faster than individual hires."
   Offer a specific value prop: faster time-to-fill, flexible capacity, no long-term commitment.

E. OUTBOUND OTHER (message state = outbound_other):
   E1. No reply (sub-state = no_reply): Treat as a fresh start with a new angle. Do not reference the old message. Use the same persona-based approach as section A.
   E2. Engaged (sub-state = engaged): Continue naturally, advance toward exploring collaboration. Use the same persona-based approach as section A.

F. INBOUND OTHER (message state = inbound_other):
   Build on the genuine connection. Introduce ${senderConfig.company_name} as part of what you're building. Adapt based on persona (same persona-based approach as section A).

MESSAGE RULES:
${senderConfig.message_tone}
${senderConfig.message_rules}
- Adapt the message strategy based on persona:
  * c_level: Mention ${senderConfig.company_name} naturally, open a conversation about potential collaboration or engineering capacity
  * management: Connect as peers around shared craft, mention ${senderConfig.company_name} briefly and casually
  * top_engineer / mid_engineer: Connect on technical interests, mention ${senderConfig.company_name} casually, and ask for an intro to whoever handles vendor or engineering decisions
  * junior_engineer: Be friendly, acknowledge their work, and politely ask if they can point you toward the right person for engineering partnerships
  * recruiter: Acknowledge their role, briefly mention that ${senderConfig.company_name} brings engineering capacity and might be relevant to teams they support
  * procurement: ${senderConfig.company_name}'s services are directly relevant to their vendor management role — be direct and clear
  * other: Be warm and genuine, connect around their work, and ask who on their team handles engineering or product decisions
- ${senderConfig.outreach_goal}

MESSAGE DEPTH RULES:
- If the profile has rich data (detailed about section, multiple posts, recommendations), use that data. Reference a specific post topic, career achievement, or company initiative. This makes the message feel personal and researched.
- If the profile is sparse (minimal about, no posts, basic experience), keep the message shorter and simpler. Don't fabricate specificity. A clean 2-3 sentence message is better than a bloated one that reaches for connections that don't exist.
- If their recent posts show hiring activity, team scaling, or technical challenges, these are HIGH-VALUE signals. Staff augmentation is directly relevant to companies that are scaling. Reference these naturally.
- If posts show they're job-seeking (posting about being open to work, sharing job hunt experiences), this confirms the talent pipeline approach is appropriate.

EXAMPLES OF GOOD MESSAGES:

--- EXAMPLE 1 (message state: inbound_referral, sub-state: engaged | persona: junior_engineer | goal: talent_pipeline) ---

Prior conversation:
[them]: Hi Naresh, I came across your profile. I'm looking for opportunities at Tether. Could you refer me for a backend engineer role?
[self]: Hi. I completely understand how exhausting and discouraging the job application process can be. I believe you would be a great fit for the role. Unfortunately, I may not be able to directly help with a referral at this time, as at Tether we're encouraged to refer only those we've worked with directly in a professional capacity. That said, you might consider reaching out to Lucas D., who manages recruitment at Tether. I'd love to help in any way I can. Wishing you the very best.

Good follow-up message:
Hey [name], hope you're doing well. Just wanted to check in — did you end up connecting with Lucas? I hope things are moving in the right direction with the search. On a slightly different note, I've been building my own company called Techsergy where we do software delivery and engineering work. We don't have any open roles at the moment, but we're growing and things could change. If you want, feel free to follow our page (https://www.linkedin.com/company/110898506) and if something opens up that fits your background, I'd genuinely be happy to keep you in mind. Either way, rooting for you.

--- EXAMPLE 2 (message state: inbound_referral, sub-state: engaged | persona: c_level | goal: client_acquisition) ---

Prior conversation:
[them]: Hi Naresh, I saw you're at Tether. I'm a VP Engineering exploring the crypto/fintech space. Any chance you could refer me or connect me with the right people?
[self]: Hi. I completely understand how exhausting the process can be. Unfortunately, at Tether we're encouraged to refer only those we've worked with directly. You might consider reaching out to Lucas D., who manages recruitment at Tether. I'd love to help in any way I can. Wishing you the very best.

Good follow-up message:
Hey [name], good to reconnect. I hope the exploration into crypto/fintech has been going well since we last chatted. Wanted to reach out about something on a completely different front. I run a company called Techsergy — we provide engineering teams to product companies, basically staff augmentation and managed delivery. Given your background leading engineering orgs, I'm curious if your team at [company] has ever considered working with an external engineering partner for extra capacity. Would love to hear your thoughts if you're open to it, no pressure at all.

--- EXAMPLE 2.5 (message state: inbound_referral, sub-state: fresh | persona: junior_engineer | goal: talent_pipeline) ---

Prior conversation:
[them]: Hi Naresh, I'm a backend developer with 3 years of experience. I saw you're at Tether and was wondering if you could refer me for a backend engineer position? I'd really appreciate any help.

Good message:
Hi [name], thanks for reaching out. I completely understand how tough the job search process can be, and based on what you've shared, I think you'd bring a lot to the table. Unfortunately, at Tether we're encouraged to refer only those we've worked with directly in a professional capacity, so I wouldn't be able to put in a referral this time. That said, I'd suggest reaching out to Lucas D., who manages recruitment at Tether — he might be able to point you in the right direction. https://www.linkedin.com/in/lucas-dd I'd love to help in any way I can down the line, so don't hesitate to reach out if there's anything else. Wishing you the best with the search.

--- EXAMPLE 3 (message state: inbound_recruitment | persona: recruiter | goal: client_acquisition) ---

Prior conversation:
[them]: Hi Naresh, I'm a Technical Recruiter at [Company]. We have a Lead Engineer opening that matches your profile perfectly. Would you be interested in discussing?

Good message:
Hey [name], thanks for thinking of me for the role. I'm actually pretty settled in my current setup, but your message got me thinking. I run a company called Techsergy where we provide engineering teams to product companies — think staff augmentation and managed delivery. If [Company] is scaling the engineering org, we might actually be able to help you fill capacity faster and more flexibly than individual hiring. Would that be worth a quick chat? Totally understand if it's outside your scope.

--- EXAMPLE 4 (message state: outbound_recruitment | persona: recruiter | goal: client_acquisition) ---

Prior conversation:
[self]: Hi [name], I noticed you're actively hiring engineers at [Company]. I run Techsergy and wanted to reach out.

Good follow-up:
Hey [name], just a quick follow-up. I run Techsergy where we provide embedded engineering teams to product companies. I noticed [Company] has several engineering roles open — we've helped teams like yours ramp up capacity faster than individual hiring, with senior devs who can plug in and start delivering quickly. If that's something worth exploring, happy to share more details. If not, no worries at all.

--- EXAMPLE 5 (message state: outbound_other | persona: procurement | goal: client_acquisition) ---

Prior conversation:
(no prior conversation)

Good message:
Hi [name], came across your profile while looking at [Company]'s team. I run Techsergy — we're a software engineering firm that works with companies as an embedded team or on-demand engineering capacity. Given your role managing vendor relationships at [Company], I figured this might be directly relevant to what you work with. We're straightforward to evaluate: fixed-rate, no long-term lock-in, and we've worked with product teams that needed engineering capacity without the overhead of full-time hiring. Happy to share specifics if it's worth a look. No pitch decks, just a straight conversation.

--- EXAMPLE 6 (message state: inbound_referral, sub-state: engaged | persona: management | goal: client_acquisition) ---

Prior conversation:
[them]: Hey Naresh, I saw you work at Tether. I'm currently exploring new opportunities — any chance you could refer me or give me some advice on getting in?
[self]: Hey, thanks for reaching out. Totally get it — the market's been tough. At Tether we typically refer people we've worked with directly, so I wouldn't be the right person to put a referral in. But you might want to connect with Lucas D. who leads recruitment there — he'd be the right person to talk to. https://www.linkedin.com/in/lucas-dd Hope that helps. Feel free to reach out if there's anything else.

Good follow-up message:
Hey [name], just wanted to check in — hope the job search has been moving along since we last spoke. On a completely different note, I've been building something I thought might actually be relevant to you. I run a company called Techsergy — we provide engineering teams to product companies, basically embedded engineering capacity and managed delivery. Given your background managing teams, I'm curious if you've ever run into a situation where you needed to scale engineering quickly but didn't have the headcount or time to hire. Happy to chat if it's relevant — no pitch, just a quick conversation to see if there's a fit.

---

OUTPUT FORMAT:
Return your response in exactly this format. Do not add anything outside this format.

ANALYSIS:
Role: <their role and title>
Company: <their company>
Persona: <c_level | management | top_engineer | mid_engineer | junior_engineer | recruiter | procurement | other>
Conversation initiator: <self | them | none>
Message state: <inbound_referral | outbound_referral | inbound_recruitment | outbound_recruitment | inbound_other | outbound_other | none>
Sub-state: <fresh | engaged | no_reply | n/a>
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

  // --- Persona: prefer new "Persona" field, fall back to old "Seniority" ---
  const seniorityRaw = field("Seniority");
  const personaRaw = field("Persona");

  const SENIORITY_TO_PERSONA: Record<string, string> = {
    decision_maker: "c_level",
    mid_level: "mid_engineer",
    junior: "junior_engineer",
    recruiter: "recruiter",
    non_technical: "other",
  };

  const VALID_PERSONAS = new Set([
    "c_level", "management", "top_engineer", "mid_engineer",
    "junior_engineer", "recruiter", "procurement", "other",
  ]);

  let persona: string = personaRaw;
  if (!VALID_PERSONAS.has(persona)) {
    persona = SENIORITY_TO_PERSONA[personaRaw] ?? SENIORITY_TO_PERSONA[seniorityRaw] ?? seniorityRaw ?? "";
  }

  // --- Message state: prefer new "Message state" field, fall back to old "Conversation type" ---
  const messageStateRaw = field("Message state");
  const subStateRaw = field("Sub-state");

  const VALID_MESSAGE_STATES = new Set([
    "inbound_referral", "outbound_referral", "inbound_recruitment",
    "outbound_recruitment", "inbound_other", "outbound_other", "none",
  ]);

  let messageState = messageStateRaw;
  let subState = subStateRaw;

  if (!VALID_MESSAGE_STATES.has(messageState)) {
    // Map old conversation types to new message states
    const typeToState: Record<string, { state: string; subState: string }> = {
      referral_inbound_fresh: { state: "inbound_referral", subState: "fresh" },
      referral_inbound: { state: "inbound_referral", subState: "engaged" },
      recruiter_inbound: { state: "inbound_recruitment", subState: "n/a" },
      recruiter_outbound: { state: "outbound_recruitment", subState: "n/a" },
      cold_outreach_no_reply: { state: "outbound_other", subState: "no_reply" },
      cold_outreach_engaged: { state: "outbound_other", subState: "engaged" },
      professional_exchange: {
        state: conversationInitiator === "self" ? "outbound_other" : "inbound_other",
        subState: "engaged",
      },
      other_inbound: { state: "inbound_other", subState: "n/a" },
      no_conversation: { state: "none", subState: "n/a" },
    };

    const mapped = typeToState[conversationType] ?? typeToState[messageStateRaw];
    if (mapped) {
      messageState = mapped.state;
      if (!subState || subState === "") subState = mapped.subState;
    } else {
      messageState = messageStateRaw || conversationType || "";
    }
  }

  const result: OutreachResult = {
    role: field("Role"),
    company: field("Company"),
    seniority: seniorityRaw,
    persona: (VALID_PERSONAS.has(persona) ? persona : "other") as OutreachResult["persona"],
    conversationInitiator,
    conversationType,
    messageState,
    subState: subState || "n/a",
    conversationStatus,
    strategicGoal,
    leverageValue,
    outreachAngle: field("Outreach angle"),
    message,
  };

  log.info(
    "summarizer",
    `Parsed outreach — role:"${result.role}" company:"${result.company}" persona:"${result.persona}" initiator:"${result.conversationInitiator}" messageState:"${result.messageState}" subState:"${result.subState}" goal:"${result.strategicGoal}" status:"${result.conversationStatus}" message:${result.message.length} chars`
  );

  return result;
}

// --- Follow-up generation ---

function getFollowUpToneGuidance(
  followUpNumber: number,
  conversationType?: string,
  persona?: string,
): string {
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
    inbound_referral: "Your initial message was a referral-conversation pivot. If they haven't responded, gently check in about their job search or their thoughts on the Techsergy angle. Don't re-pitch.",
    inbound_recruitment: "You reframed a recruiter's outreach as a staff augmentation opportunity. Try a different angle — maybe a success story or a different value prop.",
    outbound_recruitment: "You reached out about a staffing opportunity. Try a different value prop — speed of ramp-up, specific capabilities, or a relevant case study.",
    outbound_other: "This is a general outreach follow-up. Keep it light. Reference something specific from their profile or share something relevant to them.",
    inbound_other: "They initiated this conversation. Check in naturally — reference the context of their original outreach without being pushy.",
    talent_pipeline: "You offered them the Techsergy page. Don't push again. Share something genuinely useful or just check in.",
  };

  const personaGuidance: Record<string, Record<string, string>> = {
    inbound_referral: {
      junior_engineer: "Since this person came via a referral, check in on their job search. If follow-up 1, introduce the Techsergy page and ask for connections. If follow-up 2+, don't repeat the page — ask for an intro.",
      mid_engineer: "Same structure as junior — check in, ask for connections to whoever handles engineering partnerships at their company.",
      top_engineer: "Peer-level tone. Ask if they know the right person for engineering partnerships at their current company.",
      management: "Pivot to Techsergy as a service their team might need. Ask about engineering capacity.",
      c_level: "Same as management, more direct. Ask about external engineering partners.",
      procurement: "Directly relevant — connect the pitch to their vendor management role.",
      other: "Introduce Techsergy. Ask for a connection to the right person.",
    },
    inbound_recruitment: {
      recruiter: "Follow up on the staff augmentation reframe. Try a different value prop — speed of ramp-up, specific capabilities.",
    },
  };

  const parts: string[] = [base];

  const stateExtra = typeGuidance[conversationType];
  if (stateExtra) parts.push(stateExtra);

  if (persona && personaGuidance[conversationType]?.[persona]) {
    parts.push(personaGuidance[conversationType][persona]);
  }

  return parts.join("\n\n");
}

function buildFollowUpPrompt(
  profile: ProfileData,
  senderConfig: SenderConfig,
  priorMessages: OutreachThreadRow[],
  followUpNumber: number,
  conversationType?: string,
  strategicGoal?: string,
  conversationInitiator?: string,
  persona?: string,
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

  const toneGuidance = getFollowUpToneGuidance(followUpNumber, conversationType, persona);

  const conversationContextSection = (conversationType || strategicGoal || conversationInitiator || persona)
    ? `\n---\n\nCONVERSATION CONTEXT:\n${conversationType ? `Conversation type: ${conversationType}\n` : ""}${strategicGoal ? `Strategic goal: ${strategicGoal}\n` : ""}${conversationInitiator ? `Conversation initiator: ${conversationInitiator}\n` : ""}${persona ? `Persona: ${persona}\n` : ""}`
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
  persona?: string,
): Promise<string> {
  const prompt = buildFollowUpPrompt(profile, senderConfig, priorMessages, followUpNumber, conversationType, strategicGoal, conversationInitiator, persona);
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
  persona?: string,
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
    inbound_referral: "This person originally came to you for a Tether referral. You pivoted to discuss Techsergy. Keep advancing that angle naturally.",
    inbound_recruitment: "This person is a recruiter who reached out to you. You reframed around staff augmentation. Continue that thread.",
    outbound_recruitment: "You reached out about a staffing opportunity and they responded. Build on their interest — answer their questions directly and keep the tone consultative.",
    outbound_other: "This started as cold outreach and they responded. Keep the tone natural — they engaged, so follow their lead.",
    inbound_other: "They initiated this conversation. Stay responsive to their agenda while advancing the relationship.",
    talent_pipeline: "This person is in your talent pipeline. Be supportive, build the relationship. Don't push services.",
  };

  const contextLines: string[] = [];
  if (conversationType) contextLines.push(`Conversation type: ${conversationType}`);
  if (strategicGoal) contextLines.push(`Strategic goal: ${strategicGoal}`);
  if (conversationInitiator) contextLines.push(`Conversation initiator: ${conversationInitiator}`);
  if (persona) contextLines.push(`Persona: ${persona}`);
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
  persona?: string,
): Promise<string> {
  const prompt = buildReplyAssistPrompt(profile, senderConfig, conversationThread, conversationType, strategicGoal, conversationInitiator, persona);
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
  persona?: string,
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
    inbound_referral: "You tried the referral pivot before. Try a completely different angle — maybe reference something new from their profile, or lead with the talent pipeline.",
    inbound_recruitment: "Your staff augmentation reframe didn't land. Try approaching from a different direction — maybe a relevant case study or a different problem they might have.",
    outbound_recruitment: "Your staffing pitch didn't get a response. Try a different angle entirely — lead with their perspective, not yours.",
    outbound_other: "Previous cold outreach went cold. Start fresh — reference something new from their profile or a relevant development on your end.",
    inbound_other: "The prior conversation fizzled. Re-engage with a genuine reason — something new, something relevant, not a rehash.",
  };

  const personaReEngagementGuidance: Record<string, string> = {
    procurement: "This person manages vendors or external partnerships. Frame the re-engagement around a business problem they likely face — capacity gaps, vendor reliability, or cost-efficiency — rather than a generic check-in.",
    c_level: "Get to the point quickly. Tie the re-engagement to a business outcome or strategic decision they'd care about. No fluff.",
    management: "Lead with a concrete benefit to their team. Framing around team capacity or delivery speed tends to resonate.",
    recruiter: "Emphasize the staff augmentation angle with a fresh value prop — a specific capability or a quick ramp-up story.",
  };

  const contextLines: string[] = [];
  if (conversationType) contextLines.push(`Prior conversation type: ${conversationType}`);
  if (strategicGoal) contextLines.push(`Prior strategic goal: ${strategicGoal}`);
  if (conversationInitiator) contextLines.push(`Conversation initiator: ${conversationInitiator}`);
  if (persona) contextLines.push(`Persona: ${persona}`);

  if (conversationType && reEngagementAngleGuidance[conversationType]) {
    contextLines.push(reEngagementAngleGuidance[conversationType]);
  } else if (conversationType) {
    contextLines.push("Use a completely different angle from the prior outreach. Don't repeat the same approach.");
  }

  if (persona && personaReEngagementGuidance[persona]) {
    contextLines.push(personaReEngagementGuidance[persona]);
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
  persona?: string,
): Promise<string> {
  const prompt = buildReEngagementPrompt(profile, senderConfig, priorThread, conversationType, strategicGoal, conversationInitiator, persona);
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
