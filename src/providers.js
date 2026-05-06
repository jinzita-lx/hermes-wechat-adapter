import crypto from 'node:crypto';
import { SUPPORTED_PROVIDERS, normalizeProviderName } from './config.js';

export { SUPPORTED_PROVIDERS };

export function resolveProviderName(raw, fallback = 'gewechat') {
  return normalizeProviderName(raw, normalizeProviderName(fallback, 'gewechat'));
}

export function buildProviderMessageId(msg = {}) {
  return String(
    msg.provider_message_id ||
    msg.id ||
    msg.message_id ||
    msg.msg_id ||
    '',
  ).trim();
}

function timeBucket(value) {
  const date = value ? new Date(value) : null;
  const time = Number.isFinite(date?.getTime?.()) ? date.getTime() : Date.now();
  return Math.floor(time / 60000);
}

export function buildMessageDedupeKey(msg = {}) {
  const provider = resolveProviderName(msg.provider, 'gewechat');
  const providerMessageId = buildProviderMessageId(msg);
  if (providerMessageId) return `${provider}:${providerMessageId}`;

  const payload = JSON.stringify({
    chat_id: String(msg.chat_id || ''),
    sender_id: String(msg.sender_id || ''),
    text: String(msg.text || ''),
    bucket: timeBucket(msg.created_at || msg.timestamp || msg.ts),
  });
  const digest = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24);
  return `${provider}:hash:${digest}`;
}

export function providerDeviceKey(provider, deviceId) {
  return `${resolveProviderName(provider, 'gewechat')}:${String(deviceId || 'default')}`;
}
