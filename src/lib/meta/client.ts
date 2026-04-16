// ============================================
// Meta Graph API Base Client
// Shared utilities for Messenger + Comments
// Supports multi-tenant via BusinessContext or env-var fallback
// ============================================

const GRAPH_API_VERSION = "v25.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * Get the page access token for a given page ID.
 * Priority:
 *   1. Explicit token passed in (from BusinessContext)
 *   2. META_PAGE_TOKENS JSON map (env var)
 *   3. META_PAGE_TOKEN fallback (env var)
 */
export function getPageToken(pageId?: string, explicitToken?: string): string {
  // If caller already resolved the token (multi-tenant path), use it directly
  if (explicitToken) return explicitToken;

  if (pageId && process.env.META_PAGE_TOKENS) {
    try {
      const tokens = JSON.parse(process.env.META_PAGE_TOKENS);
      if (tokens[pageId]) return tokens[pageId];
    } catch (e) {
      console.error("Failed to parse META_PAGE_TOKENS:", e);
    }
  }

  if (process.env.META_PAGE_TOKEN) {
    return process.env.META_PAGE_TOKEN;
  }

  throw new Error("No page token found. Set META_PAGE_TOKENS or META_PAGE_TOKEN env var.");
}

/**
 * Generic Meta Graph API call.
 */
export async function graphApi(
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    token: string;
  }
): Promise<unknown> {
  const { method = "GET", body, token } = options;
  const url = `${GRAPH_BASE}${path}${path.includes("?") ? "&" : "?"}access_token=${token}`;

  const fetchOptions: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body && method !== "GET") {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    console.error(`Meta API ${method} ${path} error:`, response.status, errorData);
    throw new MetaApiError(
      `Meta API error ${response.status}: ${JSON.stringify(errorData)}`,
      response.status,
      errorData
    );
  }

  return response.json();
}

export class MetaApiError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "MetaApiError";
    this.status = status;
    this.data = data;
  }
}

/**
 * Fetch user profile from Meta Graph API.
 */
export async function getUserProfile(
  userId: string,
  pageId?: string
): Promise<{ first_name: string; last_name: string } | null> {
  const token = getPageToken(pageId);
  try {
    const data = await graphApi(`/${userId}?fields=first_name,last_name`, { token }) as { first_name: string; last_name: string };
    return data;
  } catch {
    return null;
  }
}
