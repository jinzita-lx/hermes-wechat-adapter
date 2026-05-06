import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('provider-aware route config for webhook/gewechat and websocket/windows_sidecar defaults', () => {
  const cfg = loadConfig({
    ADAPTER_AUTH_TOKEN: 'token',
    HERMES_API_KEY: 'hermes-key',
  });

  assert.equal(cfg.providers.gewechat.webhookEnabled, true);
  assert.equal(cfg.providers.gewechat.websocketEnabled, false);
  assert.equal(cfg.providers.windows_sidecar.websocketEnabled, true);
  assert.equal(cfg.providers.windows_sidecar.webhookEnabled, false);
});

test('provider transport toggles can disable webhook and websocket independently', () => {
  const cfg = loadConfig({
    ADAPTER_AUTH_TOKEN: 'token',
    HERMES_API_KEY: 'hermes-key',
    GEWECHAT_ENABLED: 'true',
    GEWECHAT_WEBHOOK_ENABLED: 'false',
    GEWECHAT_WEBSOCKET_ENABLED: 'true',
    WINDOWS_SIDECAR_ENABLED: 'false',
  });

  assert.equal(cfg.providers.gewechat.enabled, true);
  assert.equal(cfg.providers.gewechat.webhookEnabled, false);
  assert.equal(cfg.providers.gewechat.websocketEnabled, true);
  assert.equal(cfg.providers.windows_sidecar.enabled, false);
});

test('invalid route provider names fall back via config normalization', () => {
  const cfg = loadConfig({
    ADAPTER_AUTH_TOKEN: 'token',
    HERMES_API_KEY: 'hermes-key',
    WECHAT_DEFAULT_PROVIDER: 'gewechat',
  });

  assert.equal(cfg.defaultProvider, 'gewechat');
  assert.ok(cfg.supportedProviders.includes('gewechat'));
  assert.ok(cfg.supportedProviders.includes('windows_sidecar'));
});
