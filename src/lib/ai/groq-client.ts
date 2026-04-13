// ============================================
// Groq API Client — OpenAI-compatible chat completions
// Free tier: 30 RPM, 14,400 RPD, 131,072 context
// ============================================

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqResponse {
  id: string;
  choices: {
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface GroqOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  responseFormat?: { type: "json_object" } | { type: "text" };
}

/**
 * Call Groq chat completions API.
 * Returns the assistant's reply text, or null on failure.
 */
export async function groqChat(
  messages: ChatMessage[],
  options: GroqOptions = {}
): Promise<string | null> {
  if (!GROQ_API_KEY) {
    console.error("GROQ_API_KEY not configured");
    return null;
  }

  const {
    model = DEFAULT_MODEL,
    maxTokens = 300,
    temperature = 0.4,
    topP = 0.9,
    responseFormat,
  } = options;

  try {
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
    };

    if (responseFormat) {
      body.response_format = responseFormat;
    }

    const response = await fetch(GROQ_BASE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Groq API error ${response.status}:`, errorText);
      return null;
    }

    const data: GroqResponse = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error("Groq API call failed:", error);
    return null;
  }
}

/**
 * Call Groq with JSON mode for structured outputs.
 * Returns parsed JSON or null on failure.
 */
export async function groqJson<T>(
  messages: ChatMessage[],
  options: Omit<GroqOptions, "responseFormat"> = {}
): Promise<T | null> {
  const result = await groqChat(messages, {
    ...options,
    responseFormat: { type: "json_object" },
  });

  if (!result) return null;

  try {
    return JSON.parse(result) as T;
  } catch (error) {
    console.error("Failed to parse Groq JSON response:", result, error);
    return null;
  }
}
