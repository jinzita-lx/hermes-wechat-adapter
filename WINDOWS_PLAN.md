# Windows Sidecar Implementation Plan

Goal: run PC WeChat on Windows, connect to the Linux adapter, forward inbound
messages to Hermes, and execute outbound send commands.

## Inputs From Linux

- Adapter URL: `http://<linux-host>:8787`
- WebSocket URL: `ws://<linux-host>:8787/ws?device_id=windows-main&token=<token>`
- Token source: copy `ADAPTER_AUTH_TOKEN` from `/root/hermes-wechat-adapter/.env`

If the two machines are not on the same trusted LAN, use Tailscale, ZeroTier,
SSH tunnel, or Cloudflare Tunnel. Do not expose `8787` directly to the public
internet without a private tunnel or firewall.

## Recommended MVP Provider

Use `wxauto` first.

Environment:

- Windows 10/11 or Windows Server with desktop session
- PC WeChat 3.9.x logged in
- Python 3.10-3.12
- `pip install wxauto websockets requests`

Provider choice:

- `wxauto`: lower risk, UI automation, easier MVP.
- WeChatFerry: stronger capability, higher maintenance and risk; keep for v2.

## Sidecar Responsibilities

1. Keep PC WeChat running and logged in.
2. Connect to Linux adapter WebSocket.
3. Listen for new private and group messages.
4. Normalize each message into the adapter JSON schema.
5. Upload images/files to `POST /files` before forwarding message metadata.
6. Send `wechat.message` events over WebSocket.
7. Receive commands and execute:
   - `send_text`
   - `send_image`
   - `send_file`
8. Send `command.ack` after execution.
9. Reconnect on failure.

## Minimal Protocol

Send inbound message:

```json
{
  "type": "wechat.message",
  "message": {
    "id": "unique-id",
    "device_id": "windows-main",
    "chat_id": "chat-name-or-id",
    "chat_name": "chat display name",
    "is_group": false,
    "sender_id": "sender",
    "sender_name": "sender",
    "text": "hello",
    "at_self": false,
    "attachments": []
  }
}
```

Receive command:

```json
{
  "type": "command",
  "command": {
    "id": "uuid",
    "action": "send_text",
    "chat_id": "chat-name-or-id",
    "text": "reply"
  }
}
```

File command:

```json
{
  "type": "command",
  "command": {
    "id": "uuid",
    "action": "send_file",
    "chat_id": "chat-name-or-id",
    "file": {
      "id": "file-id",
      "filename": "report.pdf",
      "download_url": "http://<linux-host>:8787/files/<file-id>"
    }
  }
}
```

Download files with the same bearer token.

## Suggested Windows Project Layout

```text
C:\HermesWeChatSidecar
  .env
  requirements.txt
  sidecar.py
  provider_wxauto.py
  protocol.py
  downloads\
  logs\
```

`.env`:

```env
ADAPTER_BASE_URL=http://<linux-host>:8787
ADAPTER_WS_URL=ws://<linux-host>:8787/ws?device_id=windows-main&token=<token>
ADAPTER_AUTH_TOKEN=<token>
DEVICE_ID=windows-main
WX_PROVIDER=wxauto
POLL_INTERVAL_SECONDS=2
```

`requirements.txt`:

```text
wxauto
websockets
requests
python-dotenv
```

## MVP Milestones

1. Verify PC WeChat automation:
   - `wx = WeChat()`
   - send text to File Transfer Assistant
   - read current chat messages

2. Verify Linux adapter connectivity:
   - `GET /health`
   - WebSocket connect and receive `hello`

3. Implement command execution:
   - `send_text`
   - download file then `send_file`
   - download image then `send_image`

4. Implement message forwarding:
   - private text messages first
   - group messages second
   - upload attachments after text path works

5. Add reliability:
   - reconnect loop
   - message id de-duplication
   - local error log
   - command ack

## First Test

1. Start Linux adapter.
2. Start Windows sidecar.
3. Send `/ping` to the WeChat account from a private chat.
4. Expected reply: `pong`.
5. Send `/id` and copy chat identifiers into Linux allowlists if enabling groups.
