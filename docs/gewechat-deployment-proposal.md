# Gewechat 部署与使用方案（供拍板）

> **文档类型**：部署方案 / 实施决策稿 / 飞书文档版  
> **版本**：V1.0  
> **状态**：待拍板  
> **适用范围**：Hermes 外部 Bridge 的 `gewechat` provider 落地  
> **目标读者**：老板 / 产品 / 架构 / 研发 / 运维

---

## 1. 一句话结论

当前我们已经完成的是：**Hermes 外部 Bridge 侧的 `gewechat` provider 适配能力**，包括 webhook 入站归一化、文本出站接口封装、provider 路由与配置接入。

还没有完成的是：**Gewechat 服务本体的部署、微信登录、参数获取与生产联调**。

因此，下一步需要拍板的是：

**是否正式引入 Gewechat 作为微信接入 provider，并按“Gewechat 服务层 + Hermes Bridge 层”两层架构推进部署。**

---

## 2. 当前状态说明

### 2.1 已完成

当前已完成能力如下：

1. Hermes 外部 Bridge 已支持 `gewechat` provider
2. 已支持 `gewechat` webhook 文本入站
3. 已支持 `gewechat` 文本出站 API 封装
4. 已支持 `gewechat` 与 `windows_sidecar` 双 provider 共存
5. 已支持 provider 切换、双开、dedupe、群策略配置
6. 相关测试已通过

### 2.2 尚未完成

当前尚未完成内容如下：

1. Gewechat 服务实例部署
2. Gewechat 登录真实微信账号
3. 获取 `GEWECHAT_API_BASE_URL`
4. 获取 `GEWECHAT_TOKEN`
5. 获取 `GEWECHAT_APP_ID`
6. 注册 `GEWECHAT_CALLBACK_URL`
7. 与真实微信账号做端到端联调

### 2.3 关键认知

需要明确区分以下两层：

- **Hermes Bridge 适配层**：我们已经基本做好
- **Gewechat provider 服务层**：还需要部署与接入

也就是说，当前不是“微信已经通过 Gewechat 跑通”，而是：

> **Hermes 已经为 Gewechat 预留并实现了 provider adapter；接下来要做的是把 Gewechat 自身搭起来并挂到这层 adapter 上。**

---

## 3. 问题定义

如果决定走 `gewechat` 路线，核心问题不是“如何改 Hermes”，而是：

1. 如何部署 Gewechat 服务
2. 如何让 Gewechat 完成微信登录
3. 如何拿到 Hermes Bridge 所需参数
4. 如何把 Gewechat webhook 接到 Hermes Bridge
5. 如何让 Hermes 生成的文本回复再通过 Gewechat 发回微信
6. 如何在保留 `windows_sidecar` 的同时，逐步把 `gewechat` 纳入正式方案

---

## 4. 方案目标

本方案目标如下：

1. 引入 Gewechat 作为正式可用 provider
2. 保持 Hermes 外部 Bridge 架构不变
3. 让 Gewechat 负责真实微信侧接入
4. 让 Hermes Bridge 负责统一策略、路由、会话与去重
5. 一期仅打通文本收发
6. 保留 Windows sidecar 作为回退路径
7. 为后续群聊、图片、文件能力预留扩展空间

---

## 5. 目标架构

### 5.1 部署架构图（文字版）

```text
真实微信账号
   ↓
Gewechat 服务
   ├─ 登录微信
   ├─ 接收微信消息
   ├─ 回调 webhook 给 Hermes Bridge
   └─ 接收 Hermes Bridge 的 send_text 调用
   ↓
Hermes WeChat Bridge
   ├─ 消息归一化
   ├─ provider 路由
   ├─ 会话映射
   ├─ 策略控制
   ├─ 群聊 allowlist / @触发
   ├─ dedupe
   └─ 调 Hermes API
   ↓
Hermes Agent
```

### 5.2 分层职责

#### A. Gewechat 层负责

1. 对接真实微信账号
2. 提供 webhook 回调
3. 提供 HTTP API 发文本
4. 输出 Gewechat 自身标识（如 appId）
5. 处理微信侧会话实例

