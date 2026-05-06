# WeChat Bridge 接入 PRD（gewechat + Windows Sidecar，V1）

> **文档类型**：正式 PRD / 飞书文档版  
> **版本**：V1.0  
> **状态**：待评审 / 可拍板  
> **适用阶段**：一期文本能力建设  
> **项目代号**：Hermes WeChat External Bridge

---

## 1. 文档摘要

本文档用于确认 Hermes 对个人微信场景的非 iLink 接入方案，并形成一期建设范围、架构边界、产品策略、配置策略与验收标准。

本次拍板结论如下：

1. **采用外部 Bridge 架构，不走 Hermes 内置 iLink 专用 Weixin adapter。**
2. **在 Bridge 层新增 `gewechat` provider，同时保留 `windows_sidecar` provider。**
3. **一期仅支持文本消息收发。**
4. **传输层优先 webhook，同时保留 websocket 方案。**
5. **系统需支持 provider 可切换，也支持双 provider 同时启用。**
6. **群聊默认关闭；开启时必须使用 allowlist + @提及触发。**

该方案以“低风险、可回退、可灰度、便于后续扩展多 provider”为核心设计原则。

---

## 2. 项目背景

当前 Hermes 已具备消息网关能力，但内置 `weixin` 适配器本质上是围绕 iLink 协议实现，并不适合作为“非 iLink 个人微信接入”的统一底座。

在业务目标上，我们希望实现：

- 让 Hermes 能通过个人微信对外提供能力；
- 避免绑定到单一接入商或单一灰色实现；
- 在技术路径上保留 `windows_sidecar` 的既有能力；
- 同时引入 `gewechat` 作为新的 provider 选项；
- 支持后续继续扩展其他 provider，而不影响 Hermes 上层会话与策略逻辑。

因此，本项目不再尝试“修改 Hermes 内置 Weixin adapter 以兼容非 iLink”，而是采用**外部 Bridge 统一抽象 provider** 的架构。

---

## 3. 问题定义

### 3.1 当前问题

当前个人微信接入面临以下问题：

1. **Hermes 内置 Weixin adapter 与 iLink 强耦合**，不适合直接承接非 iLink 方案。
2. 不同微信接入方案的协议、鉴权、收发方式差异较大，若直接耦合进 Hermes 平台层，维护成本高。
3. 当前已有 `windows_sidecar` 形态，若强行切换到新方案，存在能力回退与稳定性风险。
4. 群聊场景天然风险更高，若直接开放，容易造成误触发、打扰与运维复杂度飙升。
5. 文本、图片、文件、语音等能力复杂度不同，需要分期建设。

### 3.2 本期核心目标

解决的是：

- 如何以**外部 Bridge** 方式承接微信个人号接入；
- 如何在桥接层同时支持 `gewechat` 与 `windows_sidecar`；
- 如何在一期只做文本的前提下，实现**可用、可灰度、可切换、可回退**；
- 如何控制群聊风险。

---

## 4. 产品目标

### 4.1 目标

本期目标如下：

1. 建立统一的 WeChat Bridge 层，对 Hermes 提供稳定的消息输入输出接口。
2. 新增 `gewechat` provider 接入能力。
3. 保留 `windows_sidecar` provider，并继续可用。
4. 支持私聊文本消息收发闭环。
5. 支持 webhook 与 websocket 两种传输模式。
6. 支持通过配置指定默认 provider，或同时启用多个 provider。
7. 群聊默认禁用；启用后仅 allowlist 群可接入，且需 `@机器人` 才触发。

### 4.2 非目标

以下内容不属于一期目标：

1. 图片收发正式可用
2. 文件收发正式可用
3. 语音收发与语音转写链路
4. 多账号调度
5. 自动群发、主动营销、批量外呼类能力
6. 全量开放群聊自由触发
7. 将 `gewechat` 直接接入 Hermes 内置 platform adapter

---

## 5. 拍板结论（最终方案）

### 5.1 架构结论

