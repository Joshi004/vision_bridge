export interface PostData {
  text: string | null;
  publishedAt: string | null;
  reactionsCount: string | null;
  commentsCount: string | null;
}

export interface ExperienceEntry {
  title: string | null;
  company: string | null;
  dateRange: string | null;
  description: string | null;
}

export interface EducationEntry {
  school: string | null;
  degree: string | null;
  dateRange: string | null;
}

export interface RecommendationEntry {
  recommenderName: string | null;
  recommenderHeadline: string | null;
  relationship: string | null;
  text: string | null;
}

export interface MessageEntry {
  sender: "self" | "them";
  text: string;
  timestamp: string | null;
}

export interface ProfileData {
  url: string;
  name: string | null;
  headline: string | null;
  location: string | null;
  about: string | null;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  recommendations: RecommendationEntry[];
  messages: MessageEntry[];
  posts: PostData[];
  scrapedAt: string;
}

export interface SummarizedProfile extends ProfileData {
  summary: string;
}

export type Persona =
  | "c_level"
  | "management"
  | "top_engineer"
  | "mid_engineer"
  | "junior_engineer"
  | "recruiter"
  | "procurement"
  | "other";

export type MessageState =
  | "inbound_referral"
  | "outbound_referral"
  | "inbound_recruitment"
  | "outbound_recruitment"
  | "inbound_other"
  | "outbound_other";

export interface OutreachResult {
  role: string;
  company: string;
  seniority: string;
  persona: Persona;
  conversationInitiator: "self" | "them" | "none";
  conversationType: string;
  messageState: string;
  subState: string;
  conversationStatus: "new" | "continuation";
  strategicGoal: string;
  leverageValue: string;
  outreachAngle: string;
  message: string;
}