#### B. Hermes Bridge 层负责

1. Gewechat webhook payload 标准化
2. 将消息送入 Hermes
3. 接收 Hermes 输出
4. 转发 send_text 到 Gewechat
5. 处理 provider 切换、双开、dedupe、策略控制

#### C. Hermes 层负责

1. 推理与回复生成
2. 工具调用
3. 会话上下文
4. 用户记忆与技能

---

## 6. 为什么需要 Gewechat，而不是“直接登录微信”

### 6.1 结论

当前没有“在 Hermes 里直接点一下登录微信即可”的通用官方方案。

原因是：

- Hermes 不是微信客户端
- Hermes 不直接持有微信登录态
- 当前 `gewechat` 是 provider，不是 Hermes 内置登录器
- 微信登录这件事发生在 **Gewechat 层**，不是 Hermes Bridge 层

因此本方案本质是：

> **先部署 Gewechat，让它登录微信；再让 Hermes Bridge 通过 API/webhook 与 Gewechat 对接。**

### 6.2 替代路径说明

如果想更接近“直接登录微信”，当前更接近的方案其实是：

- `windows_sidecar`

它的特点是：
- 在 Windows 上直接登录 PC 微信
- sidecar 驱动已登录微信客户端
- Hermes Bridge 通过 websocket/http 与 sidecar 通信

而 `gewechat` 路线是：
- 部署一个外部 provider 服务
- provider 自己承接微信登录与 API
- Hermes Bridge 通过 provider 接微信

---

## 7. 需要获取的 Gewechat 参数

Hermes Bridge 需要的关键参数如下：

### 7.1 `GEWECHAT_API_BASE_URL`

Gewechat API 地址，典型格式：

```text
http://<gewechat-host>:2531/v2/api
```

常见本地部署示例：

```text
http://127.0.0.1:2531/v2/api
```

### 7.2 `GEWECHAT_TOKEN`

Gewechat 自身 API token，用于 Hermes Bridge 调用 Gewechat API 时鉴权。

使用方式通常是 HTTP Header：

```http
X-GEWE-TOKEN: <token>
```

### 7.3 `GEWECHAT_APP_ID`

Gewechat 当前登录微信实例的 appId，通常在登录成功后由 Gewechat 侧返回或查询获得。

它是调用 `send_text` 时的关键字段，例如：

```json
{
  "appId": "wx_xxx",
  "toWxid": "wxid_xxx",
  "content": "hello",
  "ats": ""
}
```

### 7.4 `GEWECHAT_CALLBACK_URL`

Gewechat webhook 回调地址，用于将微信消息推送给 Hermes Bridge，建议格式：

```text
https://<bridge-domain>/providers/gewechat/webhook
```

---

## 8. Gewechat 部署方案

## 8.1 推荐部署原则

推荐采用以下原则：

1. Gewechat 与 Hermes Bridge **逻辑分层、物理可同机也可分机**
2. 一期优先**同机或同内网部署**，降低联调复杂度
3. 不建议先走公网裸露端口
4. callback 优先通过反代域名、内网穿透或 VPN 方式暴露

---

## 8.2 推荐部署形态

### 形态 A：同机部署（推荐 MVP）

```text
Linux 主机
  ├─ Gewechat 服务
  │   └─ 监听 2531
  ├─ Hermes Bridge
  │   └─ 监听 8787
  └─ Hermes API
      └─ 监听 8642
```

优点：
- 部署简单
- 网络最少
- 联调快
- 便于排错

缺点：
- 后续拆分扩容不如分机灵活

### 形态 B：分机部署

```text
A 主机：Gewechat
B 主机：Hermes Bridge + Hermes API
```

优点：
- provider 与 agent 解耦更彻底
- 后续扩容更方便

缺点：
- 回调与网络策略更复杂
- 初期联调成本更高

### 拍板建议

一期建议采用：

**形态 A：同机部署**

---

## 8.3 推荐端口规划

