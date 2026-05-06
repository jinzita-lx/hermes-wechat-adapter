import { once } from 'node:events';

export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

export async function readBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  req.on('data', (chunk) => {
    total += chunk.length;
    if (total > maxBytes) {
      req.destroy(new Error(`request body exceeds ${maxBytes} bytes`));
      return;
    }
    chunks.push(chunk);
  });
  await once(req, 'end');
  return Buffer.concat(chunks);
}

export async function readJson(req, maxBytes) {
  const raw = await readBody(req, maxBytes);
  if (!raw.length) return {};
  return JSON.parse(raw.toString('utf8'));
}
