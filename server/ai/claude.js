// Claude (Anthropic API) via the official SDK. Needs ANTHROPIC_API_KEY.
// Structured outputs force the reply to match our JSON schema.
import Anthropic from '@anthropic-ai/sdk';

export const id = 'claude';
export const label = 'Claude';
export const model = () => process.env.CLAUDE_MODEL || 'claude-opus-5-5';
export const ready = () => !!process.env.ANTHROPIC_API_KEY;

let client = null;
const getClient = () => (client ??= new Anthropic({ timeout: 120e3, maxRetries: 2 }));

/**
 * One structured call. Returns the parsed JSON object.
 * effort: 'low' for the desks (quick reads), 'medium' for the debate and the memo.
 */
export async function ask({ system, prompt, schema, effort = 'low', maxTokens = 16000 }) {
  const res = await getClient().beta.messages.create({
    model: model(),
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort, format: { type: 'json_schema', schema } },
    // if a safety classifier declines, the API retries on a fallback model in the same call
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default'
  });
  if (res.stop_reason === 'refusal') throw new Error(`Claude declined (${res.stop_details?.category || 'refusal'})`);
  if (res.stop_reason === 'max_tokens') throw new Error('Claude ran out of output tokens');
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { data: JSON.parse(text), model: res.model, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens } };
}

/** Friendly message for an SDK error. */
export function describe(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'Claude: the API key was rejected';
  if (e instanceof Anthropic.RateLimitError) return 'Claude: rate limited, try again in a minute';
  if (e instanceof Anthropic.APIConnectionError) return 'Claude: could not reach the API';
  if (e instanceof Anthropic.APIError) return `Claude: API error ${e.status}`;
  return 'Claude: ' + e.message;
}
