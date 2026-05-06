# Gewechat Real Adapter Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add real Gewechat webhook payload normalization and HTTP send-text delivery so the bridge can process actual Gewechat callbacks and push text replies through Gewechat's API.

**Architecture:** Keep the existing provider-aware bridge in place. Add a dedicated `gewechat.js` provider module that (1) normalizes official/raw callback payloads into the bridge's internal message shape and (2) sends `send_text` commands to Gewechat using `POST /message/postText` with `X-GEWE-TOKEN`. Server webhook ingress will detect `gewechat` and perform active delivery instead of merely returning commands.

**Tech Stack:** Node.js 20+, built-in `node:test`, native `fetch`, existing HTTP server.

---

### Task 1: Add failing tests for Gewechat payload normalization

**Objective:** Define the expected mapping from real Gewechat webhook payloads to internal bridge messages.

**Files:**
- Create: `tests/gewechat.test.js`
- Create/Modify: `src/gewechat.js`

**Step 1: Write failing tests**
- private text payload maps `Appid/Appid`, `Wxid`, `Data.NewMsgId`, `FromUserName.string`, `Content.string`
- group text payload maps room id, sender id from `senderWxid:\ntext`, stripped text, mention detection from `MsgSource` XML and `PushContent`
- non-text messages or unsupported payloads are rejected/return null

**Step 2: Run test to verify failure**
Run: `node --test tests/gewechat.test.js`
Expected: FAIL — `src/gewechat.js` missing functions.

**Step 3: Write minimal implementation**
Implement pure helpers in `src/gewechat.js`:
- `normalizeGewechatWebhook(payload)`
- `isGewechatTextMessage(payload)`
- `extractGewechatAtSelf(...)`

**Step 4: Run test to verify pass**
Run: `node --test tests/gewechat.test.js`
Expected: PASS

---

### Task 2: Add failing tests for Gewechat send-text API

**Objective:** Define the exact HTTP request the adapter should make to Gewechat for text replies.

**Files:**
- Modify: `tests/gewechat.test.js`
- Modify: `src/gewechat.js`

**Step 1: Write failing tests**
- `sendGewechatText()` posts to `/message/postText`
- includes `X-GEWE-TOKEN`
- includes body `{ appId, toWxid, content, ats }`
- returns parsed response envelope
- throws useful error on non-200 or `ret != 200`

**Step 2: Run test to verify failure**
Run: `node --test tests/gewechat.test.js`
Expected: FAIL — send function not implemented.

**Step 3: Write minimal implementation**
Implement:
- `sendGewechatText({ baseUrl, token, appId, toWxid, content, ats, fetchImpl })`

**Step 4: Run test to verify pass**
Run: `node --test tests/gewechat.test.js`
Expected: PASS

---

### Task 3: Integrate Gewechat delivery into server webhook path

**Objective:** When provider is `gewechat`, accept real callback payloads and actively send Hermes text responses through Gewechat instead of only returning commands.

**Files:**
- Modify: `src/config.js`
- Modify: `.env.example`
- Modify: `src/server.js`
- Modify: `src/adapter.js` only if needed for shape alignment
- Test: `tests/server-gewechat-delivery.test.js`

**Step 1: Write failing tests**
- config exposes `gewechatApiBaseUrl`, `gewechatToken`, `gewechatAppId`, optional callback URL
- webhook path normalizes a real Gewechat callback
- if Hermes returns `send_text`, server calls Gewechat send API
- webhook returns immediate `success`-style body rather than raw commands when provider is Gewechat

**Step 2: Run test to verify failure**
Run: `node --test tests/server-gewechat-delivery.test.js`
Expected: FAIL — no Gewechat server integration yet.

**Step 3: Write minimal implementation**
- Add Gewechat env parsing
- Normalize Gewechat callbacks before `handleIncomingMessage`
- Add delivery helper that loops over `send_text` commands and calls Gewechat API
- Keep compatibility fallback for unsupported command types by returning them in debug response/logging only

**Step 4: Run test to verify pass**
Run: `node --test tests/server-gewechat-delivery.test.js`
Expected: PASS

---

### Task 4: Final verification

**Objective:** Re-run full suite and perform a local mocked Gewechat smoke check.

**Files:**
- Existing test files only

**Step 1: Run full tests**
Run: `node --test tests/*.test.js`
Expected: PASS

**Step 2: Syntax check**
Run: `node --check src/gewechat.js && node --check src/server.js`
Expected: PASS

**Step 3: Local smoke**
Use a local fake Gewechat HTTP endpoint or mocked fetch path to verify outbound request construction.

**Step 4: Record limitation**
If real Gewechat credentials are absent, explicitly note that only mocked/local validation was possible.
