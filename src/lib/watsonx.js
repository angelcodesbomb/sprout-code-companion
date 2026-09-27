/**
 * Watson.ai (IBM watsonx.ai) LLM Client
 * ======================================
 * Wraps the watsonx.ai REST API with:
 *   - IAM token exchange (API key → Bearer token, cached for 55 min)
 *   - callWatsonChat()  — OpenAI-compatible messages array → response string
 *   - isWatsonConfigured() — quick env-var check used by routes to decide primary/fallback
 *
 * Endpoints used:
 *   IAM token : https://iam.cloud.ibm.com/identity/token
 *   Inference : POST {WATSONX_URL}/ml/v1/text/chat?version=2024-05-13
 *               Body: { model_id, project_id, messages, parameters: { max_new_tokens, temperature } }
 *
 * Environment variables (all required for Watson to be used as primary):
 *   WATSONX_API_KEY    — IBM Cloud IAM API key
 *   WATSONX_URL        — Regional endpoint, e.g. https://us-south.ml.cloud.ibm.com
 *   WATSONX_PROJECT_ID — watsonx.ai project ID (UUID)
 *   WATSONX_MODEL_ID   — (optional) defaults to granite-20b-code-instruct
 */

const WATSON_API_VERSION = "2023-05-29";
const WATSON_DEFAULT_MODEL = "meta-llama/llama-3-3-70b-instruct";
const IAM_TOKEN_URL = "https://iam.cloud.ibm.com/identity/token";

// ── IAM token cache (in-process, resets on cold start) ───────────────────────
let _cachedToken = null;      // { token: string, expiresAt: number }

/**
 * Fetch or return a cached IAM Bearer token.
 * Tokens are valid for 60 min; we refresh 5 min early to avoid edge races.
 *
 * @returns {Promise<string>} Bearer token string
 * @throws  if the IAM exchange fails
 */
async function getIamToken() {
  const now = Date.now();
  if (_cachedToken && now < _cachedToken.expiresAt) {
    return _cachedToken.token;
  }

  const apiKey = process.env.WATSONX_API_KEY;
  if (!apiKey) throw new Error("[watsonx] WATSONX_API_KEY is not set.");

  const res = await fetch(IAM_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ibm:params:oauth:grant-type:apikey",
      apikey: apiKey,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`[watsonx] IAM token exchange failed ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const token = data.access_token;
  if (!token) throw new Error("[watsonx] IAM response missing access_token.");

  // expires_in is in seconds; cache for 55 min regardless to be safe
  const ttlMs = (data.expires_in ? data.expires_in * 1000 : 3600_000) - 5 * 60_000;
  _cachedToken = { token, expiresAt: now + ttlMs };

  return token;
}

/**
 * Returns true when all three required Watson env vars are present.
 * Routes call this before attempting a Watson request.
 */
export function isWatsonConfigured() {
  return Boolean(
    process.env.WATSONX_API_KEY &&
    process.env.WATSONX_URL &&
    process.env.WATSONX_PROJECT_ID
  );
}

/**
 * Send an OpenAI-style messages array to watsonx.ai and return the response text.
 *
 * @param {Array<{ role: "system"|"user"|"assistant", content: string }>} messages
 * @param {{ maxTokens?: number, temperature?: number }} options
 * @returns {Promise<string>} The model's reply text
 * @throws  on network error, bad status, or missing response content
 */
export async function callWatsonChat(messages, { maxTokens = 400, temperature = 0.3 } = {}) {
  const watsonUrl = process.env.WATSONX_URL;
  const projectId = process.env.WATSONX_PROJECT_ID;
  const modelId   = process.env.WATSONX_MODEL_ID || WATSON_DEFAULT_MODEL;

  if (!watsonUrl)  throw new Error("[watsonx] WATSONX_URL is not set.");
  if (!projectId)  throw new Error("[watsonx] WATSONX_PROJECT_ID is not set.");

  const token = await getIamToken();

  const endpoint = `${watsonUrl.replace(/\/$/, "")}/ml/v1/text/chat?version=${WATSON_API_VERSION}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model_id: modelId,
      project_id: projectId,
      messages,
      max_tokens: maxTokens,
      temperature,
      frequency_penalty: 0,
      presence_penalty: 0,
      top_p: 1,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`[watsonx] Inference failed ${res.status}: ${text.slice(0, 400)}`);
  }

  const data = await res.json();

  // Watson /ml/v1/text/chat response shape:
  //   { choices: [{ message: { content: "..." } }] }
  //   or (older shape) { results: [{ generated_text: "..." }] }
  const content =
    data?.choices?.[0]?.message?.content ??
    data?.results?.[0]?.generated_text ??
    null;

  if (typeof content !== "string") {
    throw new Error("[watsonx] Unexpected response shape — no content found.");
  }

  return content;
}

/**
 * Resets the cached IAM token — only used in tests.
 * @internal
 */
export function _resetTokenCache() {
  _cachedToken = null;
}
