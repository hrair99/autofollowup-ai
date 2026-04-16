import { createServerSupabase } from "@/lib/supabase/server";
import { getUserBusinessId } from "@/lib/business/resolve";
import ConnectFlow from "./ConnectFlow";

export default async function ConnectPage() {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const businessId = user ? await getUserBusinessId(user.id) : null;

  // Check if business has a user token already
  let hasToken = false;
  let connectedPages: Array<{
    page_id: string;
    page_name: string;
    is_active: boolean;
    token_status: string;
  }> = [];

  if (businessId) {
    const { data: biz } = await supabase
      .from("businesses")
      .select("meta_user_token")
      .eq("id", businessId)
      .single();

    hasToken = !!biz?.meta_user_token;

    const { data: pages } = await supabase
      .from("business_pages")
      .select("page_id, page_name, is_active, token_status")
      .eq("business_id", businessId);

    connectedPages = pages || [];
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Connect Facebook Page
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect your Facebook page to enable automated comment replies,
          Messenger responses, and lead tracking.
        </p>
      </div>

      <ConnectFlow
        hasToken={hasToken}
        connectedPages={connectedPages}
        businessId={businessId || ""}
      />
    </div>
  );
}
