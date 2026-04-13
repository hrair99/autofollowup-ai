// ============================================
// AutoFollowUp AI v2 — Full Type System
// ============================================

// --- Lead types ---
export type LeadStatus = 'new' | 'contacted' | 'following_up' | 'responded' | 'booked' | 'dead' | 'engaged' | 'qualified' | 'escalated';
export type ConversionStage = 'new' | 'engaged' | 'qualified' | 'link_sent' | 'awaiting_form' | 'booked' | 'dead';
export type UrgencyLevel = 'low' | 'normal' | 'high' | 'emergency';
export type BookingReadiness = 'unknown' | 'browsing' | 'considering' | 'ready' | 'booked';

// --- Message types ---
export type MessageDirection = 'outbound' | 'inbound';
export type MessageChannel = 'email' | 'sms' | 'manual' | 'messenger';
export type ChannelType = 'messenger' | 'comment' | 'public_reply' | 'private_message' | 'email' | 'sms' | 'manual';
export type MessageStatus = 'draft' | 'sent' | 'delivered' | 'failed';

// --- Follow-up types ---
export type FollowUpStatus = 'pending' | 'sent' | 'skipped' | 'cancelled';

// --- Settings types ---
export type AiTone = 'professional' | 'friendly' | 'casual' | 'urgent' | 'conversational';
export type FirstReplyBehaviour = 'smart_reply' | 'simple_ack' | 'disabled';

// --- AI classification types ---
export type Intent =
  | 'pricing_question'
  | 'service_area_question'
  | 'repair_request'
  | 'install_request'
  | 'booking_request'
  | 'emergency_request'
  | 'general_question'
  | 'quote_request'
  | 'follow_up_reply'
  | 'not_interested'
  | 'spam'
  | 'greeting'
  | 'thank_you'
  | 'complaint'
  | 'unknown';

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'angry';

// --- Conversation engine types ---
export type NextAction =
  | 'answer_question'
  | 'ask_location'
  | 'ask_job_type'
  | 'ask_urgency'
  | 'ask_details'
  | 'send_enquiry_link'
  | 'follow_up_soft'
  | 'follow_up_last_attempt'
  | 'escalate_to_human'
  | 'close_out'
  | 'welcome_new'
  | 'reply_to_comment'
  | 'prompt_to_message';

// ============================================
// Database models
// ============================================

export interface Lead {
  id: string;
  user_id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  source: string;
  status: LeadStatus;
  notes: string | null;
  last_contacted_at: string | null;
  created_at: string;
  updated_at: string;
  // v2 fields
  platform_user_id: string | null;
  platform_thread_id: string | null;
  source_post_id: string | null;
  source_comment_id: string | null;
  conversion_stage: ConversionStage;
  enquiry_link_sent_at: string | null;
  enquiry_form_completed: boolean;
  location_text: string | null;
  detected_service_type: string | null;
  detected_job_type: string | null;
  urgency_level: UrgencyLevel;
  booking_readiness: BookingReadiness;
  requires_human_review: boolean;
  escalation_reason: string | null;
  ai_confidence: number | null;
  qualification_data: QualificationData;
  page_id: string | null;
  // Comment automation fields
  first_comment_id: string | null;
  comment_count: number;
  private_reply_count: number;
  last_comment_at: string | null;
}

export interface QualificationData {
  location?: string;
  job_type?: string;      // install | repair | service | maintenance
  service_type?: string;  // split | ducted | multi-head | etc.
  urgency?: string;
  details?: string;
  appliance_type?: string;
  preferred_timing?: string;
  [key: string]: string | undefined;
}

export interface Message {
  id: string;
  lead_id: string;
  user_id: string;
  direction: MessageDirection;
  channel: MessageChannel;
  channel_type: ChannelType;
  subject: string | null;
  body: string;
  status: MessageStatus;
  sent_at: string | null;
  created_at: string;
  // v2 fields
  platform_message_id: string | null;
  intent: Intent | null;
  ai_generated: boolean;
  metadata: Record<string, unknown>;
}

