import fs from 'node:fs';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { config, validateConfig } from './config.js';
import { isAuthorized } from './auth.js';
import { sendJson, sendText, readBody, readJson } from './http.js';
import { ensureFileDirs, getFile, publicFileDescriptor, saveUploadedFile } from './files.js';
import { checkHermes } from './hermes.js';
import { normalizeGewechatWebhook, sendGewechatText } from './gewechat.js';
import { enqueueCommands, handleIncomingMessage, pendingCommands, waitForCommands } from './adapter.js';
import { logger } from './logger.js';
import { providerAllowsTransport, providerReadinessSummary, resolveIngressContext } from './ingress.js';
import { resolveProviderName } from './providers.js';

const socketsByDevice = new Map();

function notFound(res) {
  sendJson(res, 404, { error: 'not_found' });
}

function unauthorized(res) {
  sendJson(res, 401, { error: 'unauthorized' });
}

function badRequest(res, message) {
  sendJson(res, 400, { error: 'bad_request', message });
}

function providerUnavailable(res, provider, transport) {
  sendJson(res, 409, { error: 'provider_transport_unavailable', provider, transport });
}

function withAuth(req, res, url) {
  if (!isAuthorized(req, url)) {
    unauthorized(res);
    return false;
  }
  return true;
}

function socketKey(provider, deviceId) {
  return `${provider}:${deviceId}`;
}

function deliver(queueKey, commands) {
  const ws = socketsByDevice.get(queueKey);
  if (ws && ws.readyState === WebSocket.OPEN) {
    for (const command of commands) {
      ws.send(JSON.stringify({ type: 'command', command }));
    }
    return;
  }
  const [provider, deviceId] = String(queueKey).split(':');
  enqueueCommands(deviceId, commands, provider);
}

async function handleUpload(req, res, url) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  let file;
  if (contentType.includes('application/json')) {
    const payload = await readJson(req, config.maxUploadBytes + 4096);
    if (!payload.content_base64) throw new Error('content_base64 is required');
    const buffer = Buffer.from(payload.content_base64, 'base64');
    file = await saveUploadedFile({
      buffer,
      filename: payload.filename,
      type: payload.type || 'file',
      source: 'windows-json',
    });
  } else {
    const buffer = await readBody(req, config.maxUploadBytes);
    const filename = url.searchParams.get('filename') || req.headers['x-file-name'] || 'wechat-file';
    const type = url.searchParams.get('type') || req.headers['x-file-type'] || 'file';
    file = await saveUploadedFile({ buffer, filename, type, source: 'windows-raw' });
  }
  sendJson(res, 201, { file: publicFileDescriptor(req, file), local_path: file.path });
}

async function handleInboundMessage(req, res, url, transport) {
  if (!withAuth(req, res, url)) return;
  const payload = await readJson(req, config.maxUploadBytes);
  const ingress = resolveIngressContext({
    config,
    pathname: url.pathname,
    payloadProvider: payload.provider,
    transport,
  });

  if (!providerAllowsTransport(config, ingress.provider, transport)) {
    providerUnavailable(res, ingress.provider, transport);
    return;
  }

  const normalizedPayload = ingress.provider === 'gewechat'
    ? normalizeGewechatWebhook(payload)
    : { ...payload, provider: ingress.provider };

  if (ingress.provider === 'gewechat' && !normalizedPayload) {
    sendText(res, 200, 'success');
    return;
  }

  const commands = await handleIncomingMessage(req, normalizedPayload, {
    fallbackDeviceId: normalizedPayload?.device_id || payload.device_id || (ingress.provider === 'gewechat' ? 'gewechat-webhook' : 'http-sidecar'),
    fallbackProvider: ingress.provider,
  });

  if (ingress.provider === 'gewechat') {
    for (const command of commands) {
      if (command.action !== 'send_text' || !command.text) continue;
      await sendGewechatText({
        baseUrl: config.gewechatApiBaseUrl,
        token: config.gewechatToken,
        appId: normalizedPayload?.app_id || config.gewechatAppId,
        toWxid: command.chat_id,
        content: command.text,
        ats: '',
      });
    }
    sendText(res, 200, 'success');
    return;
  }

  sendJson(res, 200, { provider: ingress.provider, commands });
}

