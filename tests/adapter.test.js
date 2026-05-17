import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createConversationKey,
  builtInCommand,
  shouldProcessInboundMessage,
  resetAdapterStateForTests,
  toolAccessProfile,
  bridgeInstructions,
} from '../src/adapter.js';
import { config } from '../src/config.js';

test.beforeEach(() => {
  resetAdapterStateForTests();
});

test('conversation key is namespaced by provider', () => {
  const a = createConversationKey('gewechat', 'room-1');
  const b = createConversationKey('windows_sidecar', 'room-1');

  assert.notEqual(a, b);
  assert.match(a, /^wechat-personal-/);
  assert.match(b, /^wechat-personal-/);
});

test('builtInCommand /id includes provider metadata', () => {
  const commands = builtInCommand({
    provider: 'gewechat',
    device_id: 'device-1',
    chat_id: 'chat-1',
    chat_name: 'Chat 1',
    sender_id: 'user-1',
    sender_name: 'User 1',
    is_group: false,
  }, '/id');

  assert.equal(commands.length, 1);
  assert.match(commands[0].text, /provider: gewechat/);
});

test('loadConfig exposes admin and restricted Hermes settings', async () => {
  const { loadConfig } = await import('../src/config.js');
  const cfg = loadConfig({
    ADAPTER_AUTH_TOKEN: 'token',
    HERMES_API_KEY: 'full-key',
    HERMES_RESTRICTED_API_BASE_URL: 'http://127.0.0.1:8742/v1/',
    HERMES_RESTRICTED_API_KEY: 'restricted-key',
    HERMES_RESTRICTED_MODEL: 'restricted-model',
    WECHAT_ADMIN_USERS: '卷鑫菜,wxid_admin',
  });

  assert.deepEqual(cfg.adminUsers, ['卷鑫菜', 'wxid_admin']);
  assert.equal(cfg.restrictedHermesApiBaseUrl, 'http://127.0.0.1:8742/v1');
  assert.equal(cfg.restrictedHermesApiKey, 'restricted-key');
  assert.equal(cfg.restrictedHermesModel, 'restricted-model');
});

test('toolAccessProfile routes groups and non-admin DMs to restricted tools but admins to full tools', () => {
  const originalAdmins = [...config.adminUsers];
  config.adminUsers.splice(0, config.adminUsers.length, '卷鑫菜');

  assert.deepEqual(toolAccessProfile({
    is_group: true,
    chat_id: 'room-1',
    chat_name: '测试群',
    sender_id: 'user-2',
    sender_name: '普通成员',
  }), {
    access: 'restricted',
    isAdmin: false,
    reason: 'group_restricted',
  });

  assert.deepEqual(toolAccessProfile({
    is_group: false,
    chat_id: 'wxid-user',
    chat_name: '普通用户',
    sender_id: 'wxid-user',
    sender_name: '普通用户',
  }), {
    access: 'restricted',
    isAdmin: false,
    reason: 'dm_non_admin',
  });

  assert.deepEqual(toolAccessProfile({
    is_group: false,
    chat_id: 'wxid-admin',
    chat_name: '卷鑫菜',
    sender_id: 'wxid-admin',
    sender_name: '卷鑫菜',
  }), {
    access: 'full',
    isAdmin: true,
    reason: 'dm_admin',
  });

  config.adminUsers.splice(0, config.adminUsers.length, ...originalAdmins);
});

test('bridgeInstructions in restricted mode forbids shell/file access but allows the image tool', () => {
  const text = bridgeInstructions({ access: 'restricted', reason: 'group_restricted' });

  assert.match(text, /do NOT run local shell commands/i);
  assert.match(text, /do NOT inspect or modify local files/i);
  assert.match(text, /contact an administrator/i);
  // Image generation is allowed; the generated image is sent by its local path.
  assert.match(text, /generate images with the image generation tool/i);
  assert.match(text, /\[\[send_image:/);
  assert.match(text, /never put any other local filesystem path/i);
});

test('bridgeInstructions in full mode keeps local-path send directives', () => {
  const text = bridgeInstructions({ access: 'full', reason: 'dm_admin' });

  assert.match(text, /\[\[send_file:\/absolute\/path\/to\/file\]\]/);
  assert.match(text, /absolute local path .* or a public https URL/i);
});

test('shouldProcessInboundMessage suppresses duplicate provider message ids', () => {
  const first = shouldProcessInboundMessage({
    provider: 'gewechat',
    provider_message_id: 'msg-1',
    chat_id: 'chat-1',
    sender_id: 'user-1',
    text: 'hello',
  }, 60_000, 0);

  const second = shouldProcessInboundMessage({
    provider: 'gewechat',
    provider_message_id: 'msg-1',
    chat_id: 'chat-1',
    sender_id: 'user-1',
    text: 'hello',
  }, 60_000, 1_000);

  const third = shouldProcessInboundMessage({
    provider: 'windows_sidecar',
    provider_message_id: 'msg-1',
    chat_id: 'chat-1',
    sender_id: 'user-1',
    text: 'hello',
  }, 60_000, 2_000);

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(third, true);
});

test('shouldProcessInboundMessage allows same fallback hash after dedupe window expires', () => {
  const msg = {
    provider: 'gewechat',
    chat_id: 'chat-1',
    sender_id: 'user-1',
    text: 'hello',
    created_at: '2026-05-02T04:00:15.000Z',
  };

  assert.equal(shouldProcessInboundMessage(msg, 1_000, 0), true);
  assert.equal(shouldProcessInboundMessage(msg, 1_000, 200), false);
  assert.equal(shouldProcessInboundMessage(msg, 1_000, 1_500), true);
});