建议默认端口如下：

- Gewechat API：`2531`
- Hermes Bridge：`8787`
- Hermes API：`8642`

若需要公网回调：
- 建议通过 Nginx / Caddy / Cloudflare Tunnel / Tailscale Funnel 暴露 `8787` 的 webhook 路径

---

## 9. Gewechat 接入流程

### 9.1 初始化流程

```text
部署 Gewechat
→ 配置 token
→ 启动 Gewechat
→ 完成微信登录
→ 获取 appId
→ 配置 callbackUrl
→ Hermes Bridge 配置 baseUrl/token/appId
→ 回调测试
→ 文本收发测试
```

### 9.2 关键步骤解释

#### 步骤 1：部署 Gewechat

完成 Gewechat 服务进程启动，确保 API 可访问。

验收：
- 2531 端口可访问
- Gewechat API 返回正常

#### 步骤 2：配置 token

为 Gewechat 配置固定 token，供 Hermes Bridge 调用。

验收：
- 使用 token 调 Gewechat API 时返回正常
- 错 token 时被拒绝

#### 步骤 3：完成微信登录

通过 Gewechat 支持的登录流程，让真实微信账号在 Gewechat 侧登录。

验收：
- Gewechat 显示已登录
- 能识别当前会话实例

#### 步骤 4：获取 appId

在 Gewechat 登录成功后，获取当前微信实例的 `appId`。

验收：
- 可拿到非空 `GEWECHAT_APP_ID`
- 用该 appId 调 `postText` 不报实例不存在

#### 步骤 5：注册 callback

将 callback 配到：

```text
https://<bridge-domain>/providers/gewechat/webhook
```

验收：
- Gewechat 能成功调用该地址
- Hermes Bridge 能返回 200 / success

#### 步骤 6：联通文本收发

测试路径：

```text
微信私聊发 /ping
→ Gewechat 回调 webhook
→ Hermes Bridge 处理
→ Hermes 生成 pong
→ Hermes Bridge 调用 Gewechat send_text
→ 微信收到 pong
```

---

## 10. Hermes Bridge 配置方案

建议在 Bridge 中按如下配置：

```env
WECHAT_BRIDGE_MODE=dual
WECHAT_DEFAULT_PROVIDER=gewechat
WECHAT_FALLBACK_PROVIDER=windows_sidecar

GEWECHAT_ENABLED=true
GEWECHAT_TRANSPORT=webhook
GEWECHAT_WEBHOOK_ENABLED=true
GEWECHAT_WEBSOCKET_ENABLED=false

GEWECHAT_API_BASE_URL=http://127.0.0.1:2531/v2/api
GEWECHAT_TOKEN=<your-token>
GEWECHAT_APP_ID=<your-app-id>
GEWECHAT_CALLBACK_URL=https://<bridge-domain>/providers/gewechat/webhook

WINDOWS_SIDECAR_ENABLED=true
WINDOWS_SIDECAR_TRANSPORT=websocket
WINDOWS_SIDECAR_WEBHOOK_ENABLED=false
WINDOWS_SIDECAR_WEBSOCKET_ENABLED=true
```

### 配置策略建议

1. 默认 provider 设为 `gewechat`
2. 保留 `windows_sidecar` 作为 fallback
3. Gewechat 固定走 webhook
4. Windows sidecar 固定走 websocket
5. dual 模式先保留一段时间，便于回退

---

## 11. 推荐联调与灰度方式

## 11.1 阶段 1：只打通私聊文本

范围：
- 私聊
- 文本
- `/ping`、普通文本回复

不做：
- 群聊
- 图片文件
- 语音

拍板建议：
- **先只验收私聊文本**

## 11.2 阶段 2：灰度启用 Gewechat 为默认 provider

策略：
- `default_provider=gewechat`
- `fallback_provider=windows_sidecar`
- 出现异常可快速切回 sidecar

## 11.3 阶段 3：群聊灰度

在 Gewechat 文本私聊稳定后，再开启：

- `group_policy=allowlist`
- `require_mention_in_groups=true`

