import { Agent } from 'undici';
import { config } from './config.js';

// Hermes responses can take many minutes when its auxiliary providers are
// slow (mimo flush_memories alone burns ~91s before falling back, and the
// main inference can run another 3+ min on top). Node fetch's default
// undici dispatcher has headersTimeout=300s AND bodyTimeout=300s — either
// will abort a slow but legitimate response with a generic "fetch failed".
// AbortSignal.timeout cannot override these, so we install an explicit
// long-lived Agent. Pinned to the version Node bundles (process.versions
// .undici) so the Request handler interface stays compatible.
const HERMES_DISPATCHER = new Agent({
  headersTimeout: 15 * 60_000,
  bodyTimeout: 15 * 60_000,
  connectTimeout: 30_000,
});

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
    dispatcher: HERMES_DISPATCHER,
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
    dispatcher: HERMES_DISPATCHER,
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