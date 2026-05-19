import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { askHermes } from './hermes.js';
import { splitDirectives, validateAttachmentPath, isRemoteUrl, resolveWithinRoots } from './directives.js';
import { chunkText, escapeRegExp, hasActivationPrefix, stripActivationPrefix } from './text.js';
import { publicFileDescriptor, registerLocalFile, resolveMessageAttachment, downloadRemoteFile } from './files.js';
import { logger } from './logger.js';
import { buildMessageDedupeKey, providerDeviceKey, resolveProviderName } from './providers.js';

const RESET_NONCE_FILE = path.join(config.dataDir, 'reset-nonces.json');

// Persisted so a /reset survives adapter restarts — otherwise each restart silently reattaches the chat to its pre-reset conversation.
function loadResetNonces() {
  try {
    const obj = JSON.parse(fs.readFileSync(RESET_NONCE_FILE, 'utf8'));
    return new Map(Object.entries(obj).filter(([, v]) => Number.isInteger(v) && v >= 0));
  } catch {
    return new Map();
  }
}

const resetNonceByChat = loadResetNonces();
const queueByChat = new Map();
const pendingByDevice = new Map();
const waitersByDevice = new Map();
const recentInbound = new Map();

function saveResetNonces() {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(RESET_NONCE_FILE, JSON.stringify(Object.fromEntries(resetNonceByChat), null, 2));
  } catch (error) {
    logger.warn('failed to persist reset nonces:', error.message);
  }
}

function stableId(value) {
  return crypto.createHash('sha256').update(String(value)).digest('base64url').slice(0, 32);
}

function providerChatKey(provider, chatId) {
  return `${resolveProviderName(provider, config.defaultProvider)}:${chatId}`;
}

// Local-date bucket: each chat rotates to a fresh Hermes conversation daily, bounding context growth even without /reset.
function conversationEpoch() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function createConversationKey(provider, chatId) {
  const scopedChat = providerChatKey(provider, chatId);
  const nonce = resetNonceByChat.get(scopedChat) || 0;
  return `wechat-personal-${stableId(`${scopedChat}:${nonce}:${conversationEpoch()}`)}`;
}

function normalizeMessage(raw, fallbackDeviceId, fallbackProvider = config.defaultProvider) {
  const msg = raw?.message || raw || {};
  const provider = resolveProviderName(msg.provider || raw?.provider, fallbackProvider);
  return {
    id: String(msg.id || msg.message_id || crypto.randomUUID()),
    provider,
    provider_message_id: String(msg.provider_message_id || msg.id || msg.message_id || '').trim(),
    device_id: String(msg.device_id || fallbackDeviceId || 'default'),
    chat_id: String(msg.chat_id || msg.chat_name || ''),
    chat_name: String(msg.chat_name || msg.chat_id || ''),
    is_group: Boolean(msg.is_group),
    sender_id: String(msg.sender_id || msg.sender_name || ''),
    sender_name: String(msg.sender_name || msg.sender_id || ''),
    text: String(msg.text || ''),
    at_self: Boolean(msg.at_self),
    created_at: msg.created_at || msg.timestamp || raw?.timestamp || new Date().toISOString(),
    attachments: Array.isArray(msg.attachments) ? msg.attachments.map(resolveMessageAttachment).filter(Boolean) : [],
    raw: msg,
  };
}

function isAllowed(value, allowlist) {
  return allowlist.includes(value);
}

function roomMatches(msg) {
  return config.allowedRooms.some((allowed) => (
    allowed === msg.chat_id ||
    allowed === msg.chat_name ||
    (msg.chat_name && msg.chat_name.includes(allowed))
  ));
}

function shouldAcceptDm(msg) {
  if (config.dmPolicy === 'disabled') return false;
  if (config.dmPolicy === 'allowlist') {
    return isAllowed(msg.chat_id, config.allowedContacts) ||
      isAllowed(msg.chat_name, config.allowedContacts) ||
      isAllowed(msg.sender_id, config.allowedContacts) ||
      isAllowed(msg.sender_name, config.allowedContacts);
  }
  return true;
}

function shouldAcceptGroup(msg) {
  if (config.groupPolicy === 'disabled') return false;
  if (config.groupPolicy === 'allowlist' && !roomMatches(msg)) return false;
  if (!config.requireMentionInGroups) return true;
  return msg.at_self || hasActivationPrefix(msg.text, config.activationPrefixes);
}

