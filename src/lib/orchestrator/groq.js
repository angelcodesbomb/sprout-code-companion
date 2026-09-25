/**
 * Groq LLM Wrapper
 * ================
 * Thin wrapper around Groq's OpenAI-compatible chat completions endpoint.
 * Supports tool-calling (parallel_tool_calls disabled so the model picks exactly one tool).
 *
 * Model is read from process.env.GROQ_MODEL.
 * Default: "openai/gpt-oss-120b"  (tool-calling capable, free tier)
 *
 * DO NOT hardcode a model string anywhere else in the codebase.
 * Always import getModel() or GROQ_MODEL from this file so a swap is a
 * single config change in .env.local.
 *
 * Usage:
 *   import { callGroqWithTools } from "@/lib/orchestrator/groq.js";
 *
 *   const pick = await callGroqWithTools(messages, toolDefs);
 *   // pick: { toolName: string, toolInput: object } | { done: true, content: string }
 */

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * The active model name.  Single source of truth — never duplicated elsewhere.
 * @returns {string}
 */
export function getModel() {
  return process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
}

/**
 * Converts our tools.js tool definitions into the OpenAI function-calling
 * format expected by the Groq API.
 *
 * @param {Array<{ name: string, description: string, parameters: object }>} tools
 * @returns {Array<object>}  — OpenAI-format tool definitions
 */
function toOpenAITools(tools) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: t.parameters,
        required: t.required ?? Object.keys(t.parameters),
      },
    },
  }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGroqCompletion(body, apiKey, attempt = 0) {
  const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429 && attempt < 4) {
    const text = await res.text().catch(() => "");
    const match = text.match(/try again in ([0-9.]+)s/i);
    const waitMs = match ? Math.ceil(parseFloat(match[1]) * 1000) + 500 : 10_000;
    await sleep(waitMs);
    return fetchGroqCompletion(body, apiKey, attempt + 1);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`[orchestrator/groq] Groq API error ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * Call Groq's chat completions endpoint with tool definitions.
 *
 * Returns one of:
 *   { toolName: string, toolInput: object }   — model wants to call a tool
 *   { done: true, content: string }            — model finished (no tool call)
 *
 * Throws on network errors or non-2xx HTTP responses.
 *
 * @param {Array<{ role: string, content: string }>} messages
 * @param {Array<{ name: string, description: string, parameters: object }>} toolDefs
 * @returns {Promise<{ toolName: string, toolInput: object } | { done: true, content: string }>}
 */
export async function callGroqWithTools(messages, toolDefs) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("[orchestrator/groq] GROQ_API_KEY is not set.");
  }

  const body = {
    model: getModel(),
    messages,
    tools: toOpenAITools(toolDefs),
    // Force the model to pick a tool (or "none" / "auto").
    // Using "auto" lets it either call a tool or reply with text.
    tool_choice: "auto",
    // Disable parallel calls so we always get exactly one tool decision per turn.
    parallel_tool_calls: false,
  };

  const data = await fetchGroqCompletion(body, apiKey);
  const message = data.choices?.[0]?.message;

  if (!message) {
    throw new Error("[orchestrator/groq] Unexpected response shape — no message in choices[0].");
  }

  // Model chose to call a tool
  if (message.tool_calls && message.tool_calls.length > 0) {
    const call = message.tool_calls[0]; // parallel_tool_calls is false, so exactly one
    let toolInput;
    try {
      toolInput = typeof call.function.arguments === "string"
        ? JSON.parse(call.function.arguments)
        : call.function.arguments;
    } catch {
      throw new Error(
        `[orchestrator/groq] Could not parse tool arguments for "${call.function.name}": ${call.function.arguments}`
      );
    }
    return { toolName: call.function.name, toolInput };
  }

  // Model chose to respond with text (no tool call) — signals the loop is done
  return { done: true, content: message.content ?? "" };
}