async function handleHttp(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok', service: 'hermes-wechat-adapter' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/ready') {
      if (!withAuth(req, res, url)) return;
      const health = await checkHermes();
      sendJson(res, 200, {
        status: 'ok',
        hermes: health,
        providers: providerReadinessSummary(config),
        bridge_mode: config.bridgeMode,
        default_provider: config.defaultProvider,
        fallback_provider: config.fallbackProvider,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/files') {
      if (!withAuth(req, res, url)) return;
      await handleUpload(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
      if (!withAuth(req, res, url)) return;
      const id = decodeURIComponent(url.pathname.slice('/files/'.length));
      const file = getFile(id);
      if (!file) {
        sendJson(res, 404, { error: 'file_not_found' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': file.size,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(file.filename)}"`,
      });
      fs.createReadStream(file.path).pipe(res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/messages') {
      await handleInboundMessage(req, res, url, 'webhook');
      return;
    }

    if (req.method === 'POST' && /^\/providers\/[^/]+\/webhook$/.test(url.pathname)) {
      await handleInboundMessage(req, res, url, 'webhook');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/commands') {
      if (!withAuth(req, res, url)) return;
      const provider = resolveProviderName(url.searchParams.get('provider'), config.defaultProvider);
      if (!providerAllowsTransport(config, provider, 'webhook') && !providerAllowsTransport(config, provider, 'websocket')) {
        providerUnavailable(res, provider, 'poll');
        return;
      }
      const deviceId = url.searchParams.get('device_id') || 'http-sidecar';
      const timeoutMs = Math.min(
        Number.parseInt(url.searchParams.get('timeout_ms') || `${config.commandPollTimeoutMs}`, 10),
        config.commandPollTimeoutMs,
      );
      const commands = timeoutMs > 0
        ? await waitForCommands(deviceId, timeoutMs, provider)
        : pendingCommands(deviceId, provider);
      sendJson(res, 200, { provider, commands });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/commands/ack') {
      if (!withAuth(req, res, url)) return;
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      sendText(res, 200, 'hermes-wechat-adapter\n');
      return;
    }

    notFound(res);
  } catch (error) {
    logger.error('http error:', error);
    const status = error.message?.startsWith('message.chat_id is required') ? 400 : 500;
    sendJson(res, status, { error: error.message });
  }
}

function attachWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    if (!isAuthorized(req, url)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const provider = resolveProviderName(url.searchParams.get('provider'), 'windows_sidecar');
    if (!providerAllowsTransport(config, provider, 'websocket')) {
      socket.write('HTTP/1.1 409 Conflict\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, url, provider);
    });
  });

  wss.on('connection', (ws, req, url, providerFromUpgrade) => {
    const provider = resolveProviderName(providerFromUpgrade || url.searchParams.get('provider'), 'windows_sidecar');
    const deviceId = url.searchParams.get('device_id') || 'windows-sidecar';
    const key = socketKey(provider, deviceId);
    socketsByDevice.set(key, ws);
    logger.info('ws connected', `provider=${provider}`, `device=${deviceId}`);
    ws.send(JSON.stringify({ type: 'hello', provider, device_id: deviceId, pending: pendingCommands(deviceId, provider) }));

    ws.on('message', async (raw) => {
      try {
        const payload = JSON.parse(raw.toString('utf8'));
        if (payload.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
          return;
        }
        if (payload.type === 'wechat.message') {
          await handleIncomingMessage(req, {
            ...payload,
            provider,
          }, {
            fallbackDeviceId: deviceId,
            fallbackProvider: provider,
            deliver,
          });
          return;
        }
        if (payload.type === 'command.ack') return;
        ws.send(JSON.stringify({ type: 'error', error: `unknown message type: ${payload.type}` }));
      } catch (error) {
        logger.error('ws message error:', error);
        ws.send(JSON.stringify({ type: 'error', error: error.message }));
      }
    });

    ws.on('close', () => {
      if (socketsByDevice.get(key) === ws) socketsByDevice.delete(key);
      logger.warn('ws closed', `provider=${provider}`, `device=${deviceId}`);
    });
  });
}

async function main() {
  const missing = validateConfig();
  if (missing.length) {
    logger.error(`Missing required config: ${missing.join(', ')}`);
    process.exit(1);
  }

  await ensureFileDirs();
  await checkHermes();

  const server = http.createServer((req, res) => {
    handleHttp(req, res).catch((error) => {
      logger.error('unhandled http error:', error);
      sendJson(res, 500, { error: error.message });
    });
  });
  attachWebSocket(server);

  server.listen(config.port, config.host, () => {
    logger.info(`listening on ${config.host}:${config.port}`);
  });
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
