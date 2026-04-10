// ============================================
// Meta Messenger API Helper
// Supports multiple pages via META_PAGE_TOKENS JSON env var
// ============================================

const GRAPH_API_VERSION = "v25.0";

/**
 * Get the page access token for a given page ID.
 * Checks META_PAGE_TOKENS (JSON map) first, then falls back to META_PAGE_TOKEN.
 */
export function getPageToken(pageId?: string): string {
  // Try the JSON map of page tokens first
  if (pageId && process.env.META_PAGE_TOKENS) {
    try {
      const tokens = JSON.parse(process.env.META_PAGE_TOKENS);
      if (tokens[pageId]) return tokens[pageId];
    } catch (e) {
      console.error("Failed to parse META_PAGE_TOKENS:", e);
    }
  }

  // Fallback to the single token
  if (process.env.META_PAGE_TOKEN) {
    return process.env.META_PAGE_TOKEN;
  }

  throw new Error("No page token found. Set META_PAGE_TOKENS or META_PAGE_TOKEN env var.");
}

export async function sendMessage(recipientId: string, text: string, pageId?: string) {
  const token = getPageToken(pageId);

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${token}`,
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

export async function sendTypingIndicator(recipientId: string, action: "typing_on" | "typing_off" = "typing_on", pageId?: string) {
  const token = getPageToken(pageId);

  await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${token}`,
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

export async function getUserProfile(userId: string, pageId?: string): Promise<{ first_name: string; last_name: string } | null> {
  const token = getPageToken(pageId);

  try {
    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${userId}?fields=first_name,last_name&access_token=${token}`
    );
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}