export interface FollowUp {
  id: string;
  lead_id: string;
  user_id: string;
  step_number: number;
  scheduled_at: string;
  executed_at: string | null;
  status: FollowUpStatus;
  message_id: string | null;
  created_at: string;
}

export interface Settings {
  id: string;
  user_id: string;
  // Follow-up config
  max_follow_ups: number;
  follow_up_interval_days: number;
  stop_on_reply: boolean;
  // AI config
  ai_tone: AiTone;
  ai_style_instructions: string | null;
  first_reply_behaviour: FirstReplyBehaviour;
  // Business info
  business_name: string | null;
  business_description: string | null;
  signature: string | null;
  service_type: string | null;
  service_areas: string[];
  service_categories: string[];
  callout_fee: string | null;
  quote_policy: string | null;
  emergency_available: boolean;
  after_hours_available: boolean;
  operating_hours: string | null;
  enquiry_form_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  // Meta config
  meta_page_id: string | null;
  meta_verify_token: string | null;
  // Automation config (legacy)
  comment_auto_reply: boolean;
  comment_reply_templates: string[];
  dm_automation_enabled: boolean;
  escalation_keywords: string[];
  // Comment automation v2
  comment_monitoring_enabled: boolean;
  private_reply_enabled: boolean;
  public_reply_enabled: boolean;
  private_reply_templates: string[];
  comment_lead_keywords: string[];
  comment_confidence_threshold: number;
  comment_escalation_threshold: number;
  comment_cooldown_minutes: number;
  // Timestamps
  created_at: string;
  updated_at: string;
}

export interface FaqEntry {
  id: string;
  user_id: string;
  question: string;
  answer: string;
  category: string;
  keywords: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface AiClassification {
  id: string;
  message_id: string;
  lead_id: string;
  intent: Intent;
  urgency: UrgencyLevel;
  service_type: string | null;
  location_mention: string | null;
  booking_readiness: BookingReadiness;
  pricing_sensitivity: boolean;
  sentiment: Sentiment;
  entities: ExtractedEntities;
  confidence: number;
  created_at: string;
}

export interface ExtractedEntities {
  suburb?: string;
  job_type?: string;
  urgency?: string;
  appliance_type?: string;
  preferred_timing?: string;
  service_category?: string;
  [key: string]: string | undefined;
}

export interface AutomationLog {
  id: string;
  lead_id: string | null;
  event_type: string;
  channel: string | null;
  action_taken: string | null;
  details: Record<string, unknown>;
  success: boolean;
  error_message: string | null;
  created_at: string;
}

export interface ConversationEvent {
  id: string;
  lead_id: string;
  event_type: string;
  from_stage: string | null;
  to_stage: string | null;
  action: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface MetaPage {
  id: string;
  user_id: string;
  page_id: string;
  page_name: string | null;
  access_token: string;
  is_active: boolean;
  subscribed_fields: string[];
  created_at: string;
  updated_at: string;
}

// ============================================
// Webhook event types (normalized)
// ============================================

export interface NormalizedWebhookEvent {
  type: 'message' | 'comment';
  pageId: string;
  senderId: string;
  text: string;
  timestamp: number;
  platformMessageId?: string;
  // Comment-specific
  postId?: string;
  commentId?: string;
  parentCommentId?: string;
  isReply?: boolean;
}

// ============================================
// Conversation engine types
// ============================================

export interface ConversationContext {
  lead: Lead;
  settings: Settings;
  classification: AiClassification;
  recentMessages: Message[];
  faqEntries: FaqEntry[];
}

export interface ConversationResult {
  replyText: string;
  nextAction: NextAction;
  stageTransition?: { from: ConversionStage; to: ConversionStage };
  shouldSendEnquiryLink: boolean;
  shouldEscalate: boolean;
  escalationReason?: string;
  updatedQualification: QualificationData;
  aiConfidence: number;
}

// Dashboard stats
export interface DashboardStats {
  totalLeads: number;
  activeFollowUps: number;
  respondedLeads: number;
  bookedLeads: number;
  responseRate: number;
  leadsByStatus: Record<LeadStatus, number>;
}
