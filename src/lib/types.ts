// ============================================
// Database types for AutoFollowUp AI
// ============================================

export type LeadStatus = 'new' | 'contacted' | 'following_up' | 'responded' | 'booked' | 'dead';
export type MessageDirection = 'outbound' | 'inbound';
export type MessageChannel = 'email' | 'sms' | 'manual';
export type MessageStatus = 'draft' | 'sent' | 'delivered' | 'failed';
export type FollowUpStatus = 'pending' | 'sent' | 'skipped' | 'cancelled';
export type AiTone = 'professional' | 'friendly' | 'casual' | 'urgent';

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
}

export interface Message {
  id: string;
  lead_id: string;
  user_id: string;
  direction: MessageDirection;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  status: MessageStatus;
  sent_at: string | null;
  created_at: string;
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
  max_follow_ups: number;
  follow_up_interval_days: number;
  stop_on_reply: boolean;
  ai_tone: AiTone;
  business_name: string | null;
  business_description: string | null;
  signature: string | null;
  created_at: string;
  updated_at: string;
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
