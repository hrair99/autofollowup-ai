// ============================================
// Groq API Client â€” OpenAI-compatible chat completions
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
  
eeÑU O'urn to public fallback gracefully if private reply fails
  * 3. Always like the comment for engagement
 */
