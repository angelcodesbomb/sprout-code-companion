/**
 * Groq LLM Wrapper
 * ================
 * Thin wrapper around Groq's OpenAI-compatible chat completions endpoint.
 * Supports tool-calling (parallel_tool_calls disabled so the model picks exactly one tool).
 *
 * Model is read from process.env.GROQ_MODEL_ORCHESTRATOR.
 * Default: "openai/gpt-oss-120b"  (tool-calling capable, 250K TPM free tier)
 *
 * Multi-model support — each role reads its own env var:
 *   GROQ_MODEL_ORCHESTRATOR  → openai/gpt-oss-120b  (reasoning + tool-calling)
 *   GROQ_MODEL_UI            → openai/gpt-oss-20b   (code generation, GPT OSS strictly)
 *   GROQ_MODEL_FILEMAP       → openai/gpt-oss-20b   (short structured outputs, 1000 t/s)
 *   GROQ_MODEL               → openai/gpt-oss-20b   (legacy fallback for any remaining route)
 *                              the tools API field; parses XML <tool_call> blocks from
 *                              the response content. Fully transparent to callers.
 *
 * DO NOT hardcode a model string anywhere else in the codebase.
 * Always import getModel() or GROQ_MODEL from this file so a swap is a
 * single config change in .env.local.
 */

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export function getModel() {
  return process.env.GROQ_MODEL_ORCHESTRATOR ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
}

/**
 * Model for the Review Agent — defaults to openai/gpt-oss-20b.
 * Reads GROQ_MODEL_REVIEW then GROQ_MODEL_UI then hard default.
 */
export function getReviewModel() {
  return (
    process.env.GROQ_MODEL_REVIEW ??
    process.env.GROQ_MODEL_UI     ??
    "openai/gpt-oss-20b"
  );
}

/**
 * Plain (non-tool-calling) Groq completion — used by the Review Agent.
 * Sends only the messages and returns the raw text content.
 * Uses the review model, not the orchestrator model.
 *
 * @param {Array<{ role: string, content: string }>} messages
 * @param {{ maxTokens?: number, temperature?: number }} options
 * @returns {Promise<string>}
 */
export async function callGroqRaw(messages, { maxTokens = 1024, temperature = 0.1 } = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("[groq] GROQ_API_KEY is not set.");

  const model = getReviewModel();
  const qwen  = isQwenModel(model);

  // For Qwen, strip <think> from system and user messages to reduce noise
  const cleanMessages = qwen
    ? messages.map((m) => ({
        ...m,
        content: (m.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim(),
      }))
    : messages;

  const data = await fetchGroqCompletion(
    { model, messages: cleanMessages, temperature, max_tokens: maxTokens },
    apiKey
  );

  const content = data.choices?.[0]?.message?.content ?? "";
  // Strip Qwen think blocks from response
  return qwen ? content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim() : content;
}

/** Returns true for Qwen models which use a different tool-calling format. */
function isQwenModel(model) {
  return model.toLowerCase().startsWith("qwen/") || model.toLowerCase().startsWith("qwen");
}

/**
 * Converts our tools.js tool definitions into the OpenAI function-calling
 * format expected by the Groq API.
 */
function toOpenAITools(tools) {
  return tools.map((t) => {
    const required = t.required ?? Object.keys(t.parameters ?? {});
    const hasParams = Object.keys(t.parameters ?? {}).length > 0;
    const tool = {
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        // Groq 400s when properties is empty {} — use a dummy no-op param instead
        parameters: hasParams
          ? { type: "object", properties: t.parameters }
          : { type: "object", properties: { _noop: { type: "string", description: "Unused." } } },
      },
    };
    if (required.length > 0) {
      tool.function.parameters.required = required;
    }
    return tool;
  });
}

/**
 * For Qwen models: inject the tool list as a JSON block in the system prompt.
 * Only modifies the system message — subsequent messages are passed through unchanged.
 */
function buildQwenSystemPrompt(systemContent, tools) {
  // Compact tool list — just name + description to save tokens
  const toolSummary = tools
    .map((t) => `- ${t.name}: ${t.description.split(".")[0]}`)
    .join("\n");

  // Full schema for the model to reference
  const toolSchema = JSON.stringify(
    tools.map((t) => ({
      name: t.name,
      parameters: t.parameters,
      required: t.required ?? Object.keys(t.parameters),
    })),
    null,
    2
  );

  return (
    systemContent +
    `\n\n═══ TOOL CALLING INSTRUCTIONS ═══════════════════════════════════════\n` +
    `After each step, respond with EXACTLY ONE tool call as a bare JSON object:\n` +
    `{"name": "<tool_name>", "arguments": {"param": "value"}}\n\n` +
    `Do NOT wrap in XML. Do NOT add any text before or after the JSON.\n` +
    `Only respond with plain text (no JSON) when the entire goal is complete.\n\n` +
    `Available tools:\n${toolSummary}\n\n` +
    `Tool parameter schemas:\n${toolSchema}\n` +
    `═══════════════════════════════════════════════════════════════════════`
  );
}

