// AI abstraction. AI MODE uses the Anthropic Messages API when ANTHROPIC_API_KEY is set; otherwise callers fall back to DEMO MODE.
const KEY = () => process.env.ANTHROPIC_API_KEY || '';
const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
export const aiEnabled = () => !!KEY();

export async function claude({ system, messages, maxTokens = 1200 }) {
  const res = await fetch((process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': KEY(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system, messages }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error('AI ' + res.status + ': ' + (await res.text()).slice(0, 300));
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

export function parseJSON(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no json');
  return JSON.parse(m[0]);
}
