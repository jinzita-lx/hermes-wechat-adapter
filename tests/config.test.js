import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('loadConfig uses provider-aware defaults', () => {
  const cfg = loadConfig({
    ADAPTER_AUTH_TOKEN: 'token',
    HERMES_API_KEY: 'hermes-key',
  });

  assert.equal(cfg.bridgeMode, 'dual');
  assert.equal(cfg.defaultProvider, 'gewechat');
  assert.equal(cfg.fallbackProvider, 'windows_sidecar');
  assert.equal(cfg.dedupeWindowSeconds, 60);

  assert.deepEqual(cfg.enabledProviders, ['gewechat', 'windows_sidecar']);
  assert.equal(cfg.providers.gewechat.enabled, true);
  assert.equal(cfg.providers.gewechat.transport, 'webhook');
  assert.equal(cfg.providers.gewechat.webhookEnabled, true);
  assert.equal(cfg.providers.gewechat.websocketEnabled, false);

  assert.equal(cfg.providers.windows_sidecar.enabled, true);
  assert.equal(cfg.providers.windows_sidecar.transport, 'websocket');
  assert.equal(cfg.providers.windows_sidecar.webhookEnabled, false);
  assert.equal(cfg.providers.windows_sidecar.websocketEnabled, true);
});

test('loadConfig respects explicit provider overrides', () => {
  const cfg = loadConfig({
    ADAPTER_AUTH_TOKEN: 'token',
    HERMES_API_KEY: 'hermes-key',
    WECHAT_BRIDGE_MODE: 'single',
    WECHAT_DEFAULT_PROVIDER: 'windows_sidecar',
    WECHAT_FALLBACK_PROVIDER: 'gewechat',
    WECHAT_DEDUPE_WINDOW_SECONDS: '90',
    GEWECHAT_ENABLED: 'false',
    GEWECHAT_TRANSPORT: 'websocket',
    GEWECHAT_WEBSOCKET_ENABLED: 'true',
    WINDOWS_SIDECAR_TRANSPORT: 'webhook',
    WINDOWS_SIDECAR_WEBHOOK_ENABLED: 'true',
  });

  assert.equal(cfg.bridgeMode, 'single');
  assert.equal(cfg.defaultProvider, 'windows_sidecar');
  assert.equal(cfg.fallbackProvider, 'gewechat');
  assert.equal(cfg.dedupeWindowSeconds, 90);

  assert.equal(cfg.providers.gewechat.enabled, false);
  assert.equal(cfg.providers.gewechat.transport, 'websocket');
  assert.equal(cfg.providers.gewechat.websocketEnabled, true);

  assert.equal(cfg.providers.windows_sidecar.transport, 'webhook');
  assert.equal(cfg.providers.windows_sidecar.webhookEnabled, true);
});

test('loadConfig falls back safely for invalid provider names', () => {
  const cfg = loadConfig({
    ADAPTER_AUTH_TOKEN: 'token',
    HERMES_API_KEY: 'hermes-key',
    WECHAT_DEFAULT_PROVIDER: 'unknown-provider',
    WECHAT_FALLBACK_PROVIDER: 'also-unknown',
  });

  assert.equal(cfg.defaultProvider, 'gewechat');
  assert.equal(cfg.fallbackProvider, 'windows_sidecar');
});
