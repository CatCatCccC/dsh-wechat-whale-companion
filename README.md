# dsh-wechat-whale-companion

DeepSeek Harness（DSH）**微信单人私聊**陪伴插件：对标 [xfgil/dsh-onebot-companion](https://github.com/xfgil/dsh-onebot-companion) 的全量陪伴能力，挂在 [`dsh-wechat`](https://github.com/pan17/dsh-wechat) 之上，内置鲸鱼娘短句人设。

> 不重写微信通道；**一行不改** `node_modules/dsh-wechat`。QQ 群专属能力（@ / 戳一戳 / 名片赞等）配置保留但默认关闭。

## 依赖

- DSH `>=0.2.x <0.3`
- 先安装并扫码登录 **`dsh-wechat` >= 0.13**
- Node `>=22.19`

> 本插件不提供微信通道。`dsh-wechat` 0.13 没有对外 Cordis service，只注册
> `send_wechat` 工具并把「微信用户 → DSH session」写进 `~/.dsh-wechat/state.json`。
> 本插件读取这两样东西：没有 `dsh-wechat` 时插件能激活，但不会有人设注入、主动发言或出站。

## 安装

```bash
# 1. 微信通道
dsh plugin --profile web add dsh-wechat

# 2. 本插件（推荐从 GitHub）
dsh plugin --profile web add github:CatCatCccC/dsh-wechat-whale-companion

# Docker 示例：
# docker exec -it dsh-harness dsh plugin --profile web add github:CatCatCccC/dsh-wechat-whale-companion
# docker restart dsh-harness

# 本地开发才用路径：
# dsh plugin --profile web add /绝对路径/dsh-wechat-whale-companion
```

网页「设置 → 插件」也可填：`github:CatCatCccC/dsh-wechat-whale-companion`。

重启 `dsh web`（或 `docker restart dsh-harness`）。默认不填 `ownerWxid`：本插件会跟随 `dsh-wechat` 已绑定的首个微信用户；填了则只认该 wxid。

## 能力对照（vs QQ companion）

| 模块 | 本插件 | 说明 |
| --- | --- | --- |
| guard | 有 | `[[silent]]`、剥旁白、吞报幕；只作用于本插件 `speak()`，不拦 `dsh-wechat` 自己的自动回复 |
| rhythm | 有 | 仅本插件 `speak()` 的分气泡/延迟；`dsh-wechat` 自己已有打字合并与发送队列 |
| prompt | 有 | 每轮规则 + 鲸鱼 SOUL/STYLE；通过 `systemPrompt.section` 注入，默认只给 `dsh-wechat` 绑定的会话 |
| persona | 有 | 心情/精力/亲和 + 主动找主人；从 `session/event` 观察绑定会话的收发 |
| stamp / adopt | 仅自定义宿主 | 属于插件自己的 `ingest()` 路径；`dsh-wechat` 自己管会话绑定与消息，不需要也不使用 |
| sleep / lastword | 有 | 从绑定会话的 `session/event` 观察 assistant 消息：睡意、最后一句话 |
| diary / promise | 有 | `wx_diary`、`wx_promise` 工具；promise 到点提醒 |
| tier / circadian | 有 | 从好感/消息时间派生；tier 用于主动发言文案与 `/physical`，circadian 用于主动发言时段门控；无独立工具 |
| temper / solitude / focus | 部分 | 只有状态结构，没有工具/写入入口；当前不会产生数据，**不要当作已实现** |
| media | 有 | 发图 / 表情目录；语音可选降级 |
| ownerGate | 有 | 默认跟随 `dsh-wechat` 已绑定用户；`ownerWxid` 可覆盖 |
| toolGuard | 可选 | **默认关**。`tools.guard()` 是 profile 全局的，开启后会拦所有 agent 的危险工具 |
| http `/physical` | 有 | 仅 `127.0.0.1:3199` |
| isolation / mention / poke / hands / linkcard | 无对等 | 微信无私聊群语义，默认关 |

> `dsh-wechat` 已负责入站→agent、出站→微信、打字合并、静默/结论模式、限流与白名单；
> 本插件默认不重复接管这些路径，只补人设、情绪、`wx_*` 工具和插件自己发起的消息。

## 配置（节选）

见 `cordis.patch.yml`。常用：

```yaml
- id: dsh-wechat-whale-companion
  config:
    ownerWxid: ""             # 空 = 跟随 dsh-wechat 已绑定用户
    wechatStorageDir: ""      # 空 = ~/.dsh-wechat（读 state.json 的 session 绑定）
    modules:
      prompt:
        scope: wechat         # wechat = 只注入 dsh-wechat 绑定会话；all = 全 profile
      rhythm:
        inboundMergeMs: 2000
        bubbleDelayMs: "600,1800"
        # 默认都关：dsh-wechat 已负责入站→agent、出站→微信
        speakOnAgentEnd: false
        deliverToAgent: false
        autoIngest: false
      media:
        voice: false
      toolGuard:
        enabled: false        # 开启会拦整个 profile 的危险工具，慎用
        allowDangerous: false
```

状态目录默认：`~/.dsh/plugins/dsh-wechat-whale-companion/`。

## 运行时 API

插件加载后以 Cordis 服务形式提供：`ctx.get('whaleCompanion')`；其他插件也可声明 `inject: ['whaleCompanion']` 后直接读取。

- `ingest({ peer, text, at })` — 主人校验 + stamp + 入站合并
- `speak(text)` — guard 清洗后分气泡发送

观测：`http://127.0.0.1:3199/physical`

## 人设

默认：`assets/persona/SOUL.md`、`STYLE.md`。可直接改文件或在后续版本用配置覆盖。

## 边界

- **依赖 `dsh-wechat` 的持久绑定**：插件通过 `~/.dsh-wechat/state.json` 的 `users[*].sessionId` 判断哪些会话来自微信。绑定文件不存在时，人设注入返回空、主动发言不启动；这是为了不污染同一 profile 里的 GUI / 编程会话。若 `dsh-wechat` 改过 `storageDir`，用 `wechatStorageDir` 指过去。
- **出站走 `send_wechat` 工具**：`dsh-wechat` 0.13 不提供 service。插件调用它注册的工具，因此受它的 10 条/窗口限流与 `/next` 队列约束；不再有旧的 `wechat` service 路径。
- **guard 不接管 `dsh-wechat` 的自动回复**：`dsh-wechat` 直接从 `session/event` 推送 assistant 文本，不经过本插件的 `wechat/outbound` 钩子。`[[silent]]`/旁白清洗只对 `ctx.whaleCompanion.speak()` 生效；日常自动回复请用 `dsh-wechat` 自带的 `/silent`、`/final`。
- **`toolGuard` 是全局的**：`tools.guard()` 挂在插件上下文上会拦 profile 内所有 agent。默认关闭；只想给陪伴会话禁工具时，不要用这个开关。
- **`ownerGate` 只保护插件自己的 `ingest()`**：真正的微信入站白名单是 `dsh-wechat` 的 `allowedUsers`；本插件默认跟随它已绑定的首个用户。
- ClawBot **无微信群**；主动推送受 iLink `context_token` 限制，失败时需主人先发一条续期。
- 用**小号**；面板与本插件 HTTP 面勿暴露公网。

## 测试

```bash
npm test
```

## License

MIT。与 DeepSeek / 腾讯微信官方互不隶属。