不建议一开始就开放群聊。

---

## 12. 验收标准

### 12.1 部署验收

1. Gewechat 服务已启动
2. API 地址可访问
3. token 鉴权有效
4. 已拿到 appId
5. callback 已成功注册

### 12.2 功能验收

1. 微信私聊消息能进入 Hermes Bridge
2. Hermes 可返回文本消息
3. Bridge 能通过 Gewechat 将文本发回微信
4. `/ping -> pong` 闭环可稳定成功

### 12.3 稳定性验收

1. webhook 回调连续成功
2. 不出现重复回复
3. dedupe 生效
4. 可切换回 windows_sidecar

---

## 13. 风险与应对

### 13.1 Gewechat 本体稳定性风险

风险：
- Gewechat 自身服务可用性、兼容性、版本差异可能影响上线质量

应对：
- 先同机部署
- 先私聊文本灰度
- 保留 sidecar 回退

### 13.2 登录态风险

风险：
- 微信登录态不在 Hermes，而在 Gewechat
- 登录失效会直接导致 provider 不可用

应对：
- 建立登录态检查机制
- 保留人工重新登录预案

### 13.3 参数获取复杂度风险

风险：
- 初次部署时，token / appId / callback 关系不熟悉，容易卡住

应对：
- 先整理标准化部署手册
- 固化启动顺序与排障步骤

### 13.4 供应链/合规风险

风险：
- Gewechat 属于第三方 provider 方案
- 存在版本维护、接入方式、账号风控等不确定性

应对：
- 不将其写死为唯一方案
- 持续保留 Windows sidecar

---

## 14. 是否推荐拍板

### 推荐结论

**推荐拍板 Gewechat 部署方案，但以“增量引入、保留回退、一期只做文本”为前提。**

具体建议如下：

1. 同意引入 Gewechat 作为正式 provider 方向之一
2. 一期仅打通私聊文本
3. 采用同机部署作为 MVP
4. 默认 provider 可切到 Gewechat，但必须保留 Windows sidecar fallback
5. 群聊延后到文本私聊稳定后再灰度

---

## 15. 需要老板拍板的事项

建议老板明确拍板以下内容：

1. 是否同意部署 Gewechat 服务本体
2. 是否同意采用“Gewechat + Hermes Bridge”双层架构
3. 是否同意一期只做文本私聊
4. 是否同意默认 provider 最终切向 Gewechat
5. 是否同意保留 Windows sidecar 作为长期回退方案
6. 是否同意群聊延后灰度，不随一期一起上线

---

## 16. 给研发/运维的落地指令

1. 先部署 Gewechat 服务
2. 完成 Gewechat token 配置
3. 完成微信登录
4. 获取 appId
5. 注册 callback 到 Hermes Bridge
6. 将 `GEWECHAT_API_BASE_URL / TOKEN / APP_ID / CALLBACK_URL` 写入 Bridge 配置
7. 先做 `/ping -> pong` 私聊联调
8. 联调通过后再考虑切换默认 provider

---

## 17. 飞书文首摘要（适合老板快速阅读）

**当前状态：**  
Hermes 侧已经完成了 Gewechat adapter 能力，但 Gewechat 服务本体尚未部署，因此尚未进入真实微信联调阶段。

**本次拍板事项：**  
决定是否正式部署 Gewechat，并按“Gewechat 服务层 + Hermes Bridge 层”的双层架构推进。一期建议仅打通私聊文本，默认保留 Windows sidecar 回退，待私聊稳定后再考虑群聊灰度。

**推荐结论：**  
建议拍板引入 Gewechat，但采用增量方式：先同机部署、先文本私聊、先保留 sidecar fallback，不建议一步到位替换全部方案。

---

## 18. 一句话拍板口径

**请按“Gewechat 服务层 + Hermes Bridge 层”双层架构推进：先部署 Gewechat、获取 base_url/token/appId、注册 callback 到 Hermes Bridge；一期只做私聊文本，默认保留 Windows sidecar 作为回退，不急着开放群聊。**
