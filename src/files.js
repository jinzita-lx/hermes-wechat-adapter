import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from './config.js';

const files = new Map();

// Cap how long a single remote attachment download may take.
const REMOTE_DOWNLOAD_TIMEOUT_MS = 30_000;

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

// --- Remote attachment downloads -------------------------------------------
// Restricted (group) chats may only send files a tool *generated*; those are
// surfaced to the model as https URLs, which we download here. Local paths are
// rejected upstream in commandsFromAnswer. The host checks below also stop the
// model from pointing the adapter at internal/loopback addresses (SSRF).

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 127) return true;             // current-network / loopback
  if (a === 10) return true;                         // private
  if (a === 172 && b >= 16 && b <= 31) return true;  // private
  if (a === 192 && b === 168) return true;           // private
  if (a === 169 && b === 254) return true;           // link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true;                         // multicast / reserved
  return false;
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80:')) return true;        // link-local
  if (/^f[cd][0-9a-f]{0,2}:/.test(lower)) return true; // unique-local fc00::/7
  const mapped = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // unrecognized → treat as unsafe
}

async function assertPublicHttpsUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    throw new Error('URL 无法解析');
  }
  if (url.protocol !== 'https:') {
    throw new Error('附件 URL 必须是 https');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('附件 URL 指向私有/环回地址');
    return url;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('附件 URL 指向 localhost');
  }
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new Error('附件 URL 域名解析失败');
  }
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error('附件 URL 解析到私有/环回地址');
  }
  return url;
}

function extensionFromUrl(url, type) {
  const ext = path.extname(url.pathname).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  return extensionFromType(type);
}

export async function downloadRemoteFile(rawUrl, type = 'file') {
  await ensureFileDirs();
  const url = await assertPublicHttpsUrl(rawUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_DOWNLOAD_TIMEOUT_MS);
  try {
    // redirect:'error' — a redirect could bypass the SSRF check on the original host.
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`);
    if (!response.body) throw new Error('下载内容为空');

    const declared = Number(response.headers.get('content-length') || '0');
    if (declared && declared > config.maxUploadBytes) {
      throw new Error(`文件过大（上限 ${config.maxUploadBytes} 字节）`);
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > config.maxUploadBytes) {
        await reader.cancel();
        throw new Error(`文件超过上限 ${config.maxUploadBytes} 字节`);
      }
      chunks.push(Buffer.from(value));
    }
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) throw new Error('下载内容为空');

    const id = crypto.randomUUID();
    const named = safeName(path.basename(url.pathname));
    const filename = /\.[a-z0-9]{1,8}$/i.test(named)
      ? named
      : `${type}-${id}${extensionFromUrl(url, type)}`;
    const storedName = `${Date.now()}-${id}-${filename}`;
    const filePath = path.join(config.filesDir, storedName);
    await fsp.writeFile(filePath, buffer);
    const meta = {
      id,
      type,
      filename,
      path: filePath,
      size: buffer.length,
      source: 'hermes-url',
      created_at: new Date().toISOString(),
    };
    files.set(id, meta);
    return meta;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('下载超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
