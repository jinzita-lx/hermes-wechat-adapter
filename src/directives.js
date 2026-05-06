import fs from 'node:fs';

const DIRECTIVE_RE = /\[\[(send_(?:file|image|video|voice|audio)):(.*?)\]\]/gis;
// Strip stray double-bracket tokens the model emits (e.g. `[[audio_as_voice]]`)
// that don't match a real send_* directive — otherwise they leak to the user
// as literal text. Single-line only, so we don't swallow legitimate prose.
const RESIDUAL_BRACKET_RE = /\[\[[^\]\n]*\]\]/g;

export function splitDirectives(text) {
  if (!text) return { text: '', attachments: [], residuals: [] };

  const attachments = [];
  let cleaned = String(text).replace(DIRECTIVE_RE, (_match, kind, rawPath) => {
    const filePath = String(rawPath || '').trim();
    if (filePath) attachments.push({ kind: kind.toLowerCase(), path: filePath });
    return '';
  });

  const residuals = [];
  cleaned = cleaned.replace(RESIDUAL_BRACKET_RE, (match) => {
    residuals.push(match);
    return '';
  }).trim();

  return { text: cleaned, attachments, residuals };
}

export function validateAttachmentPath(filePath) {
  if (!filePath || !filePath.startsWith('/')) {
    return { ok: false, reason: 'path must be absolute' };
  }
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { ok: false, reason: 'path is not a file' };
    return { ok: true, size: stat.size };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}