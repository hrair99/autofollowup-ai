// ============================================
// Test Reply — POST /api/onboarding/test-reply
// Simulates comment classification and reply generation
// without actually posting anything. Used during onboarding
// to show users how the system works.
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getUserBusinessId, loadBusinessSettings } from "@/lib/business/resolve";
import { classifyComment } from "@/lib/ai/commentClassifier";
import { getTemplateReply, generateAiPublicReply, generateAiDmReply } from "@/lib/meta/publicReplies";
import { getBusinessProfile, getProfileDmTemplate } from "@/lib/business/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = await getUserBusinessId(user.id);
  if (!businessId) {
    return NextResponse.json({ error: "No business found" }, { status: 404 });
  }

  const body = await req.json();
  const { comment } = body;

  if (!comment || typeof comment !== "string" || comment.trim().length === 0) {
    return NextResponse.json({ error: "comment is required" }, { status: 400 });
  }

  // Load business context
  const [settings, profile] = await Promise.all([
    loadBusinessSettings(businessId),
    getBusinessProfile(businessId),
  ]);

  const businessName = (settings as any)?.business_name || "Your Business";
  const serviceAreas = (settings as any)?.service_areas || profile.defaultServiceAreas || [];
  const enquiryFormUrl = (settings as any)?.enquiry_form_url || undefined;
  const tone = (settings as any)?.ai_tone || profile.defaultTone;

  // Classify the comment
  const classification = await classifyComment(comment, {
    businessContext: {
      businessName,
      businessDescription: (settings as any)?.business_description || undefined,
      serviceType: (settings as any)?.service_type || undefined,
      serviceCategories: profile.serviceCategories,
      profile,
    },
  });

  // Generate AI public reply (with entities for smarter context)
  let publicReply = await generateAiPublicReply(comment, {
    classification: classification.classification,
    businessName,
    enquiryFormUrl,
    tone,
    serviceType: classification.service_type || undefined,
    serviceAreas,
    location: classification.location || undefined,
    urgency: classification.urgency || undefined,
    profile,
    entities: classification.entities,
    commenterName: undefined, // No commenter name in test mode
  });

  if (!publicReply) {
    publicReply = getTemplateReply(classification.classification, {
      enquiryFormUrl,
      businessName,
      profile,
    });
  }

  // Generate AI DM preview (much smarter than templates)
  let dmPreview = await generateAiDmReply(comment, {
    classification: classification.classification,
    businessName,
    commenterName: "Customer", // Placeholder for test mode
    enquiryFormUrl,
    tone,
    serviceAreas,
    urgency: classification.urgency || undefined,
    profile,
    entities: classification.entities,
  });

  // Fall back to template if AI DM fails
  if (!dmPreview) {
    let template = getProfileDmTemplate(classification.classification, profile);
    dmPreview = template
      .replace(/\{name\}/g, "Customer")
      .replace(/\{business_name\}/g, businessName)
      .replace(/\{service_areas\}/g, serviceAreas.join(", "));
  }

  // Determine what would happen in production
  const isLead = classification.is_lead_signal;
  const confidence = classification.confidence;
  const confidenceTier = confidence >= 0.85 ? "high" : confidence >= 0.60 ? "safe" : "low";
  const wouldAutoReply = confidence >= 0.60 && isLead;

  // Build a human-readable explanation of what would happen
  let actionExplanation = "";
  if (!isLead) {
    actionExplanation = "This comment wouldn't trigger any action — it doesn't look like a lead.";
  } else if (confidenceTier === "high") {
    actionExplanation = "This comment would get an automatic public reply AND a private DM — high confidence lead.";
  } else if (confidenceTier === "safe") {
    actionExplanation = "This comment would get an automatic public reply AND a private DM — moderate confidence.";
  } else {
    actionExplanation = "This comment would be logged as a potential lead but NOT auto-replied (low confidence). You'd see it in your alerts for manual review.";
  }

  return NextResponse.json({
    classification: {
      type: classification.classification,
      confidence: classification.confidence,
      isLead: classification.is_lead_signal,
      method: classification.method,
      reasoning: classification.reasoning,
    },
    entities: classification.entities,
    publicReply,
    dmPreview,
    wouldAutoReply,
    confidenceTier,
    actionExplanation,
  });
}