function injectToolsIntoMessages(messages, tools) {
  const hasSystem = messages[0]?.role === "system";
  if (hasSystem) {
    return [
      { role: "system", content: buildQwenSystemPrompt(messages[0].content, tools) },
      ...messages.slice(1),
    ];
  }
  return [
    { role: "system", content: buildQwenSystemPrompt("", tools) },
    ...messages,
  ];
}

/**
 * Try to parse a Qwen-style tool call from message content.
 * Qwen may emit:
 *   <tool_call>\n{"name": "...", "arguments": {...}}\n</tool_call>
 *   {"name": "...", "arguments": {...}}   (plain JSON)
 */
function parseQwenToolCall(content) {
  if (!content) return null;

  // Strip <think>...</think> blocks that Qwen sometimes prepends
  const stripped = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Try XML tool_call wrapper first
  const xmlMatch = stripped.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
  const jsonStr = xmlMatch ? xmlMatch[1] : stripped;

  // Find the outermost JSON object
  const start = jsonStr.indexOf("{");
  const end   = jsonStr.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(jsonStr.slice(start, end + 1));
    if (parsed.name && (parsed.arguments !== undefined || parsed.parameters !== undefined)) {
      return {
        name:      parsed.name,
        arguments: parsed.arguments ?? parsed.parameters ?? {},
      };
    }
  } catch {
    // Not valid JSON — not a tool call
  }
  return null;
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
    signal: AbortSignal.timeout(60_000),
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
 * Handles both OpenAI-format tool calls (llama, gpt-oss) and Qwen's
 * XML/JSON-in-content tool call format transparently.
 */
export async function callGroqWithTools(messages, toolDefs) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("[orchestrator/groq] GROQ_API_KEY is not set.");
  }

  const model = getModel();
  const qwen  = isQwenModel(model);
  const validToolNames = new Set(toolDefs.map((t) => t.name));

  let body;
  if (qwen) {
    // Qwen: inject tools into the system prompt, don't use the tools API field.
    // This avoids the XML/400 error from mismatched tool-calling protocols.
    body = {
      model,
      messages: injectToolsIntoMessages(messages, toolDefs),
      temperature: 0.2,
      // No tools/tool_choice/parallel_tool_calls — Qwen handles it via system prompt
    };
  } else {
    body = {
      model,
      messages,
      tools: toOpenAITools(toolDefs),
      tool_choice: "auto",
      parallel_tool_calls: false,
    };
  }

  const data = await fetchGroqCompletion(body, apiKey);
  const message = data.choices?.[0]?.message;

  if (!message) {
    throw new Error("[orchestrator/groq] Unexpected response shape — no message in choices[0].");
  }

  // ── Qwen path: parse tool call from message content ───────────────────────
  if (qwen) {
    const raw = message.content ?? "";
    const toolCall = parseQwenToolCall(raw);

    // Debug log — shows exactly what Qwen returned each step
    console.log(
      `[orchestrator/groq][qwen] raw response: ${raw.replace(/<think>[\s\S]*?<\/think>/gi, "<think>...</think>").slice(0, 300)}`
    );

    if (toolCall && validToolNames.has(toolCall.name)) {
      const toolInput = typeof toolCall.arguments === "string"
        ? JSON.parse(toolCall.arguments)
        : toolCall.arguments;
      console.log(`[orchestrator/groq][qwen] parsed tool call: ${toolCall.name}`, toolInput);
      return { toolName: toolCall.name, toolInput };
    }
    // No valid tool call found — model is done
    const clean = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    console.log(`[orchestrator/groq][qwen] no tool call found — treating as done`);
    return { done: true, content: clean };
  }

  // ── Standard OpenAI path (llama, gpt-oss) ────────────────────────────────
  if (message.tool_calls && message.tool_calls.length > 0) {
    const call = message.tool_calls[0];

    // Guard: reject built-in tools from models like gpt-oss-120b
    if (!validToolNames.has(call.function.name)) {
      console.warn(
        `[orchestrator/groq] Model called unknown tool "${call.function.name}" — treating as done.`
      );
      return { done: true, content: message.content ?? "" };
    }

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

  return { done: true, content: message.content ?? "" };
}
