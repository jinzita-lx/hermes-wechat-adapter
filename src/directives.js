import fs from 'node:fs';
import path from 'node:path';

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

// A send directive targets either a local absolute path or a remote http(s)
// URL. Restricted (group) chats only accept remote URLs — see commandsFromAnswer.
export function isRemoteUrl(target) {
  if (!target) return false;
  try {
    const url = new URL(String(target).trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
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

// Resolve `filePath` and confirm it is a regular file located inside one of
// `roots`. realpath resolves symlinks and `..`, so a directive cannot escape
// the allowlist. Restricted (group) chats use this to gate attachments to the
// model's generated-image output directory.
export function resolveWithinRoots(filePath, roots) {
  if (!filePath || !filePath.startsWith('/')) {
    return { ok: false, reason: 'path must be absolute' };
  }
  let realPath;
  try {
    realPath = fs.realpathSync(filePath);
    if (!fs.statSync(realPath).isFile()) {
      return { ok: false, reason: 'path is not a file' };
    }
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  for (const root of roots || []) {
    let realRoot;
    try {
      realRoot = fs.realpathSync(root);
    } catch {
      continue; // configured root does not exist — skip it
    }
    if (realPath === realRoot || realPath.startsWith(realRoot + path.sep)) {
      return { ok: true, realPath };
    }
  }
  return { ok: false, reason: 'not inside an allowed generated-output directory' };
}