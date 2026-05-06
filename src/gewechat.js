function valueOf(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node?.string === 'string') return node.string;
  return String(node || '');
}

function topLevel(payload, a, b) {
  return payload?.[a] ?? payload?.[b];
}

function dataOf(payload) {
  return payload?.Data || payload?.data || {};
}

function stripGroupSenderPrefix(content) {
  const raw = String(content || '');
  const idx = raw.indexOf(':\n');
  if (idx === -1) return { senderId: '', text: raw };
  return {
    senderId: raw.slice(0, idx).trim(),
    text: raw.slice(idx + 2).trim(),
  };
}

export function extractGewechatAtSelf({ msgSource = '', pushContent = '', botWxid = '' }) {
  const xml = String(msgSource || '');
  const bot = String(botWxid || '');
  const match = xml.match(/<atuserlist><!\[CDATA\[(.*?)\]\]><\/atuserlist>/i);
  if (match) {
    const rawList = match[1] || '';
    const items = rawList.split(',').map((item) => item.trim()).filter(Boolean);
    if (bot && items.includes(bot)) return true;
  }
  return String(pushContent || '').includes('在群聊中@了你');
}

export function normalizeGewechatWebhook(payload = {}) {
  const typeName = String(topLevel(payload, 'TypeName', 'type_name') || '');
  const appId = String(topLevel(payload, 'Appid', 'appid') || '');
  const botWxid = String(topLevel(payload, 'Wxid', 'wxid') || '');
  const data = dataOf(payload);
  const msgType = Number(data.MsgType ?? data.msgType ?? 0);

  if (typeName !== 'AddMsg' || msgType !== 1) return null;

  const fromUser = valueOf(data.FromUserName);
  const toUser = valueOf(data.ToUserName);
  const content = valueOf(data.Content);
  const providerMessageId = String(data.NewMsgId || data.MsgId || '').trim();
  const createTime = data.CreateTime ? new Date(Number(data.CreateTime) * 1000).toISOString() : new Date().toISOString();
  const isGroup = fromUser.endsWith('@chatroom') || toUser.endsWith('@chatroom');

  const groupParsed = isGroup ? stripGroupSenderPrefix(content) : { senderId: fromUser, text: content };
  const chatId = fromUser.endsWith('@chatroom') ? fromUser : (toUser.endsWith('@chatroom') ? toUser : fromUser);

  return {
    provider: 'gewechat',
    app_id: appId,
    bot_wxid: botWxid,
    provider_message_id: providerMessageId,
    id: providerMessageId,
    chat_id: chatId,
    chat_name: chatId,
    sender_id: isGroup ? groupParsed.senderId : fromUser,
    sender_name: isGroup ? groupParsed.senderId : fromUser,
    text: groupParsed.text,
    is_group: isGroup,
    at_self: isGroup ? extractGewechatAtSelf({
      msgSource: data.MsgSource || data.msgSource || '',
      pushContent: data.PushContent || data.pushContent || '',
      botWxid,
    }) : false,
    created_at: createTime,
    attachments: [],
    raw: payload,
  };
}

export async function sendGewechatText({
  baseUrl,
  token,
  appId,
  toWxid,
  content,
  ats = '',
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, '')}/message/postText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GEWE-TOKEN': token,
    },
    body: JSON.stringify({
      appId,
      toWxid,
      content,
      ats,
    }),
  });

  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  if (!response.ok) {
    throw new Error(payload?.msg || payload?.error?.message || raw || `Gewechat HTTP ${response.status}`);
  }
  if (payload?.ret != null && Number(payload.ret) !== 200) {
    throw new Error(payload?.msg || `Gewechat ret=${payload.ret}`);
  }
  return payload;
}
