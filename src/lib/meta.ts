// ============================================
// Meta Messenger API Helper
// ============================================

const GRAPH_API_VERSION = "v18.0";

export async function sendMessage(recipientId: string, text: string) {
  const PAGE_ACCESS_TOKEN = process.env.META_PAGE_TOKEN!;

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    console.error("Meta send error:", error);
    throw new Error(`Failed to send message: ${JSON.stringify(error)}`);
  }

  return response.json();
}

export async function sendTypingIndicator(recipientId: string, action: "typing_on" | "typing_off" = "typing_on") {
  const PAGE_ACCESS_TOKEN = process.env.META_PAGE_TOKEN!;

  await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        sender_action: action,
      }),
    }
  );
}

export async function getUserProfile(userId: string): Promise<{ first_name: string; last_name: string } | null> {
  const PAGE_ACCESS_TOKEN = process.env.META_PAGE_TOKEN!;

  try {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${userId}?fields=first_name,last_name&access_token=${PAGE_ACCESS_TOKEN}`
    );
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}
