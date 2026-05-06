import test from 'node:test';
import assert from 'node:assert/strict';
import {
  providerAllowsTransport,
  resolveIngressContext,
  providerReadinessSummary,
} from '../src/ingress.js';
import { loadConfig } from '../src/config.js';

test('resolveIngressContext forces provider from webhook route', () => {
  const cfg = loadConfig({
    ADAPTER_AUTH_TOKEN: 'token',
    HERMES_API_KEY: 'hermes-key',
  });

  const result = resolveIngressContext({
    config: cfg,
    pathname: '/providers/gewechat/webhook',
    payloadProvider: 'windows_sidecar',
    transport: 'webhook',
  });

  assert.equal(result.provider, 'gewechat');
  assert.equal(result.transport, 'webhook');
});

test('resolveIngressContext uses payload provider for compatibility route', () => {
  const cfg = loadConfig({
    ADAPTER_AUTH_TOKEN: 'token',
    HERMES_API_KEY: 'hermes-key',
    WECHAT_DEFAULT_PROVIDER: 'windows_sidecar',
  });

  const result = resolveIngressContext({
    config: cfg,
    pathname: '/v1/messages',
    payloadProvider: 'gewechat',
    transport: 'webhook',
  });

  assert.equal(result.provider, 'gewechat');
});

test('providerAllowsTransport rejects disabled or unsupported transport', () => {
  const cfg = loadConfig({
    ADAPTER_AUTH_TOKEN: 'token',
    HERMES_API_KEY: 'hermes-key',
    GEWECHAT_ENABLED: 'false',
  });

  assert.equal(providerAllowsTransport(cfg, 'gewechat', 'webhook'), false);
  assert.equal(providerAllowsTransport(cfg, 'windows_sidecar', 'webhook'), false);
  assert.equal(providerAllowsTransport(cfg, 'windows_sidecar', 'websocket'), true);
});

test('providerReadinessSummary returns compact provider status for /ready', () => {
  const cfg = loadConfig({
    ADAPTER_AUTH_TOKEN: 'token',
    HERMES_API_KEY: 'hermes-key',
  });

  const summary = providerReadinessSummary(cfg);
  assert.deepEqual(summary.gewechat, {
    enabled: true,
    transport: 'webhook',
    webhook_enabled: true,
    websocket_enabled: false,
  });
  assert.deepEqual(summary.windows_sidecar, {
    enabled: true,
    transport: 'websocket',
    webhook_enabled: false,
    websocket_enabled: true,
  });
});