采用**外部 Bridge 推荐架构**：

`WeChat -> Provider(gewechat / windows_sidecar) -> External Bridge -> Hermes API -> Hermes`

含义如下：

- Provider 层负责对接具体微信接入实现；
- Bridge 层负责统一协议、策略、会话路由、去重、配置与可观测性；
- Hermes 继续专注于智能体会话、工具调用、记忆与响应生成；
- Hermes 不感知 `gewechat` 与 `windows_sidecar` 的底层差异。

### 5.2 Provider 结论

Bridge 层 provider 策略如下：

- **新增**：`gewechat`
- **保留**：`windows_sidecar`

要求：

- 两者都接入统一的 Bridge provider 抽象；
- 上层业务逻辑不依赖具体 provider；
- 后续若新增第三个 provider，不应影响 Hermes 接入协议。

### 5.3 传输结论

传输层采用双通道设计：

- **推荐默认**：webhook
- **保留支持**：websocket
- **允许同时启用**：webhook + websocket

决策原因：

- webhook 更利于标准化部署、反向代理与服务端回调处理；
- websocket 更适合 sidecar 常驻连接、低延迟命令下发；
- 双通道保留可使不同 provider 使用最适合自己的方式。

### 5.4 群聊结论

群聊策略如下：

- 默认关闭
- 开启时必须 allowlist
- 开启时必须 `@机器人` 才触发

即：

- `group_policy = disabled` 为默认值
- 灰度开启后使用 `group_policy = allowlist`
- 必须配置 `allowed_rooms`
- 必须开启 `require_mention_in_groups = true`

---

## 6. 方案设计

## 6.1 总体架构

### 逻辑架构图（文字版）

```text
个人微信客户端
   ↓
provider 层
  ├─ gewechat
  └─ windows_sidecar
   ↓
WeChat External Bridge
  ├─ 消息标准化
  ├─ provider 路由
  ├─ 鉴权
  ├─ 会话映射
  ├─ 幂等去重
  ├─ 策略控制（私聊/群聊/allowlist/@触发）
  ├─ webhook/websocket 收发
  └─ 日志与监控
   ↓
Hermes API / Webhook
   ↓
Hermes Agent
```

### 设计原则

1. **Provider 解耦**：接入差异只留在 Bridge 层。
2. **最小可用优先**：一期只做文本。
3. **回退优先**：保留 Windows sidecar，避免单一接入依赖。
4. **可灰度**：群聊默认关闭，逐步开放。
5. **可切换**：通过配置实现默认 provider、优先级与双开模式。
6. **可扩展**：后续可增加媒体能力与更多 provider。

---

## 6.2 Provider 抽象设计

### 统一 Provider 能力接口

每个 provider 需抽象为统一能力：

1. 接收微信消息
2. 发送文本消息
3. 返回 provider message id
4. 暴露 chat_id / sender_id / is_group / at_self 等标准字段
5. 支持自身连接健康检查
6. 支持错误上报与重试信号

### 标准消息模型

Bridge 内部统一消息结构建议如下：

```json
{
  "provider": "gewechat",
  "provider_message_id": "msg_xxx",
  "device_id": "optional-device",
  "chat_id": "contact_or_room_id",
  "chat_name": "聊天展示名",
  "is_group": false,
  "sender_id": "sender_xxx",
  "sender_name": "发送人",
  "text": "hello",
  "at_self": false,
  "attachments": []
}
```

说明：

- `provider` 是必填，用于双开场景下的去重与路由；
- `provider_message_id` 用于幂等去重；
- `device_id` 主要服务 sidecar 类 provider；
- `attachments` 一期可保留字段但不纳入主流程。

---

## 6.3 传输层设计

### A. Webhook 模式

适用：

- `gewechat` 优先使用
- 服务端回调型 provider
- 便于公网入口统一收敛到 Nginx / API Gateway / Tunnel

特点：