function cleanGroupText(text) {
  const alias = config.botAlias.trim();
  const mentionPattern = alias ? new RegExp(`@${escapeRegExp(alias)}\\s*`, 'g') : null;
  const withoutMention = mentionPattern ? String(text || '').replace(mentionPattern, '') : String(text || '');
  return stripActivationPrefix(withoutMention, config.activationPrefixes);
}

function isAdminUser(msg) {
  return config.adminUsers.some((allowed) => (
    allowed === msg.chat_id ||
    allowed === msg.chat_name ||
    allowed === msg.sender_id ||
    allowed === msg.sender_name
  ));
}

// A group trusted enough to grant an admin sender full tool access. Scoped
// explicitly via WECHAT_ADMIN_ROOMS because WeChat exposes only the
// user-settable (spoofable) display name to identify a group member.
function isAdminRoom(msg) {
  return config.adminRooms.some((room) => (
    room === msg.chat_id || room === msg.chat_name
  ));
}

export function toolAccessProfile(msg) {
  if (msg.is_group) {
    // Full tool access inside a group requires BOTH an admin nickname and the
    // room being in WECHAT_ADMIN_ROOMS — the nickname alone is spoofable.
    if (isAdminUser(msg) && isAdminRoom(msg)) {
      return {
        access: 'full',
        isAdmin: true,
        reason: 'group_admin_room',
      };
    }
    return {
      access: 'restricted',
      isAdmin: false,
      reason: 'group_restricted',
    };
  }

  const admin = isAdminUser(msg);
  return {
    access: admin ? 'full' : 'restricted',
    isAdmin: admin,
    reason: admin ? 'dm_admin' : 'dm_non_admin',
  };
}

export function bridgeInstructions(accessProfile) {
  const access = accessProfile?.access || 'full';
  const isRestricted = access === 'restricted';
  return [
    'You are talking to users through a WeChat personal-account adapter.',
    'Reply naturally and concisely. Avoid spammy or bulk-message behavior.',
    isRestricted
      ? 'Security policy: do NOT run local shell commands, do NOT inspect or modify local files, and do NOT ask Hermes to use terminal/file read/file write/patch/search capabilities.'
      : 'You can use Hermes tools to read local files, write files, run tasks, and inspect uploaded media.',
    isRestricted
      ? 'Treat uploaded media only as user-provided context. If a task would require local command execution or local file access, refuse briefly and ask the user to contact an administrator.'
      : 'Incoming WeChat media and files are saved on this Linux machine; the prompt includes local absolute paths when available.',
    isRestricted
      ? 'You may generate images with the image generation tool when the user asks. The tool returns the absolute local path of the generated image file. To send it to WeChat, output exactly one directive on its own line: [[send_image:/absolute/path/returned/by/the/tool.png]] — use the exact path the tool returned.'
      : 'If you create a file that should be sent back to WeChat, include exactly one directive on its own line: [[send_file:/absolute/path/to/file]].',
    isRestricted
      ? 'Only send images you generated with the image generation tool in this conversation. Never put any other local filesystem path in a send directive, and do not emit [[send_file:...]]. Apart from the send_image directive, reply in plain text.'
      : 'Images, videos, and voice/audio may use [[send_image:/path]], [[send_video:/path]], or [[send_voice:/path]].',
    isRestricted ? '' : 'Send directives accept either an absolute local path on this Linux machine or a public https URL.',
    config.instructionsExtra,
  ].filter(Boolean).join('\n');
}

function buildPrompt(msg, text, accessProfile) {
  const lines = [];
  lines.push(`WeChat provider: ${msg.provider}`);
  lines.push(`WeChat chat id: ${msg.chat_id}`);
  lines.push(`WeChat chat name: ${msg.chat_name || '(unknown)'}`);
  lines.push(`Group chat: ${msg.is_group ? 'yes' : 'no'}`);
  lines.push(`Sender: ${msg.sender_name || '(unknown)'} (${msg.sender_id || 'unknown'})`);
  lines.push(`Tool access: ${accessProfile?.access || 'full'}`);
  if (accessProfile?.reason) lines.push(`Access reason: ${accessProfile.reason}`);
  if (text) lines.push(`Message text:\n${text}`);
  if (msg.attachments.length) {
    lines.push('Attachments:');
    for (const item of msg.attachments) {
      const type = item.type || 'file';
      if (item.local_path) lines.push(`- ${type}: ${item.local_path}`);
      else if (item.file_id) lines.push(`- ${type}: file_id=${item.file_id} (not resolved on Linux)`);
      else if (item.windows_path) lines.push(`- ${type}: ${item.windows_path} (Windows path, upload required for Hermes to read it)`);
    }
  }
  return lines.join('\n\n');
}

