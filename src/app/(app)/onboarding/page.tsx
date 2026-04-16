import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import OnboardingFlow from "./OnboardingFlow";

export default async function OnboardingPage() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Get business
  const { data: ub } = await supabase
    .from("user_businesses")
    .select("business_id")
    .eq("user_id", user.id)
    .single();

  if (!ub) redirect("/login");

  // Get business state
  const { data: biz } = await supabase
    .from("businesses")
    .select("id, business_name, name, onboarding_completed, onboarding_step, meta_user_token, mode")
    .eq("id", ub.business_id)
    .single();

  if (biz?.onboarding_completed) redirect("/dashboard");

  // Get connected pages
  const { data: pages } = await supabase
    .from("business_pages")
    .select("page_id, page_name, is_active")
    .eq("business_id", ub.business_id);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto py-12 px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Let&apos;s get you set up
          </h1>
          <p className="mt-2 text-gray-600">
            4 quick steps and your Facebook automation is live.
          </p>
        </div>
        <OnboardingFlow
          businessId={biz?.id || ub.business_id}
          businessName={biz?.business_name || biz?.name || ""}
          hasToken={!!biz?.meta_user_token}
          connectedPages={(pages || []).filter((p) => p.is_active)}
          currentStep={biz?.onboarding_step || "connect_facebook"}
          mode={biz?.mode || "monitor"}
        />
      </div>
    </div>
  );
}
