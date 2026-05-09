# Hermes 微信个人号适配器

为远端 Windows 微信个人号 sidecar 服务的 Linux 侧适配器。

Windows sidecar 持有真实的 PC 微信客户端。本适配器负责策略、Hermes 会话状态、文件存储以及 Hermes API 调用。

## 运行配置

- Hermes API：`http://127.0.0.1:8642/v1`
- 适配器：`0.0.0.0:8787`
- 鉴权：通过 `.env` 中的 `ADAPTER_AUTH_TOKEN` 提供 bearer token

## 协议

除 `/health` 外的所有 HTTP 请求都必须携带以下任一鉴权头：

```http
Authorization: Bearer <ADAPTER_AUTH_TOKEN>
```

或：

```http
X-Adapter-Token: <ADAPTER_AUTH_TOKEN>
```

WebSocket：

```text
ws://<linux-host>:8787/ws?device_id=windows-main&token=<ADAPTER_AUTH_TOKEN>
```

入站微信消息：

```json
{
  "type": "wechat.message",
  "message": {
    "id": "provider-message-id",
    "device_id": "windows-main",
    "chat_id": "contact-or-room-id",
    "chat_name": "chat display name",
    "is_group": false,
    "sender_id": "sender id",
    "sender_name": "sender display name",
    "text": "hello",
    "at_self": false,
    "attachments": []
  }
}
```

回传到 Windows 的指令格式：

```json
{
  "type": "command",
  "command": {
    "id": "uuid",
    "action": "send_text",
    "device_id": "windows-main",
    "chat_id": "contact-or-room-id",
    "chat_name": "chat display name",
    "text": "reply"
  }
}
```

文件上传：

```bash
curl -X POST "http://<linux-host>:8787/files?filename=1.png&type=image" \
  -H "Authorization: Bearer <ADAPTER_AUTH_TOKEN>" \
  --data-binary "@1.png"
```

把返回的 `file.id` 用在消息附件中：

```json
{"type": "image", "file_id": "returned-file-id"}
```

## 自检

```bash
cd /root/hermes-wechat-adapter
npm run check
curl http://127.0.0.1:8787/health
```

## 服务

已安装的 user service：

```bash
systemctl --user status hermes-wechat-adapter.service
```

日志：

```bash
journalctl --user -u hermes-wechat-adapter.service -f
```

## 默认安全策略

群聊默认禁用：

```env
WECHAT_GROUP_POLICY=disabled
```

私聊测试通过后，按白名单放开特定群：

```env
WECHAT_GROUP_POLICY=allowlist
WECHAT_ALLOWED_ROOMS=room_id_or_topic
WECHAT_REQUIRE_MENTION_IN_GROUPS=true
```
