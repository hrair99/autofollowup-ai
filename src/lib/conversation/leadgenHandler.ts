// ============================================
// Leadgen Handler — Process Facebook Lead Ad submissions
// When someone fills out an instant form on a boosted ad,
// fetch their data and DM them on Messenger.
// ============================================

import { createClient } from "@supabase/supabase-js";
import type { NormalizedWebhookEvent } from "../types";
import {
  fetchLeadgenData,
  parseLeadFields,
  type ParsedLeadFields,
} from "../meta/leadgen";
import { sendMessage, sendButtonMessage } from "../meta/messenger";
import { getUserProfile } from "../meta/client";

type DB = ReturnType<typeof createClient>;

function getSupabase(): DB {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Main entry point: handle a leadgen webhook event.
 *
 * Flow:
 * 1. Fetch lead data from Meta Graph API
 * 2. Parse form fields
 * 3. Store in Supabase (leadgen_submissions + leads)
 * 4. DM the user on Messenger with a personalised greeting
 * 5. Log the automation action
 */
export async function handleLeadgen(
  event: NormalizedWebhookEvent
): Promise<void> {
  const { pageId, leadgenId, formId, adId } = event;

  if (!leadgenId) {
    console.error("[Leadgen] Missing leadgen_id, skipping");
    return;
  }

  console.log(
    `[Leadgen] Processing lead ${leadgenId} from form ${formId ?? "?"}`
  );

  const supabase = getSupabase();

  // --- 1. Deduplication: check if we already processed this leadgen_id ---
  const { data: existing } = await supabase
    .from("leadgen_submissions")
    .select("id")
    .eq("leadgen_id", leadgenId)
    .maybeSingle();

  if (existing) {
    console.log(`[Leadgen] Already processed ${leadgenId}, skipping`);
    return;
  }

  // --- 2. Fetch lead data from Meta ---
  let leadData;
  let parsedFields: ParsedLeadFields;
  try {
    leadData = await fetchLeadgenData(leadgenId, pageId);
    parsedFields = parseLeadFields(leadData.field_data);
    console.log(
      `[Leadgen] Fetched lead: ${parsedFields.fullName || parsedFields.firstName || "unknown"}, email=${parsedFields.email}, phone=${parsedFields.phone}`
    );
  } catch (err) {
    console.error(`[Leadgen] Failed to fetch lead data for ${leadgenId}:`, err);
    // Store failed attempt for debugging
    await supabase.from("leadgen_submissions").insert({
      leadgen_id: leadgenId,
      page_id: pageId,
      form_id: formId,
      ad_id: adId,
      status: "fetch_failed",
      error_message: String(err),
      raw_field_data: {},
    });
    return;
  }

  // --- 3. Load settings ---
  const settings = await loadSettings(supabase);
  if (!settings) {
    console.error("[Leadgen] No settings found, cannot process lead");
    return;
  }

  // --- 4. Determine the user's platform-scoped ID for DM ---
  // Meta leadgen webhooks include the page-scoped user ID in the lead data
  // We need it to send Messenger DMs
  const platformUserId = leadData.platform_user_id || null;

  // Build the lead name
  const leadName =
    parsedFields.fullName ||
    [parsedFields.firstName, parsedFields.lastName].filter(Boolean).join(" ") ||
    "there";

  // --- 5. Store the submission in Supabase ---
  const { data: submission, error: insertError } = await supabase
    .from("leadgen_submissions")
    .insert({
      leadgen_id: leadgenId,
      page_id: pageId,
      form_id: formId,
      ad_id: adId,
      adset_id: leadData.adset_id || null,
      campaign_id: leadData.campaign_id || null,
      platform_user_id: platformUserId,
      full_name: parsedFields.fullName,
      first_name: parsedFields.firstName,
      last_name: parsedFields.lastName,
      email: parsedFields.email,
      phone: parsedFields.phone,
      suburb: parsedFields.suburb,
      service_type: parsedFields.serviceType,
      job_description: parsedFields.jobDescription,
      raw_field_data: parsedFields.raw,
      status: "received",
      created_at: leadData.created_time || new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("[Leadgen] Failed to store submission:", insertError);
  }

  // --- 6. Create/update lead in main leads table ---
  const leadId = await upsertLead(supabase, {
    userId: settings.user_id,
    pageId,
    platformUserId,
    name: leadName === "there" ? "Lead Ad Submission" : leadName,
    email: parsedFields.email,
    phone: parsedFields.phone,
    suburb: parsedFields.suburb,
    serviceType: parsedFields.serviceType,
    jobDescription: parsedFields.jobDescription,
    leadgenId,
    formId,
  });

  // --- 7. DM the user on Messenger ---
  let dmSent = false;
  let dmError: string | null = null;

  if (platformUserId) {
    try {
      // Try to get their profile for personalisation
      const profile = await getUserProfile(platformUserId, pageId);
      const firstName = profile?.first_name || parsedFields.firstName || "there";

      const businessName = settings.business_name || "us";
      const enquiryUrl = settings.enquiry_form_url;

      // Compose the DM
      const greeting = buildLeadgenDM(firstName, businessName, parsedFields);

      if (enquiryUrl) {
        // Send with button to enquiry form
        await sendButtonMessage(
          platformUserId,
          greeting,
          [
            {
              type: "web_url",
              url: enquiryUrl,
              title: "Book Now",
            },
          ],
          pageId
        );
      } else {
        await sendMessage(platformUserId, greeting, pageId);
      }

      dmSent = true;
      console.log(
        `[Leadgen] DM sent to ${platformUserId} (${firstName}) for lead ${leadgenId}`
      );
    } catch (err) {
      dmError = String(err);
      console.error(
        `[Leadgen] Failed to DM ${platformUserId}:`,
        err
      );
    }
  } else {
    dmError = "no_platform_user_id";
    console.warn(
      `[Leadgen] No platform_user_id for lead ${leadgenId} — cannot DM`
    );
  }

  // --- 8. Update submission status ---
  if (submission?.id) {
    await supabase
      .from("leadgen_submissions")
      .update({
        status: dmSent ? "dm_sent" : "dm_failed",
        dm_sent_at: dmSent ? new Date().toISOString() : null,
        error_message: dmError,
        lead_id: leadId,
      })
      .eq("id", submission.id);
  }

  // --- 9. Log automation event ---
  await supabase.from("automation_logs").insert({
    lead_id: leadId,
    event_type: "leadgen_processed",
    channel: "leadgen",
    channel_type: "leadgen",
    action_taken: dmSent ? "dm_sent" : platformUserId ? "dm_failed" : "no_user_id",
    details: {
      leadgen_id: leadgenId,
      form_id: formId,
      ad_id: adId,
      name: leadName,
      email: parsedFields.email,
      phone: parsedFields.phone,
      dm_sent: dmSent,
      dm_error: dmError,
    },
    success: dmSent,
    error_message: dmError,
  });

  console.log(
    `[Leadgen] Done processing ${leadgenId}: dm_sent=${dmSent}, lead_id=${leadId}`
  );
}

// ============================================
// Helpers
// ============================================

/**
 * Load the first user's settings (single-tenant for now).
 */
async function loadSettings(supabase: DB) {
  const { data: users } = await supabase.auth.admin.listUsers();
  const userId = users?.users?.[0]?.id;
  if (!userId) return null;

  const { data } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", userId)
    .single();

  return data as (Record<string, unknown> & { user_id: string; business_name: string | null; enquiry_form_url: string | null }) | null;
}

/**
 * Find or create a lead for this form submission.
 */
async function upsertLead(
  supabase: DB,
  input: {
    userId: string;
    pageId: string;
    platformUserId: string | null;
    name: string;
    email: string | null;
    phone: string | null;
    suburb: string | null;
    serviceType: string | null;
    jobDescription: string | null;
    leadgenId: string;
    formId: string | null;
  }
): Promise<string | null> {
  try {
    // Try to match existing lead by platform_user_id
    if (input.platformUserId) {
      const { data: existing } = await supabase
        .from("leads")
        .select("id")
        .eq("platform_user_id", input.platformUserId)
        .eq("page_id", input.pageId)
        .maybeSingle();

      if (existing) {
        // Update existing lead with new form data
        await supabase
          .from("leads")
          .update({
            phone: input.phone || undefined,
            location_text: input.suburb || undefined,
            detected_service_type: input.serviceType || undefined,
            notes: input.jobDescription
              ? `Lead Ad: ${input.jobDescription}`
              : undefined,
            source: "lead_ad",
            status: "new",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);

        return existing.id;
      }
    }

    // Create new lead
    const email =
      input.email || `leadad_${input.leadgenId}@meta.local`;

    const { data: newLead, error } = await supabase
      .from("leads")
      .insert({
        user_id: input.userId,
        name: input.name,
        email,
        phone: input.phone,
        source: "lead_ad",
        status: "new",
        platform_user_id: input.platformUserId,
        page_id: input.pageId,
        location_text: input.suburb,
        detected_service_type: input.serviceType,
        notes: input.jobDescription
          ? `Lead Ad: ${input.jobDescription}`
          : null,
        conversion_stage: "new",
        urgency_level: "normal",
        booking_readiness: "considering",
        qualification_data: {
          source: "lead_ad",
          form_id: input.formId,
          suburb: input.suburb,
          service_type: input.serviceType,
          job_description: input.jobDescription,
        },
      })
      .select("id")
      .single();

    if (error) {
      console.error("[Leadgen] Failed to create lead:", error);
      return null;
    }

    return newLead?.id ?? null;
  } catch (err) {
    console.error("[Leadgen] upsertLead error:", err);
    return null;
  }
}

/**
 * Build a personalised DM for the lead ad submission.
 */
function buildLeadgenDM(
  firstName: string,
  businessName: string,
  fields: ParsedLeadFields
): string {
  const parts: string[] = [];

  parts.push(
    `Hey ${firstName}! Thanks for reaching out to ${businessName} through our ad.`
  );

  if (fields.serviceType) {
    parts.push(
      `We've received your enquiry about ${fields.serviceType}.`
    );
  } else {
    parts.push(`We've received your enquiry and we're on it!`);
  }

  if (fields.suburb) {
    parts.push(`We service the ${fields.suburb} area.`);
  }

  parts.push(
    `One of our team will be in touch shortly. In the meantime, feel free to send us any questions right here!`
  );

  return parts.join(" ");
}
