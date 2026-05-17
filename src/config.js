import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

const SUPPORTED_PROVIDERS = ['gewechat', 'windows_sidecar'];
const DEFAULT_PROVIDER = 'gewechat';
const DEFAULT_FALLBACK_PROVIDER = 'windows_sidecar';

function boolEnvFrom(env, name, defaultValue = false) {
  const raw = env[name];
  if (raw == null || raw === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function intEnvFrom(env, name, defaultValue) {
  const raw = env[name];
  if (raw == null || raw === '') return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function listEnvFrom(env, name) {
  return String(env[name] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeProviderName(name, fallback = DEFAULT_PROVIDER) {
  const value = String(name || '').trim().toLowerCase();
  return SUPPORTED_PROVIDERS.includes(value) ? value : fallback;
}

function normalizeBridgeMode(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['single', 'dual'].includes(normalized) ? normalized : 'dual';
}

function normalizeTransport(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['webhook', 'websocket'].includes(normalized) ? normalized : fallback;
}

function providerConfig(env, providerName, defaults) {
  const prefix = providerName === 'windows_sidecar' ? 'WINDOWS_SIDECAR' : providerName.toUpperCase();
  const transport = normalizeTransport(env[`${prefix}_TRANSPORT`], defaults.transport);
  const webhookEnabled = boolEnvFrom(env, `${prefix}_WEBHOOK_ENABLED`, defaults.webhookEnabled ?? transport === 'webhook');
  const websocketEnabled = boolEnvFrom(env, `${prefix}_WEBSOCKET_ENABLED`, defaults.websocketEnabled ?? transport === 'websocket');

  return {
    name: providerName,
    enabled: boolEnvFrom(env, `${prefix}_ENABLED`, defaults.enabled),
    transport,
    webhookEnabled,
    websocketEnabled,
  };
}

export function loadConfig(env = process.env) {
  const dataDir = env.DATA_DIR || '/root/hermes-wechat-adapter/data';
  const filesDir = env.FILES_DIR || path.join(dataDir, 'files');

  const providers = {
    gewechat: providerConfig(env, 'gewechat', {
      enabled: true,
      transport: 'webhook',
      webhookEnabled: true,
      websocketEnabled: false,
    }),
    windows_sidecar: providerConfig(env, 'windows_sidecar', {
      enabled: true,
      transport: 'websocket',
      webhookEnabled: false,
      websocketEnabled: true,
    }),
  };

  const enabledProviders = Object.values(providers)
    .filter((provider) => provider.enabled)
    .map((provider) => provider.name);

  const defaultProvider = normalizeProviderName(
    env.WECHAT_DEFAULT_PROVIDER,
    enabledProviders[0] || DEFAULT_PROVIDER,
  );

  const fallbackProvider = normalizeProviderName(
    env.WECHAT_FALLBACK_PROVIDER,
    defaultProvider === 'gewechat' ? DEFAULT_FALLBACK_PROVIDER : DEFAULT_PROVIDER,
  );

  return {
    host: env.ADAPTER_HOST || '0.0.0.0',
    port: intEnvFrom(env, 'ADAPTER_PORT', 8787),
    authToken: env.ADAPTER_AUTH_TOKEN || '',
    publicBaseUrl: (env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),

    hermesApiBaseUrl: (env.HERMES_API_BASE_URL || 'http://127.0.0.1:8642/v1').replace(/\/+$/, ''),
    hermesApiKey: env.HERMES_API_KEY || '',
    hermesModel: env.HERMES_MODEL || 'hermes-agent',
    restrictedHermesApiBaseUrl: (env.HERMES_RESTRICTED_API_BASE_URL || '').replace(/\/+$/, ''),
    restrictedHermesApiKey: env.HERMES_RESTRICTED_API_KEY || '',
    restrictedHermesModel: env.HERMES_RESTRICTED_MODEL || env.HERMES_MODEL || 'hermes-agent',

    dmPolicy: (env.WECHAT_DM_POLICY || 'open').toLowerCase(),
    allowedContacts: listEnvFrom(env, 'WECHAT_ALLOWED_CONTACTS'),
    adminUsers: listEnvFrom(env, 'WECHAT_ADMIN_USERS'),
    groupPolicy: (env.WECHAT_GROUP_POLICY || 'disabled').toLowerCase(),
    allowedRooms: listEnvFrom(env, 'WECHAT_ALLOWED_ROOMS'),
    requireMentionInGroups: boolEnvFrom(env, 'WECHAT_REQUIRE_MENTION_IN_GROUPS', true),
    activationPrefixes: listEnvFrom(env, 'WECHAT_ACTIVATION_PREFIXES'),
    botAlias: env.BOT_ALIAS || 'Hermes',

    replyChunkSize: intEnvFrom(env, 'REPLY_CHUNK_SIZE', 1800),
    maxUploadBytes: intEnvFrom(env, 'MAX_UPLOAD_BYTES', 50 * 1024 * 1024),
    dataDir,
    filesDir,
    // Restricted (group) chats may only send files located under these roots —
    // the Hermes image_generate output dir. Anything else is a pre-existing
    // local file and is refused.
    restrictedSendableRoots: listEnvFrom(env, 'WECHAT_RESTRICTED_SENDABLE_ROOTS').length
      ? listEnvFrom(env, 'WECHAT_RESTRICTED_SENDABLE_ROOTS')
      : ['/root/.hermes/generated-images'],
    commandPollTimeoutMs: intEnvFrom(env, 'COMMAND_POLL_TIMEOUT_MS', 25000),
    instructionsExtra: env.HERMES_INSTRUCTIONS_EXTRA || '',

    bridgeMode: normalizeBridgeMode(env.WECHAT_BRIDGE_MODE),
    defaultProvider,
    fallbackProvider,
    dedupeWindowSeconds: intEnvFrom(env, 'WECHAT_DEDUPE_WINDOW_SECONDS', 60),
    gewechatApiBaseUrl: (env.GEWECHAT_API_BASE_URL || '').replace(/\/+$/, ''),
    gewechatToken: env.GEWECHAT_TOKEN || '',
    gewechatAppId: env.GEWECHAT_APP_ID || '',
    gewechatCallbackUrl: (env.GEWECHAT_CALLBACK_URL || '').replace(/\/+$/, ''),
    providers,
    enabledProviders,
    supportedProviders: [...SUPPORTED_PROVIDERS],
  };
}

export const config = loadConfig();

export function validateConfig(cfg = config) {
  const missing = [];
  if (!cfg.authToken) missing.push('ADAPTER_AUTH_TOKEN');
  if (!cfg.hermesApiKey) missing.push('HERMES_API_KEY');
  if (cfg.restrictedHermesApiBaseUrl && !cfg.restrictedHermesApiKey) missing.push('HERMES_RESTRICTED_API_KEY');
  if (cfg.restrictedHermesApiKey && !cfg.restrictedHermesApiBaseUrl) missing.push('HERMES_RESTRICTED_API_BASE_URL');
  return missing;
}

export { SUPPORTED_PROVIDERS, normalizeProviderName };
