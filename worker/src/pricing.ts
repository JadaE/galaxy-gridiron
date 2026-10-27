/**
 * OpenAI list prices, USD per 1M tokens, Standard processing, prompts < 272K tokens.
 * Verified Oct 21, 2026 on developers.openai.com/api/docs/pricing and the model pages
 * (gpt-6-luna, gpt-6.1-sol). Our input cap keeps every request far below 272K tokens,
 * so long-context rates never apply. Update this table if OpenAI changes prices.
 */
export interface ModelPrice {
  input: number;
  cachedInput: number;
  cacheWrite: number; // 30-minute cache-write rate (billed instead of the normal input rate)
  output: number; // reasoning tokens are billed as output
}

export const PRICES: Record<string, ModelPrice> = {
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
  "gpt-6.1-sol": { input: 2.0, cachedInput: 0.1, cacheWrite: 2.5, output: 10.0 },
  // Alternatives on the same OpenAI account (not used by default):
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
  "gpt-6-sol": { input: 2.0, cachedInput: 0.2, cacheWrite: 2.5, output: 10.0 },
};

export interface Usage {
  inputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

/** Read token usage from an OpenAI Responses API (or Chat Completions) body. */
export function readUsage(u: any): Usage | null {
  if (!u || typeof u !== "object") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  const inputTokens = num(u.input_tokens ?? u.prompt_tokens);
  const outputTokens = num(u.output_tokens ?? u.completion_tokens);
  const d = u.input_tokens_details ?? u.prompt_tokens_details ?? {};
  const cachedTokens = Math.min(num(d.cached_tokens), inputTokens);
  const cacheWriteTokens = Math.min(num(d.cache_write_tokens), inputTokens - cachedTokens);
  if (inputTokens === 0 && outputTokens === 0) return null;
  return { inputTokens, cachedTokens, cacheWriteTokens, outputTokens };
}

/** Cost in USD. Uncached = input - cached reads - cache writes, each billed at its own rate. */
export function costUsd(model: string, usage: Usage): number {
  const p = PRICES[model];
  if (!p) throw new Error(`No price for model ${model}`);
  const uncached = Math.max(0, usage.inputTokens - usage.cachedTokens - usage.cacheWriteTokens);
  const cost =
    (uncached * p.input +
      usage.cachedTokens * p.cachedInput +
      usage.cacheWriteTokens * p.cacheWrite +
      usage.outputTokens * p.output) /
    1_000_000;
  return round6(cost);
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
