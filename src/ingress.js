import { resolveProviderName } from './providers.js';

export function providerAllowsTransport(config, provider, transport) {
  const normalizedProvider = resolveProviderName(provider, config.defaultProvider);
  const providerConfig = config.providers[normalizedProvider];
  if (!providerConfig?.enabled) return false;
  if (transport === 'webhook') return providerConfig.webhookEnabled;
  if (transport === 'websocket') return providerConfig.websocketEnabled;
  return false;
}

export function resolveIngressContext({ config, pathname, payloadProvider, transport }) {
  const match = /^\/providers\/([^/]+)\/webhook$/.exec(String(pathname || ''));
  const provider = match
    ? resolveProviderName(match[1], config.defaultProvider)
    : resolveProviderName(payloadProvider, config.defaultProvider);

  return {
    provider,
    transport,
    providerConfig: config.providers[provider],
  };
}

export function providerReadinessSummary(config) {
  return Object.fromEntries(
    Object.entries(config.providers).map(([name, provider]) => [name, {
      enabled: provider.enabled,
      transport: provider.transport,
      webhook_enabled: provider.webhookEnabled,
      websocket_enabled: provider.websocketEnabled,
    }]),
  );
}
