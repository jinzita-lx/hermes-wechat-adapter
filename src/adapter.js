import crypto from 'node:crypto';
import { config } from './config.js';
import { askHermes } from './hermes.js';
import { splitDirectives, validateAttachmentPath } from './directives.js';
import { chunkText, escapeRegExp, hasActivationPrefix, stripActivationPrefix } from './text.js';
import { publicFileDescriptor, registerLocalFile, resolveMessageAttachment } from './files.js';
import { logger } from './logger.js';
import { buildMessageDedupeKey, providerDeviceKey, resolveProviderName } from './providers.js';

const resetNonceByChat = new Map();
const queueByChat = new Map();
const pendingByDevice = new Map();
const waitersByDevice = new Map();
const recentInbound = new Map();

function stableId(value) {
  return crypto.createHash('sha256').update(String(value)).digest('base64url').slice(0, 32);
}

function providerChatKey(provider, chatId) {
  return `${resolveProviderName(provider, config.defaultProvider)}:${chatId}`;
}

export function createConversationKey(provider, chatId) {
  const scopedChat = providerChatKey(provider, chatId);
  const nonce = resetNonceByChat.get(scopedChat) || 0;
  return `wechat-personal-${stableId(`${scopedChat}:${nonce}`)}`;
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

export function toolAccessProfile(msg) {
  if (msg.is_group) {
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
      ? 'Do not emit send_file/send_image/send_video/send_voice directives that depend on creating or reading local files.'
      : 'If you create a file that should be sent back to WeChat, include exactly one directive on its own line: [[send_file:/absolute/path/to/file]].',
    isRestricted
      ? 'In restricted mode, answer with plain text only.'
      : 'Images, videos, and voice/audio may use [[send_image:/path]], [[send_video:/path]], or [[send_voice:/path]].',
    isRestricted ? '' : 'Only use send directives for real files that exist on this Linux machine.',
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

function commandsFromAnswer(req, msg, answer) {
  const { text, attachments, residuals } = splitDirectives(answer);
  if (residuals && residuals.length) logger.warn('directives: stripped non-directive bracket tokens', residuals);
  const commands = [];

  for (const chunk of chunkText(text, config.replyChunkSize)) {
    commands.push({ ...commandBase(msg, 'send_text'), text: chunk });
  }

  for (const attachment of attachments) {
    const status = validateAttachmentPath(attachment.path);
    if (!status.ok) {
      commands.push({
        ...commandBase(msg, 'send_text'),
        text: `附件发送失败：${attachment.path}\n原因：${status.reason}`,
      });
      continue;
    }
    const kind = attachment.kind.replace(/^send_/, '').replace('audio', 'voice');
    const meta = registerLocalFile(attachment.path, kind);
    commands.push({
      ...commandBase(msg, kind === 'image' ? 'send_image' : 'send_file'),
      file: publicFileDescriptor(req, meta),
      original_path: attachment.path,
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
      return commandsFromAnswer(req, msg, answer);
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
