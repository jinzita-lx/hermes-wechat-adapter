import crypto from 'node:crypto';
import { config } from './config.js';

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function tokenFromRequest(req, url) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  if (req.headers['x-adapter-token']) return String(req.headers['x-adapter-token']);
  return url.searchParams.get('token') || '';
}

export function isAuthorized(req, url) {
  return timingSafeEqualString(tokenFromRequest(req, url), config.authToken);
}
