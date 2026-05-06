import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORTED_PROVIDERS,
  resolveProviderName,
  buildProviderMessageId,
  buildMessageDedupeKey,
  providerDeviceKey,
} from '../src/providers.js';

test('supported providers are stable', () => {
  assert.deepEqual(SUPPORTED_PROVIDERS, ['gewechat', 'windows_sidecar']);
});

test('resolveProviderName prefers supported value and falls back safely', () => {
  assert.equal(resolveProviderName('gewechat', 'windows_sidecar'), 'gewechat');
  assert.equal(resolveProviderName('WINDOWS_SIDECAR', 'gewechat'), 'windows_sidecar');
  assert.equal(resolveProviderName('', 'gewechat'), 'gewechat');
  assert.equal(resolveProviderName('unknown', 'windows_sidecar'), 'windows_sidecar');
});

test('buildProviderMessageId prefers stable provider ids', () => {
  assert.equal(
    buildProviderMessageId({ provider_message_id: 'msg-1', id: 'msg-2', message_id: 'msg-3' }),
    'msg-1',
  );
  assert.equal(
    buildProviderMessageId({ id: 'msg-2', message_id: 'msg-3' }),
    'msg-2',
  );
  assert.equal(buildProviderMessageId({ message_id: 'msg-3' }), 'msg-3');
});

test('buildMessageDedupeKey uses provider and provider message id when available', () => {
  const dedupeKey = buildMessageDedupeKey({
    provider: 'gewechat',
    provider_message_id: 'abc123',
    chat_id: 'room1',
    sender_id: 'user1',
    text: 'hello',
  });

  assert.equal(dedupeKey, 'gewechat:abc123');
});

test('buildMessageDedupeKey falls back to stable hash without provider message id', () => {
  const a = buildMessageDedupeKey({
    provider: 'windows_sidecar',
    chat_id: 'room1',
    sender_id: 'user1',
    text: 'hello',
    created_at: '2026-05-02T04:00:15.000Z',
  });
  const b = buildMessageDedupeKey({
    provider: 'windows_sidecar',
    chat_id: 'room1',
    sender_id: 'user1',
    text: 'hello',
    created_at: '2026-05-02T04:00:45.000Z',
  });
  const c = buildMessageDedupeKey({
    provider: 'windows_sidecar',
    chat_id: 'room1',
    sender_id: 'user1',
    text: 'different',
    created_at: '2026-05-02T04:00:45.000Z',
  });

  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^windows_sidecar:hash:/);
});

test('providerDeviceKey namespaces queues by provider and device', () => {
  assert.equal(providerDeviceKey('gewechat', 'device-a'), 'gewechat:device-a');
  assert.equal(providerDeviceKey('windows_sidecar', ''), 'windows_sidecar:default');
});
