// ============================================
// Meta Lead Ads — Fetch lead form submission data
// ============================================

import { getPageToken, graphApi } from "./client";

/**
 * Raw lead data returned by Graph API GET /{leadgen_id}
 */
export interface LeadgenData {
  id: string;
  created_time: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  form_id: string;
  field_data: Array<{
    name: string;
    values: string[];
  }>;
  // Platform-scoped user ID (only if user granted permission)
  platform_user_id?: string;
  // Retailer-scoped user ID
  retailer_item_id?: string;
}

/**
 * Parsed lead fields from the form submission.
 */
export interface ParsedLeadFields {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  suburb: string | null;
  serviceType: string | null;
  jobDescription: string | null;
  /** All raw field_data as a flat key→value map */
  raw: Record<string, string>;
}

/**
 * Fetch lead data from Meta Graph API.
 * Requires `leads_retrieval` permission on the page token.
 *
 * GET /{leadgen_id}?fields=id,created_time,ad_id,adset_id,campaign_id,form_id,field_data
 */
export async function fetchLeadgenData(
  leadgenId: string,
  pageId?: string
): Promise<LeadgenData> {
  const token = getPageToken(pageId);
  const fields =
    "id,created_time,ad_id,adset_id,campaign_id,form_id,field_data";
  const data = (await graphApi(`/${leadgenId}?fields=${fields}`, {
    token,
  })) as LeadgenData;
  return data;
}

/**
 * Parse raw field_data into structured lead fields.
 * Handles common Meta lead form field names:
 *   full_name, first_name, last_name, email, phone_number,
 *   city, zip_code, state, and any custom fields.
 */
export function parseLeadFields(fieldData: LeadgenData["field_data"]): ParsedLeadFields {
  const raw: Record<string, string> = {};
  for (const field of fieldData) {
    raw[field.name] = field.values[0] ?? "";
  }

  // Meta standard field names
  const fullName = raw["full_name"] || null;
  const firstName = raw["first_name"] || null;
  const lastName = raw["last_name"] || null;
  const email = raw["email"] || null;
  const phone = raw["phone_number"] || raw["phone"] || null;

  // Custom fields (HR AIR specific — match by partial name)
  const suburb =
    raw["suburb"] ||
    raw["city"] ||
    raw["location"] ||
    findField(raw, "suburb") ||
    null;
  const serviceType =
    raw["service_type"] ||
    raw["service"] ||
    findField(raw, "service") ||
    null;
  const jobDescription =
    raw["job_description"] ||
    raw["description"] ||
    raw["message"] ||
    findField(raw, "description") ||
    findField(raw, "job") ||
    null;

  return {
    fullName,
    firstName,
    lastName,
    email,
    phone,
    suburb,
    serviceType,
    jobDescription,
    raw,
  };
}

/**
 * Find a field whose key contains the given substring (case-insensitive).
 */
function findField(raw: Record<string, string>, substring: string): string | undefined {
  const key = Object.keys(raw).find((k) =>
    k.toLowerCase().includes(substring.toLowerCase())
  );
  return key ? raw[key] : undefined;
}

/**
 * Fetch lead form name/questions for context.
 * GET /{form_id}?fields=id,name,questions
 */
export async function fetchLeadFormMeta(
  formId: string,
  pageId?: string
): Promise<{ id: string; name: string; questions?: unknown[] } | null> {
  try {
    const token = getPageToken(pageId);
    const data = (await graphApi(`/${formId}?fields=id,name`, {
      token,
    })) as { id: string; name: string; questions?: unknown[] };
    return data;
  } catch {
    console.warn(`[Leadgen] Could not fetch form metadata for ${formId}`);
    return null;
  }
}
