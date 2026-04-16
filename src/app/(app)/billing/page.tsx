import { createServerSupabase } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import BillingClient from "./BillingClient";

export default async function BillingPage() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: ub } = await supabase
    .from("user_businesses")
    .select("business_id")
    .eq("user_id", user.id)
    .single();

  if (!ub) redirect("/login");

  const { data: biz } = await supabase
    .from("businesses")
    .select("id, plan, subscription_status, stripe_customer_id, stripe_subscription_id")
    .eq("id", ub.business_id)
    .single();

  // Get usage
  const period = new Date().toISOString().slice(0, 7);
  const { data: usage } = await supabase
    .from("business_usage")
    .select("*")
    .eq("business_id", ub.business_id)
    .eq("period", period)
    .maybeSingle();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your subscription and view usage.
        </p>
      </div>
      <BillingClient
        plan={biz?.plan || "free"}
        subscriptionStatus={biz?.subscription_status || "none"}
        hasStripeCustomer={!!biz?.stripe_customer_id}
        usage={{
          comments: usage?.comments_processed || 0,
          dms: usage?.dms_sent || 0,
          aiCalls: usage?.ai_calls || 0,
        }}
      />
    </div>
  );
}
