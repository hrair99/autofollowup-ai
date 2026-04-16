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
import { getTemplateReply, generateAiPublicReply } from "@/lib/meta/publicReplies";
import { getBusinessProfile } from "@/lib/business/profiles";

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

  // Generate public reply
  let publicReply = await generateAiPublicReply(comment, {
    classification: classification.classification,
    businessName,
    enquiryFormUrl: (settings as any)?.enquiry_form_url || undefined,
    tone: (settings as any)?.ai_tone || profile.defaultTone,
    serviceType: classification.service_type || undefined,
    serviceAreas: (settings as any)?.service_areas || profile.defaultServiceAreas,
    location: classification.location || undefined,
    urgency: classification.urgency || undefined,
    profile,
  });

  if (!publicReply) {
    publicReply = getTemplateReply(classification.classification, {
      enquiryFormUrl: (settings as any)?.enquiry_form_url || undefined,
      businessName,
      profile,
    });
  }

  // Generate DM preview
  const dmTemplates = profile.dmTemplates[classification.classification] || profile.dmTemplates["default"] || [];
  let dmPreview = dmTemplates.length > 0
    ? dmTemplates[Math.floor(Math.random() * dmTemplates.length)]
    : `Hey! Thanks for reaching out to ${businessName}. How can we help you today?`;

  // Replace placeholders
  dmPreview = dmPreview
    .replace(/\{name\}/g, "Customer")
    .replace(/\{business_name\}/g, businessName)
    .replace(/\{service_areas\}/g, ((settings as any)?.service_areas || profile.defaultServiceAreas || []).join(", "));

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
    wouldAutoReply: classification.confidence >= 0.60 && classification.is_lead_signal,
    confidenceTier: classification.confidence >= 0.85 ? "high" : classification.confidence >= 0.60 ? "safe" : "low",
  });
}
