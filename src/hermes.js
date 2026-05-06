import { config } from './config.js';

function extractResponsesText(payload) {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const parts = [];
  for (const item of output) {
    if (item?.type !== 'message') continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === 'output_text' && part.text) parts.push(part.text);
      if (part?.type === 'text' && part.text) parts.push(part.text);
    }
  }
  return parts.join('\n').trim();
}

export async function checkHermes() {
  const response = await fetch(`${config.hermesApiBaseUrl}/health`, {
    headers: { Authorization: `Bearer ${config.hermesApiKey}` },
  });
  if (!response.ok) throw new Error(`Hermes health failed: HTTP ${response.status}`);
  return response.json();
}

export async function askHermes({ conversation, input, instructions }) {
  const response = await fetch(`${config.hermesApiBaseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.hermesApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.hermesModel,
      input,
      instructions,
      conversation,
      store: true,
    }),
  });

  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  if (!response.ok) {
    const message = payload?.error?.message || raw || `HTTP ${response.status}`;
    throw new Error(`Hermes request failed: ${message}`);
  }

  return extractResponsesText(payload) || payload?.output_text || '';
}
