/**
 * Tool Result Validator
 * =====================
 * Validates that a value returned by a tool conforms to the ToolResult shape
 * documented in tools.js before the orchestrator loop trusts it.
 *
 * Expected ToolResult shape:
 *   {
 *     ok:     boolean         — required
 *     output: any             — required (may be null on failure, but key must exist)
 *     error:  string | null   — required; must be a string or null
 *   }
 *
 * Usage:
 *   import { validateToolResult } from "@/lib/orchestrator/validate.js";
 *   const checked = validateToolResult(rawResult, "echo");
 *   // checked.valid === false means something is wrong; checked.reason has details.
 */

/**
 * @typedef {{ valid: true, result: ToolResult }} ValidationPass
 * @typedef {{ valid: false, reason: string }}   ValidationFail
 * @typedef {ValidationPass | ValidationFail}     ValidationOutcome
 */

/**
 * Validates a tool's return value against the required ToolResult shape.
 *
 * @param {unknown} value      — the raw value returned by tool.run()
 * @param {string}  toolName   — name of the tool (used in error messages only)
 * @returns {ValidationOutcome}
 */
export function validateToolResult(value, toolName) {
  const ctx = `Tool "${toolName}" returned`;

  if (value === null || value === undefined) {
    return { valid: false, reason: `${ctx} null/undefined; expected a ToolResult object.` };
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reason: `${ctx} ${Array.isArray(value) ? "an array" : typeof value}; expected a plain object.` };
  }

  if (typeof value.ok !== "boolean") {
    return {
      valid: false,
      reason: `${ctx} \`ok\` = ${JSON.stringify(value.ok)} (${typeof value.ok}); must be a boolean.`,
    };
  }

  if (!Object.prototype.hasOwnProperty.call(value, "output")) {
    return { valid: false, reason: `${ctx} an object missing the required \`output\` key.` };
  }

  if (value.error !== null && typeof value.error !== "string") {
    return {
      valid: false,
      reason: `${ctx} \`error\` = ${JSON.stringify(value.error)} (${typeof value.error}); must be a string or null.`,
    };
  }

  // All checks passed — cast and return
  return { valid: true, result: /** @type {ToolResult} */ (value) };
}

/**
 * Same as validateToolResult but throws on invalid results instead of
 * returning a failure object. Convenient for call-sites that prefer exceptions.
 *
 * @param {unknown} value
 * @param {string}  toolName
 * @returns {ToolResult}
 * @throws {Error}
 */
export function assertToolResult(value, toolName) {
  const outcome = validateToolResult(value, toolName);
  if (!outcome.valid) {
    throw new Error(`[orchestrator/validate] ${outcome.reason}`);
  }
  return outcome.result;
}
