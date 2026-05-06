import fs from 'node:fs';

const DIRECTIVE_RE = /\[\[(send_(?:file|image|video|voice|audio)):(.*?)\]\]/gis;

export function splitDirectives(text) {
  if (!text) return { text: '', attachments: [] };

  const attachments = [];
  const cleaned = String(text).replace(DIRECTIVE_RE, (_match, kind, rawPath) => {
    const filePath = String(rawPath || '').trim();
    if (filePath) attachments.push({ kind: kind.toLowerCase(), path: filePath });
    return '';
  }).trim();

  return { text: cleaned, attachments };
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