function commandBase(msg, action) {
  return {
    id: crypto.randomUUID(),
    action,
    provider: msg.provider,
    device_id: msg.device_id,
    chat_id: msg.chat_id,
    chat_name: msg.chat_name,
    created_at: new Date().toISOString(),
  };
}

async function commandsFromAnswer(req, msg, answer, accessProfile) {
  const { text, attachments, residuals } = splitDirectives(answer);
  if (residuals && residuals.length) logger.warn('directives: stripped non-directive bracket tokens', residuals);
  const restricted = (accessProfile?.access || 'full') === 'restricted';
  const commands = [];

  for (const chunk of chunkText(text, config.replyChunkSize)) {
    commands.push({ ...commandBase(msg, 'send_text'), text: chunk });
  }

  for (const attachment of attachments) {
    const kind = attachment.kind.replace(/^send_/, '').replace('audio', 'voice');
    const target = attachment.path;
    const remote = isRemoteUrl(target);
    const fail = (reason) => commands.push({
      ...commandBase(msg, 'send_text'),
      text: `附件发送失败：${target}\n原因：${reason}`,
    });

    let meta;
    try {
      if (restricted) {
        // Restricted (group / non-admin) chats may ONLY send files the model
        // generated this turn — image_generate writes them under
        // config.restrictedSendableRoots. URLs and any other local path are
        // refused, so a pre-existing local file can never be exfiltrated.
        if (remote) {
          fail('群聊/受限模式只能发送模型本回合生成的图片，不接受 URL。');
          continue;
        }
        const verdict = resolveWithinRoots(target, config.restrictedSendableRoots);
        if (!verdict.ok) {
          fail(`群聊/受限模式只能发送模型生成的图片（限目录 ${config.restrictedSendableRoots.join(', ')}）：${verdict.reason}`);
          continue;
        }
        meta = registerLocalFile(target, kind);
      } else if (remote) {
        meta = await downloadRemoteFile(target, kind);
      } else {
        const status = validateAttachmentPath(target);
        if (!status.ok) {
          fail(status.reason);
          continue;
        }
        meta = registerLocalFile(target, kind);
      }
    } catch (error) {
      logger.warn('attachment failed', target, error.message);
      fail(error.message);
      continue;
    }

    commands.push({
      ...commandBase(msg, kind === 'image' ? 'send_image' : 'send_file'),
      file: publicFileDescriptor(req, meta),
      original_path: target,
    });
  }

  return commands;
}

function enqueueChat(scopedChatId, task) {
  const previous = queueByChat.get(scopedChatId) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  queueByChat.set(scopedChatId, next.finally(() => {
    if (queueByChat.get(scopedChatId) === next) queueByChat.delete(scopedChatId);
  }));
  return next;
}

function popPending(queueKey) {
  const queue = pendingByDevice.get(queueKey) || [];
  pendingByDevice.set(queueKey, []);
  return queue;
}

function pushPending(queueKey, commands) {
  if (!commands.length) return;
  const waiters = waitersByDevice.get(queueKey) || [];
  if (waiters.length) {
    waitersByDevice.set(queueKey, []);
    for (const resolve of waiters) resolve(commands);
    return;
  }
  const queue = pendingByDevice.get(queueKey) || [];
  queue.push(...commands);
  pendingByDevice.set(queueKey, queue);
}

export function pendingCommands(deviceId, provider = config.defaultProvider) {
  return popPending(providerDeviceKey(provider, deviceId));
}

export async function waitForCommands(deviceId, timeoutMs, provider = config.defaultProvider) {
  const queueKey = providerDeviceKey(provider, deviceId);
  const existing = popPending(queueKey);
  if (existing.length) return existing;
  return new Promise((resolve) => {
    const waiters = waitersByDevice.get(queueKey) || [];
    waiters.push(resolve);
    waitersByDevice.set(queueKey, waiters);
    setTimeout(() => {
      const current = waitersByDevice.get(queueKey) || [];
      waitersByDevice.set(queueKey, current.filter((item) => item !== resolve));
      resolve([]);
    }, timeoutMs);
  });
}

