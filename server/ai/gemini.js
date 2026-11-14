// Gemini (Google AI Studio API) over its REST endpoint. Needs GEMINI_API_KEY.
// JSON mode with a response schema keeps replies in our format.
// If GEMINI_MODEL is not set, the newest stable "flash" model the key can use is picked.

export const id = 'gemini';
export const label = 'Gemini';
export const ready = () => !!process.env.GEMINI_API_KEY;

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
let picked = null;
export const model = () => process.env.GEMINI_MODEL || picked || 'auto';

async function call(path, body, timeout = 120e3) {
  const r = await fetch(`${BASE}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `HTTP ${r.status}`), { status: r.status });
  return j;
}

/** Newest stable gemini-N-flash model that supports generateContent. */
async function resolveModel() {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  if (picked) return picked;
  const j = await call('models?pageSize=200');
  const names = (j.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /^gemini-\d+(\.\d+)?-flash$/.test(n));
  names.sort((a, b) => parseFloat(b.split('-')[1]) - parseFloat(a.split('-')[1]));
  picked = names[0] || 'gemini-2.5-flash';
  return picked;
}

// Our schemas are plain JSON Schema; Gemini's responseSchema uses an OpenAPI subset.
function toGemini(s) {
  const out = { type: s.type.toUpperCase() };
  if (s.enum) out.enum = s.enum;
  if (s.description) out.description = s.description;
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGemini(v)]));
    out.required = s.required || Object.keys(s.properties);
    out.propertyOrdering = Object.keys(s.properties);
  }
  if (s.items) out.items = toGemini(s.items);
  if (s.anyOf) return { ...toGemini(s.anyOf.find(x => x.type !== 'null')), nullable: true };
  return out;
}

export async function ask({ system, prompt, schema, effort = 'low' }) {
  const m = await resolveModel();
  const body = thinking => ({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGemini(schema),
      // quick reads for the desks, more thought for the debate and memo
      ...(thinking ? { thinkingConfig: { thinkingBudget: effort === 'low' ? 512 : 2048 } } : {})
    }
  });
  let j;
  try { j = await call(`models/${m}:generateContent`, body(true)); } catch (e) {
    // some model versions do not take a thinking budget: retry once without it
    if (e.status !== 400 || !/thinking/i.test(e.message)) throw e;
    j = await call(`models/${m}:generateContent`, body(false));
  }
  const c = j.candidates?.[0];
  if (!c || c.finishReason === 'SAFETY' || c.finishReason === 'PROHIBITED_CONTENT') throw new Error(`Gemini declined (${c?.finishReason || j.promptFeedback?.blockReason || 'no answer'})`);
  const text = (c.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
  return { data: JSON.parse(text), model: m, usage: { input: j.usageMetadata?.promptTokenCount, output: j.usageMetadata?.candidatesTokenCount } };
}

export function describe(e) {
  if (e.status === 400 && /API key/i.test(e.message)) return 'Gemini: the API key was rejected';
  if (e.status === 429) return 'Gemini: rate limited, try again in a minute';
  if (e.name === 'TimeoutError') return 'Gemini: timed out';
  return 'Gemini: ' + e.message;
}
