// ============================================
// Lead Matching Service
// Finds or creates leads from Facebook comments
// Links commenters to existing Messenger leads
// ============================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getUserProfile } from "../meta/client";
import type { Lead } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;

function getServiceClient(): DB {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL",
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============================================
// Types
// ============================================

export interface CommentLeadContext {
  pageId: string;
  postId: string;
  commentId: string;
  commenterPlatformId: string;
  commenterName?: string;
  source: "facebook_comment";
}

export interface LeadMatchResult {
  lead: Lead;
  isNew: boolean;
  wasMessengerLead: boolean;  // Was this person already a Messenger lead?
}
