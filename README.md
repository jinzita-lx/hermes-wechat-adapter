# Hermes WeChat Personal Adapter

Linux-side adapter for a remote Windows WeChat personal-account sidecar.

The Windows sidecar owns the real PC WeChat client. This adapter owns policy,
Hermes conversation state, file storage, and Hermes API calls.

## Runtime

- Hermes API: `http://127.0.0.1:8642/v1`
- Adapter: `0.0.0.0:8787`
- Auth: bearer token in `.env` as `ADAPTER_AUTH_TOKEN`

## Protocol

All HTTP requests except `/health` must include either:

```http
Authorization: Bearer <ADAPTER_AUTH_TOKEN>
```

or:

```http
X-Adapter-Token: <ADAPTER_AUTH_TOKEN>
```

WebSocket:

```text
ws://<linux-host>:8787/ws?device_id=windows-main&token=<ADAPTER_AUTH_TOKEN>
```

Incoming WeChat message:

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

Commands sent back to Windows look like:

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

File upload:

```bash
curl -X POST "http://<linux-host>:8787/files?filename=1.png&type=image" \
  -H "Authorization: Bearer <ADAPTER_AUTH_TOKEN>" \
  --data-binary "@1.png"
```

Use the returned `file.id` in message attachments:

```json
{"type": "image", "file_id": "returned-file-id"}
```

## Check

```bash
cd /root/hermes-wechat-adapter
npm run check
curl http://127.0.0.1:8787/health
```

## Service

The installed user service is:

```bash
systemctl --user status hermes-wechat-adapter.service
```

Logs:

```bash
journalctl --user -u hermes-wechat-adapter.service -f
```

## Safety Defaults

Group chats are disabled by default:

```env
WECHAT_GROUP_POLICY=disabled
```

After private-chat testing, enable specific groups only:

```env
WECHAT_GROUP_POLICY=allowlist
WECHAT_ALLOWED_ROOMS=room_id_or_topic
WECHAT_REQUIRE_MENTION_IN_GROUPS=true
```