- Provider 将消息推送到 Bridge 的 HTTP 接口；
- Bridge 立即返回 ACK；
- Bridge 异步调用 Hermes；
- Hermes 输出再由 Bridge 回写给 provider。

优点：

- 部署简单
- 调试方便
- 日志审计清晰
- 标准 Web 基础设施友好

### B. WebSocket 模式

适用：

- `windows_sidecar` 优先使用
- 需要持续保活、收命令的常驻客户端

特点：

- sidecar 与 Bridge 建立长连接；
- 入站消息可直接通过 socket 推送；
- 出站命令可由 Bridge 主动下发；
- 更适合实时交互与设备在线状态管理。

优点：

- 实时性强
- 适配 sidecar 自然
- 便于命令型协议双向通信

### C. 最终策略

最终不二选一，而是：

- webhook 为默认推荐
- websocket 为保留方案
- 两种可并存
- 由 provider 配置决定采用哪种 transport

---

## 6.4 路由与切换策略

系统需要支持以下三类工作模式：

### 模式 1：单 provider 模式

仅启用一个 provider，例如：

- 只启用 `gewechat`
- 或只启用 `windows_sidecar`

适用于：

- 单方案验证
- 单环境部署
- 极简运维

### 模式 2：双 provider 并行开启

同时启用：

- `gewechat`
- `windows_sidecar`

适用于：

- 灰度迁移
- 对比验证
- 容灾回退

### 模式 3：主备 / 优先级模式

例如：

- `default_provider = gewechat`
- `fallback_provider = windows_sidecar`

适用于：

- 新旧方案并存
- 主通道失败时可切回旧链路

### 配置要求

配置文件必须可表达：

- 是否启用某 provider
- 默认 provider
- provider 的 transport 类型
- 是否允许双开
- 是否启用 failover

---

## 6.5 幂等与去重策略

当双 provider 同时开启时，必须解决重复入站与重复回复问题。

### 核心要求

1. 同一条用户消息不能重复进入 Hermes。
2. 同一条 Hermes 回复不能被两个 provider 重复发送。
3. 系统必须可追踪消息来源与去重命中情况。

### 建议幂等键

```text
idempotency_key = provider + provider_message_id
```

若 provider 无稳定 message id，则退化使用：

```text
provider + chat_id + sender_id + timestamp_bucket + text_hash
```

### 去重窗口建议

- 默认去重窗口：30~120 秒
- 按 chat_id 维度维护短期缓存
- 命中去重时写入日志与指标

---

## 6.6 群聊控制策略

群聊必须采取保守策略。

### 默认规则

- 默认不处理任何群消息

### 开启规则

仅在同时满足以下条件时处理群消息：

1. `group_policy = allowlist`
2. 当前群在 `allowed_rooms` 中
3. `require_mention_in_groups = true`
4. 本条消息明确 `@机器人`

### 这样设计的原因

1. 降低误触发
2. 降低刷屏风险
3. 降低运维排障复杂度
4. 更适合灰度发布

---

## 7. 用户流程

## 7.1 私聊文本流程

```text
用户发送私聊文本
→ provider 接收
→ Bridge 标准化消息
→ Bridge 进行 DM 策略校验
→ Bridge 调用 Hermes
→ Hermes 返回文本
→ Bridge 组装发送命令
→ provider 发回微信用户
```

## 7.2 群聊文本流程

```text
群成员发言并 @机器人
→ provider 接收群消息
→ Bridge 校验 group_policy
→ 校验群是否在 allowlist
→ 校验是否 @机器人
→ 满足条件后调用 Hermes
→ Bridge 通过 provider 回复群内
```

## 7.3 Provider 切换流程

```text
运维修改配置
→ 设置 default_provider / enabled / transport
→ Bridge reload 或重启
→ 新配置生效
```

---

## 8. 配置方案

建议统一配置结构如下：

