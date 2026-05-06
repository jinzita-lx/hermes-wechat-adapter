import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGewechatWebhook,
  extractGewechatAtSelf,
  sendGewechatText,
} from '../src/gewechat.js';

test('normalizeGewechatWebhook maps private text payload', () => {
  const msg = normalizeGewechatWebhook({
    TypeName: 'AddMsg',
    Appid: 'wx_app_1',
    Wxid: 'wxid_bot',
    Data: {
      MsgId: 123,
      NewMsgId: 456,
      FromUserName: { string: 'wxid_user_1' },
      ToUserName: { string: 'wxid_bot' },
      MsgType: 1,
      Content: { string: 'hello hermes' },
      CreateTime: 1733410112,
      MsgSource: '<msgsource></msgsource>',
      PushContent: 'hello hermes',
    },
  });

  assert.equal(msg.provider, 'gewechat');
  assert.equal(msg.app_id, 'wx_app_1');
  assert.equal(msg.bot_wxid, 'wxid_bot');
  assert.equal(msg.provider_message_id, '456');
  assert.equal(msg.chat_id, 'wxid_user_1');
  assert.equal(msg.sender_id, 'wxid_user_1');
  assert.equal(msg.text, 'hello hermes');
  assert.equal(msg.is_group, false);
  assert.equal(msg.at_self, false);
});

test('normalizeGewechatWebhook maps group text and mention', () => {
  const msg = normalizeGewechatWebhook({
    TypeName: 'AddMsg',
    Appid: 'wx_app_1',
    Wxid: 'wxid_bot',
    Data: {
      MsgId: 123,
      NewMsgId: 789,
      FromUserName: { string: '123456@chatroom' },
      ToUserName: { string: 'wxid_bot' },
      MsgType: 1,
      Content: { string: 'wxid_sender:\n@Hermes 测试一下' },
      CreateTime: 1733447040,
      MsgSource: '<msgsource><atuserlist><![CDATA[,wxid_bot]]></atuserlist></msgsource>',
      PushContent: '某人在群聊中@了你',
    },
  });

  assert.equal(msg.chat_id, '123456@chatroom');
  assert.equal(msg.sender_id, 'wxid_sender');
  assert.equal(msg.is_group, true);
  assert.equal(msg.at_self, true);
  assert.equal(msg.text, '@Hermes 测试一下');
});

test('extractGewechatAtSelf falls back to push content', () => {
  assert.equal(
    extractGewechatAtSelf({
      msgSource: '<msgsource></msgsource>',
      pushContent: '张三在群聊中@了你',
      botWxid: 'wxid_bot',
    }),
    true,
  );
});

test('normalizeGewechatWebhook returns null for non-text event', () => {
  const msg = normalizeGewechatWebhook({
    TypeName: 'ModContacts',
    Appid: 'wx_app_1',
    Wxid: 'wxid_bot',
    Data: { MsgType: 1 },
  });
  assert.equal(msg, null);
});

test('sendGewechatText posts official API request', async () => {
  const calls = [];
  const result = await sendGewechatText({
    baseUrl: 'http://127.0.0.1:2531/v2/api',
    token: 'gewe-token',
    appId: 'wx_app_1',
    toWxid: 'wxid_target',
    content: 'pong',
    ats: '',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        text: async () => JSON.stringify({ ret: 200, msg: '操作成功', data: { messageId: 'ok-1' } }),
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:2531/v2/api/message/postText');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['X-GEWE-TOKEN'], 'gewe-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    appId: 'wx_app_1',
    toWxid: 'wxid_target',
    content: 'pong',
    ats: '',
  });
  assert.deepEqual(result, { ret: 200, msg: '操作成功', data: { messageId: 'ok-1' } });
});

test('sendGewechatText throws useful error for provider failure', async () => {
  await assert.rejects(
    () => sendGewechatText({
      baseUrl: 'http://127.0.0.1:2531/v2/api',
      token: 'gewe-token',
      appId: 'wx_app_1',
      toWxid: 'wxid_target',
      content: 'pong',
      fetchImpl: async () => ({
        ok: true,
        text: async () => JSON.stringify({ ret: 500, msg: '发送失败' }),
      }),
    }),
    /发送失败/,
  );
});