export function builtInCommand(msg, text) {
  const command = String(text || '').trim();
  if (command === '/ping') {
    return [{ ...commandBase(msg, 'send_text'), text: 'pong' }];
  }
  if (command === '/id') {
    return [{
      ...commandBase(msg, 'send_text'),
      text: [
        `provider: ${msg.provider}`,
        `device_id: ${msg.device_id}`,
        `chat_id: ${msg.chat_id}`,
        `chat_name: ${msg.chat_name}`,
        `sender_id: ${msg.sender_id}`,
        `sender_name: ${msg.sender_name}`,
        `is_group: ${msg.is_group}`,
      ].join('\n'),
    }];
  }
  if (command === '/reset') {
    const scopedChat = providerChatKey(msg.provider, msg.chat_id);
    resetNonceByChat.set(scopedChat, (resetNonceByChat.get(scopedChat) || 0) + 1);
    saveResetNonces();
    return [{ ...commandBase(msg, 'send_text'), text: '已重置当前微信会话的 Hermes 上下文。' }];
  }
  if (command === '/help') {
    return [{
      ...commandBase(msg, 'send_text'),
      text: [
        'Hermes WeChat adapter commands:',
        '/ping - check adapter',
        '/id - show current chat identity',
        '/reset - reset current Hermes conversation',
        '/help - show this message',
      ].join('\n'),
    }];
  }
  return null;
}

export function shouldProcessInboundMessage(msg, dedupeWindowMs = config.dedupeWindowSeconds * 1000, now = Date.now()) {
  const key = buildMessageDedupeKey(msg);
  const previous = recentInbound.get(key);
  if (typeof previous === 'number' && now - previous < dedupeWindowMs) return false;
  recentInbound.set(key, now);
  for (const [existingKey, timestamp] of recentInbound.entries()) {
    if (now - timestamp >= dedupeWindowMs) recentInbound.delete(existingKey);
  }
  return true;
}

export async function handleIncomingMessage(req, raw, {
  fallbackDeviceId = 'default',
  fallbackProvider = config.defaultProvider,
  deliver,
  enqueueWhenNoDeliver = false,
} = {}) {
  const msg = normalizeMessage(raw, fallbackDeviceId, fallbackProvider);
  if (!msg.chat_id) throw new Error('message.chat_id is required');
  if (!shouldProcessInboundMessage(msg)) {
    logger.info('dedupe skip', `provider=${msg.provider}`, `chat=${msg.chat_id}`);
    return [];
  }

  let text = msg.text;
  if (msg.is_group) {
    if (!shouldAcceptGroup(msg)) return [];
    text = cleanGroupText(text);
  } else if (!shouldAcceptDm(msg)) {
    return [];
  }

  const builtIn = builtInCommand(msg, text);
  const queueKey = providerDeviceKey(msg.provider, msg.device_id);
  if (builtIn) {
    if (deliver) deliver(queueKey, builtIn);
    else if (enqueueWhenNoDeliver) pushPending(queueKey, builtIn);
    return builtIn;
  }

  const accessProfile = toolAccessProfile(msg);
  const scopedChatId = providerChatKey(msg.provider, msg.chat_id);
  const commands = await enqueueChat(scopedChatId, async () => {
    logger.info(
      'message',
      `provider=${msg.provider}`,
      `device=${msg.device_id}`,
      `chat=${msg.chat_name || msg.chat_id}`,
      `group=${msg.is_group}`,
      `access=${accessProfile.access}`,
      `admin=${accessProfile.isAdmin}`,
    );
    try {
      const answer = await askHermes({
        conversation: createConversationKey(msg.provider, msg.chat_id),
        input: buildPrompt(msg, text, accessProfile),
        instructions: bridgeInstructions(accessProfile),
        access: accessProfile.access,
      });
      return await commandsFromAnswer(req, msg, answer, accessProfile);
    } catch (error) {
      logger.error('Hermes failed:', error);
      return [{ ...commandBase(msg, 'send_text'), text: `Hermes 处理失败：${error.message}` }];
    }
  });

  if (deliver) deliver(queueKey, commands);
  else if (enqueueWhenNoDeliver) pushPending(queueKey, commands);
  return commands;
}

export function enqueueCommands(deviceId, commands, provider = config.defaultProvider) {
  pushPending(providerDeviceKey(provider, deviceId), commands);
}

export function resetAdapterStateForTests() {
  resetNonceByChat.clear();
  queueByChat.clear();
  pendingByDevice.clear();
  waitersByDevice.clear();
  recentInbound.clear();
}