```yaml
wechat_bridge:
  mode: dual               # single | dual
  default_provider: gewechat
  fallback_provider: windows_sidecar

  providers:
    gewechat:
      enabled: true
      transport: webhook
      webhook:
        enabled: true
      websocket:
        enabled: false

    windows_sidecar:
      enabled: true
      transport: websocket
      webhook:
        enabled: false
      websocket:
        enabled: true

  policy:
    text_only: true
    dm_policy: open
    allowed_contacts: []
    group_policy: disabled
    allowed_rooms: []
    require_mention_in_groups: true

  reliability:
    dedupe: true
    dedupe_window_seconds: 60
    failover_enabled: true

  observability:
    log_provider_events: true
    log_dedupe_hits: true
    log_policy_rejects: true
```

### 配置要求说明

1. 文本一期必须显式开启 `text_only = true`
2. 群聊默认 `group_policy = disabled`
3. 若启用群聊，必须配置 `allowed_rooms`
4. 双开时必须启用 `dedupe`
5. 主备模式建议配置 `fallback_provider`

---

## 9. 一期范围与分期规划

## 9.1 一期范围（必须完成）

### 功能范围

1. `gewechat` provider 接入
2. 保留 `windows_sidecar` provider
3. 私聊文本收发
4. webhook 支持
5. websocket 支持
6. provider 切换能力
7. 双 provider 同时开启能力
8. 幂等去重能力
9. 群默认关闭策略
10. 群 allowlist + @触发策略
11. 基础日志与健康检查

### 交付结果

1. 可运行的 Bridge 服务
2. 配置化 provider 管理
3. 至少一条稳定文本闭环链路
4. 可回退到 Windows sidecar

## 9.2 二期候选

1. 图片发送
2. 图片接收
3. 文件发送
4. 文件接收
5. 语音消息支持
6. 语音转写与语音回复
7. 多账号/多设备支持
8. 更细粒度风控与频控

---

## 10. 技术实现要求

## 10.1 Bridge 层要求

1. 对 Hermes 暴露统一消息接口
2. 对 provider 暴露统一适配抽象
3. 支持 webhook / websocket 双传输
4. 支持消息序列化处理，避免同 chat 并发乱序
5. 支持幂等去重
6. 支持日志与基础监控

## 10.2 Provider 层要求

### `gewechat`

要求：

- 支持文本入站
- 支持文本出站
- 支持 webhook 优先接入
- 能提供稳定 message id 或等价唯一标识
- 能标记群/私聊及 @机器人状态

### `windows_sidecar`

要求：

- 继续保持现有能力
- 支持 websocket 常驻连接
- 支持文本入站与文本出站
- 作为回退与兼容方案长期保留

---

## 11. 风险与应对

## 11.1 Provider 差异风险

风险：

- 不同 provider 的字段、回调时序、鉴权方式差异较大。

应对：

- 在 Bridge 层做严格标准化；
- 不将 provider 差异透传到 Hermes。

## 11.2 双开重复消息风险

风险：

- 双 provider 同时开启后，同一条消息可能重复触发。

应对：

- 强制幂等键与去重窗口；
- 输出 dedupe hit 日志与指标。

## 11.3 群聊误触发风险

风险：

- 群内频繁响应导致打扰、刷屏与投诉。

应对：

- 群默认关闭；
- 开启时仅 allowlist；
- 必须 @提及触发。

## 11.4 单一 provider 不稳定风险

风险：

- 若仅依赖新 provider，可能影响整体可用性。

应对：

- 保留 `windows_sidecar`；
- 提供主备与切换能力。

---

## 12. 验收标准

一期通过标准如下：

### A. 基础能力验收

1. `gewechat` 可完成私聊文本收发闭环
2. `windows_sidecar` 可继续完成私聊文本收发闭环
3. 两种 provider 至少可任选其一独立运行
4. 配置切换后可正确切到指定 provider

### B. 传输验收

1. webhook 模式可正常收消息与回消息
2. websocket 模式可正常收消息与回消息
3. 两种 transport 至少在各自目标 provider 上可验证成功

### C. 双开验收

