import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const files = new Map();

function safeName(value, fallback = 'wechat-file') {
  const base = path.basename(String(value || fallback));
  return base.replace(/[^\w.\-()\u4e00-\u9fa5]/g, '_').slice(-160) || fallback;
}

function extensionFromType(type) {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'image') return '.jpg';
  if (normalized === 'voice' || normalized === 'audio') return '.silk';
  if (normalized === 'video') return '.mp4';
  return '';
}

export async function ensureFileDirs() {
  await fsp.mkdir(config.filesDir, { recursive: true });
}

export async function saveUploadedFile({ buffer, filename, type = 'file', source = 'upload' }) {
  await ensureFileDirs();
  const id = crypto.randomUUID();
  const safe = safeName(filename || `${type}-${id}${extensionFromType(type)}`);
  const storedName = `${Date.now()}-${id}-${safe}`;
  const filePath = path.join(config.filesDir, storedName);
  await fsp.writeFile(filePath, buffer);
  const stat = await fsp.stat(filePath);
  const meta = {
    id,
    type,
    filename: safe,
    path: filePath,
    size: stat.size,
    source,
    created_at: new Date().toISOString(),
  };
  files.set(id, meta);
  return meta;
}

export function registerLocalFile(filePath, type = 'file') {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('path is not a file');
  const id = crypto.randomUUID();
  const meta = {
    id,
    type,
    filename: safeName(filePath),
    path: filePath,
    size: stat.size,
    source: 'hermes',
    created_at: new Date().toISOString(),
  };
  files.set(id, meta);
  return meta;
}

export function getFile(id) {
  return files.get(id);
}

export function resolveMessageAttachment(attachment) {
  if (!attachment) return null;
  if (attachment.file_id && files.has(attachment.file_id)) {
    const meta = files.get(attachment.file_id);
    return { ...attachment, local_path: meta.path, filename: meta.filename, size: meta.size };
  }
  return attachment;
}

export function publicFileDescriptor(req, meta) {
  const base = config.publicBaseUrl || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  return {
    id: meta.id,
    type: meta.type,
    filename: meta.filename,
    size: meta.size,
    download_url: `${base.replace(/\/+$/, '')}/files/${meta.id}`,
  };
}
