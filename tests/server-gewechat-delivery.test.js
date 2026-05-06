import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { normalizeGewechatWebhook } from '../src/gewechat.js';

test('loadConfig reads gewechat real-adapter settings', () => {
  const cfg = loadConfig({
    ADAPTER_AUTH_TOKEN: 'token',
    HERMES_API_KEY: 'hermes-key',
    GEWECHAT_API_BASE_URL: 'http://127.0.0.1:2531/v2/api',
    GEWECHAT_TOKEN: 'gewe-token',
    GEWECHAT_APP_ID: 'wx_app_1',
    GEWECHAT_CALLBACK_URL: 'https://example.com/providers/gewechat/webhook',
  });

  assert.equal(cfg.gewechatApiBaseUrl, 'http://127.0.0.1:2531/v2/api');
  assert.equal(cfg.gewechatToken, 'gewe-token');
  assert.equal(cfg.gewechatAppId, 'wx_app_1');
  assert.equal(cfg.gewechatCallbackUrl, 'https://example.com/providers/gewechat/webhook');
});

test('gewechat callback payload can be normalized for live webhook delivery', () => {
  const normalized = normalizeGewechatWebhook({
    TypeName: 'AddMsg',
    Appid: 'wx_app_1',
    Wxid: 'wxid_bot',
    Data: {
      NewMsgId: 456,
      FromUserName: { string: 'wxid_user_1' },
      ToUserName: { string: 'wxid_bot' },
      MsgType: 1,
      Content: { string: '/ping' },
      CreateTime: 1733410112,
      MsgSource: '<msgsource></msgsource>',
      PushContent: '/ping',
    },
  });

  assert.equal(normalized.provider, 'gewechat');
  assert.equal(normalized.chat_id, 'wxid_user_1');
  assert.equal(normalized.text, '/ping');
});
