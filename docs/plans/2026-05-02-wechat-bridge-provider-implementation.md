# WeChat Bridge Provider & Transport Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add provider-aware bridge behavior for `gewechat` and `windows_sidecar`, with webhook + websocket support, dual-provider configuration, and text-only dedupe-safe message handling.

**Architecture:** Keep the existing Linux bridge as the single policy layer, but introduce explicit provider metadata, transport gating, provider-specific webhook ingress, websocket provider identity, and provider-aware dedupe/session scoping. Preserve backwards compatibility with the current Windows sidecar flow while adding a clean webhook path for `gewechat`.

**Tech Stack:** Node.js 20+, built-in `node:test`, existing HTTP server + `ws`, dotenv config.

---

### Task 1: Add provider-aware config parser

**Objective:** Make provider mode, default provider, fallback provider, provider enablement, transport type, and dedupe window configurable in a pure/testable way.

**Files:**
- Modify: `src/config.js`
- Modify: `.env.example`
- Test: `tests/config.test.js`

**Step 1: Write failing test**

Create tests that assert:
- default config keeps `windows_sidecar` enabled and websocket transport
- `gewechat` defaults to enabled with webhook transport
- `WECHAT_BRIDGE_MODE`, `WECHAT_DEFAULT_PROVIDER`, `WECHAT_FALLBACK_PROVIDER`
- invalid provider names are normalized/fallback safely
- dedupe window parses correctly

**Step 2: Run test to verify failure**

Run: `node --test tests/config.test.js`
Expected: FAIL because `loadConfig()` / provider config helpers do not exist yet.

**Step 3: Write minimal implementation**

Implement pure config helpers in `src/config.js`:
- `loadConfig(env = process.env)`
- `normalizeProviderName(name, fallback)`
- provider config map for `gewechat` and `windows_sidecar`
- export `config = loadConfig()`
- keep current public fields working for existing modules

**Step 4: Run test to verify pass**

Run: `node --test tests/config.test.js`
Expected: PASS

**Step 5: Commit**

Not possible unless repo is initialized as git; skip commit if no git repo.

---

### Task 2: Add provider normalization + dedupe helpers

**Objective:** Normalize incoming provider metadata and create deterministic dedupe keys before touching server routes.

**Files:**
- Create: `src/providers.js`
- Test: `tests/providers.test.js`

**Step 1: Write failing test**

Create tests that assert:
- supported providers are `gewechat` and `windows_sidecar`
- webhook route provider overrides payload provider safely
- missing provider falls back to configured default
- dedupe key uses `provider + message id`
- dedupe key falls back to a stable hash when message id is absent

**Step 2: Run test to verify failure**

Run: `node --test tests/providers.test.js`
Expected: FAIL because `src/providers.js` does not exist.

**Step 3: Write minimal implementation**

Implement helpers:
- `SUPPORTED_PROVIDERS`
- `resolveProviderName(raw, fallback)`
- `buildProviderMessageId(msg)`
- `buildMessageDedupeKey(msg)`
- `providerDeviceKey(provider, deviceId)`

**Step 4: Run test to verify pass**

Run: `node --test tests/providers.test.js`
Expected: PASS

**Step 5: Commit**

Skip if no git repo.

---

### Task 3: Make adapter provider-aware and dedupe-safe

**Objective:** Ensure conversations, `/id`, pending command queues, and duplicate filtering are provider-aware.

**Files:**
- Modify: `src/adapter.js`
- Test: `tests/adapter.test.js`

**Step 1: Write failing test**

Create tests that assert:
- same chat id across different providers maps to different conversation keys
- duplicate message with same provider/message id only processes once
- `/id` output includes provider
- pending command queues are isolated per provider + device id

**Step 2: Run test to verify failure**

Run: `node --test tests/adapter.test.js`
Expected: FAIL because adapter currently has no provider-aware dedupe/queue separation.

**Step 3: Write minimal implementation**

Update `src/adapter.js` to:
- normalize provider into messages
- scope `conversationKey` by provider + chat id
- use provider-aware queue keys
- implement dedupe window cache
- export minimal testing hooks only if necessary

**Step 4: Run test to verify pass**

Run: `node --test tests/adapter.test.js`
Expected: PASS

**Step 5: Commit**

Skip if no git repo.

---

### Task 4: Add provider-specific webhook ingress and websocket transport gating

**Objective:** Expose a clean `gewechat` webhook route, keep the generic route for compatibility, and ensure websocket only serves providers that enable it.

**Files:**
- Modify: `src/server.js`
- Modify: `src/check.js`
- Test: `tests/server-routes.test.js`

**Step 1: Write failing test**

Create tests that assert:
- `POST /providers/gewechat/webhook` is accepted and provider is forced to `gewechat`
- disabled providers are rejected
- websocket connection defaults to `windows_sidecar`
- websocket rejects providers without websocket transport
- `/ready` includes provider configuration summary

**Step 2: Run test to verify failure**

Run: `node --test tests/server-routes.test.js`
Expected: FAIL because the route and transport checks do not exist.

**Step 3: Write minimal implementation**

Update server logic to:
- add `POST /providers/:provider/webhook`
- resolve provider from route or payload
- enforce enabled provider + matching transport rules
- include provider summary in readiness payload
- preserve current `/v1/messages` compatibility for existing sidecar clients

**Step 4: Run test to verify pass**

Run: `node --test tests/server-routes.test.js`
Expected: PASS

**Step 5: Commit**

Skip if no git repo.

---

### Task 5: Final verification

**Objective:** Run the full test suite and verify the bridge still passes startup checks.

**Files:**
- Modify as needed from earlier review findings
- Test: all files under `tests/`

**Step 1: Run full test suite**

Run: `node --test tests/*.test.js`
Expected: PASS

**Step 2: Run project check**

Run: `npm run check`
Expected: config validation runs; if local secrets are missing in `.env.example`, run against real `.env` or note requirement.

**Step 3: Perform smoke validation**

Run one quick local check of route registration or startup syntax:

`node --check src/server.js`

Expected: PASS

**Step 4: Document outcome**

Summarize:
- implemented files
- test command used
- any limitations (e.g. provider-specific outbound API still delegated to upstream caller for webhook mode)

---

## Notes

- This project is currently **not a git repository**, so commit steps are informational only.
- Keep implementation **text-only**; do not expand to media workflows in this pass.
- Preserve current sidecar protocol so existing Windows clients remain usable.
- Prefer pure helper functions for new logic so tests can run without booting the full server.