1. 双 provider 同时启用时，不出现重复回复
2. 重复消息可被去重逻辑识别
3. 日志中可看到 provider 来源与去重结果

### D. 群聊验收

1. 默认配置下群消息不触发
2. 开启 allowlist 前，非白名单群不触发
3. 白名单群中未 @机器人不触发
4. 白名单群中 @机器人后可正确响应

---

## 13. 里程碑建议

### M1：架构落板

- 完成 PRD 评审
- 确认 provider 抽象
- 确认 transport 策略
- 确认群策略

### M2：一期 MVP

- `gewechat` 文本收发
- `windows_sidecar` 保持可用
- webhook / websocket 通路打通

### M3：可靠性建设

- provider 切换
- 双开
- 幂等去重
- 健康检查与日志补齐

### M4：群聊灰度

- allowlist 支持
- @触发支持
- 测试群验证

---

## 14. 需要老板确认的事项

以下事项建议作为老板拍板项：

1. 是否确认**外部 Bridge** 为长期路线，而不是继续改 Hermes 内置 Weixin adapter
2. 是否确认 `gewechat` 为新增 provider
3. 是否确认 `windows_sidecar` 必须长期保留
4. 是否确认一期只做文本
5. 是否确认 webhook 为默认推荐，websocket 保留
6. 是否确认双 provider 可同时开启
7. 是否确认群默认关闭，开启时仅 allowlist + @触发

若以上 7 项均确认，则本 PRD 即可进入实现阶段。

---

## 15. 对研发的明确指令

研发按以下边界执行：

1. 不改 Hermes 内置 iLink 专用 Weixin adapter 作为本期主路径。
2. 在外部 Bridge 内新增 `gewechat` provider。
3. 不能移除现有 `windows_sidecar` 方案。
4. 一期不要扩 scope 到图片/文件/语音。
5. transport 必须同时考虑 webhook 与 websocket。
6. 配置必须支持单开、双开、默认 provider 指定与回退策略。
7. 群聊功能必须默认关闭。
8. 群聊开启后必须 allowlist + @触发。

---

## 16. 飞书发布版摘要（适合放在文首）

**项目结论：**  
本项目确定采用外部 Bridge 方案承接个人微信接入，不走 Hermes 内置 iLink 专用 Weixin adapter。Bridge 层新增 `gewechat` provider，同时保留 `windows_sidecar` 作为兼容与回退链路。一期仅做文本收发。传输层优先 webhook，但保留 websocket，并支持通过配置切换或双开。群聊默认关闭，开启时仅允许 allowlist 群并要求 `@机器人` 触发。

**本期价值：**  
在不绑定单一 provider 的前提下，实现低风险、可回退、可灰度的个人微信接入底座，为后续图片、文件、语音与更多 provider 扩展打基础。

---

## 17. 附录：与当前实现的衔接说明

基于现有代码现状，本 PRD 与当前项目方向一致：

1. 当前外部 adapter 已是独立服务形态，适合作为 Bridge 演进基础。
2. 当前项目已具备 HTTP 接口与 WebSocket 通道，适合承接“webhook 优先 + websocket 保留”的策略。
3. 当前项目已有群默认关闭、allowlist、@触发等安全默认值，可继续沿用为产品默认策略。
4. 当前项目定位为 Linux adapter + Windows sidecar，因此“保留 `windows_sidecar`”与现状兼容。

---

## 18. 建议文档标题（飞书）

可直接使用以下标题之一：

1. **Hermes 个人微信接入 PRD（gewechat + Windows Sidecar，一期文本版）**
2. **WeChat External Bridge 方案 PRD（一期拍板稿）**
3. **Hermes 微信外部 Bridge 接入方案与一期范围确认**

---

## 19. 一句话拍板口径

**请按外部 Bridge 方案推进：新增 `gewechat` provider，保留 `windows_sidecar`，一期只做文本，webhook 优先但保留 websocket，支持配置切换或双开，群默认关闭、开启后仅 allowlist + @提及触发。**
