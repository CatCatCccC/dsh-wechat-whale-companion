# dsh-wechat-whale-companion

DeepSeek Harness（DSH）**微信单人私聊**陪伴插件：挂在 [`dsh-wechat`](https://github.com/pan17/dsh-wechat) 之上，注入鲸鱼娘短句人设，并提供情绪 / 主动找主人 / `wx_*` 工具。

> 不重写微信通道；**一行不改** `node_modules/dsh-wechat`。入站→agent、出站→微信由 `dsh-wechat` 负责；本插件只补人设与陪伴侧能力。

## 依赖

- DSH `>=0.2.x <0.3`
- 先安装并扫码登录 **`dsh-wechat` >= 0.13**
- Node `>=22.19`

> `dsh-wechat` 0.13 没有对外 Cordis service，只注册 `send_wechat` 工具并把
> 「微信用户 → DSH session」写进 `~/.dsh-wechat/state.json`。
> 本插件读取这两样东西：没有绑定文件时，人设注入返回空、主动发言不启动。

## 安装

```bash
# 1. 微信通道
dsh plugin --profile web add dsh-wechat

# 2. 本插件（推荐从 GitHub）
dsh plugin --profile web add github:CatCatCccC/dsh-wechat-whale-companion

# Docker 示例：
# docker exec -it dsh-harness dsh plugin --profile web add github:CatCatCccC/dsh-wechat-whale-companion
# docker restart dsh-harness
```

网页「设置 → 插件」也可填：`github:CatCatCccC/dsh-wechat-whale-companion`。

重启 `dsh web`（或 `docker restart dsh-harness`）。默认不填 `ownerWxid`：跟随 `dsh-wechat` 已绑定的首个微信用户。

## 做什么 / 不做什么

| 能力 | 说明 |
| --- | --- |
| prompt | 每轮规则 + 鲸鱼 SOUL/STYLE；`systemPrompt.section` 注入，默认只给微信绑定会话 |
| persona | 心情/精力/亲和 + 主动找主人 |
| guard | `[[silent]]`、剥旁白；只作用于本插件 `speak()` |
| rhythm | 本插件 `speak()` 的分气泡/延迟 |
| sleep / lastword | 从绑定会话的 `session/event` 观察 |
| diary / promise | `wx_diary`、`wx_promise`；promise 到点提醒 |
| tier / circadian | 亲密度文案与主动发言时段门控 |
| media | 发图 / `assets/stickers` 表情 |
| http `/physical` | 观测面，默认 `127.0.0.1:3199` |

日常自动回复由 **`dsh-wechat`** 推送，不经过本插件的 `speak()`。静默/结论请用它自带的 `/silent`、`/final`。

## 配置（节选）

见 `cordis.patch.yml`（默认在 `normalizeConfig`）。常用：

```yaml
- id: dsh-wechat-whale-companion
  config:
    ownerWxid: ""             # 空 = 跟随 dsh-wechat 已绑定用户
    wechatStorageDir: ""      # 空 = ~/.dsh-wechat
    modules:
      prompt:
        scope: wechat         # wechat = 只注入绑定会话；all = 全 profile
      rhythm:
        bubbleDelayMs: "600,1800"
      toolGuard:
        enabled: false        # 开启会拦整个 profile 的危险工具，慎用
```

表情图放到 `assets/stickers/`（png/jpg/gif/webp），用工具 `wx_sticker`。

状态目录默认：`~/.dsh/plugins/dsh-wechat-whale-companion/`。

## 运行时 API

`ctx.get('whaleCompanion')`：

- `speak(text)` — guard 清洗后分气泡发送（主动发言 / 约定提醒 / 工具）
- `reprobeWechat()` — 重新探测 `send_wechat`

观测：`http://127.0.0.1:3199/physical`

## 人设

默认：`assets/persona/SOUL.md`、`STYLE.md`。

## 边界

- **依赖 `dsh-wechat` 绑定**：通过 `~/.dsh-wechat/state.json` 的 `users[*].sessionId` 识别微信会话。
- **出站走 `send_wechat`**：受其限流与队列约束。
- **`toolGuard` 是全局的**：默认关闭。
- ClawBot **无微信群**；主动推送受 iLink `context_token` 限制，失败时需主人先发一条续期。
- 用**小号**；面板与 `/physical` 勿暴露公网。

## 测试

```bash
npm test
```

## License

MIT。与 DeepSeek / 腾讯微信官方互不隶属。
