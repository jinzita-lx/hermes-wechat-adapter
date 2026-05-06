import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createConversationKey,
  builtInCommand,
  shouldProcessInboundMessage,
  resetAdapterStateForTests,
} from '../src/adapter.js';

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
