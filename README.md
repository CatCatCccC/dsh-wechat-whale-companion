# dsh-wechat-whale-companion

DeepSeek Harness（DSH）**微信单人私聊**陪伴插件：挂在 [`dsh-wechat`](https://github.com/pan17/dsh-wechat) 之上，注入鲸鱼娘短句人设，并接管日常出站（`[[silent]]` / `---wx-next---` 分气泡）、情绪、主动找主人与 `wx_*` 工具。

> **一行不改** `node_modules/dsh-wechat`。入站/日常出站都由 `dsh-wechat` 推送；本插件做人设、情绪、主动找你与 `wx_*` 工具。  
> 注意：`/silent` 只表示「少发过程、只发最终回复」，**仍会推一条**。不要再开 `deliverAssistant`，否则同一句会发两次。

## 依赖

- DSH `>=0.2.x <0.3`
- **`dsh-wechat` >= 0.13**（先装并扫码）
- Node `>=22.19`

## 安装

```bash
dsh plugin --profile web add dsh-wechat
dsh plugin --profile web add github:CatCatCccC/dsh-wechat-whale-companion
# Docker: docker exec -it dsh-harness dsh plugin --profile web add github:CatCatCccC/dsh-wechat-whale-companion
# docker restart dsh-harness
```

网页「设置 → 插件」也可填：`github:CatCatCccC/dsh-wechat-whale-companion`。

装完后建议：

```text
/preset switch 微信鲸鱼娘
/session new
```

（本包会注册轻量预设「微信鲸鱼娘」，**不会**强行改你的默认预设。）

## 出站（重要）

默认 **`deliverAssistant: false`**：日常回复只走 `dsh-wechat`，避免双发。  
`speak()` / 自动拆句仍用于**主动找你、promise 提醒**等插件自己发起的发送。

可选把 `silent: true`（少刷「执行过程」），与是否双发无关。

观测：`http://127.0.0.1:3199/physical` 看 `health` / `outbound.noDouble`。

## 能力

| 能力 | 说明 |
| --- | --- |
| prompt | SOUL/STYLE + 精简 RULES；【此刻】含档位/心情口吻/时段；默认只注入微信绑定会话 |
| outbound | 默认不接管日常出站（防双发）；主动发言仍用 speak |
| persona | 心情/精力/亲和（跟主人话内容涨跌）+ **意图化主动找你**（沉默加权、偶发贴纸） |
| guard / rhythm | `[[silent]]`、分气泡延迟 |
| diary / promise | `wx_diary` / `wx_promise` |
| memory | **鱼的记忆**（淡忘半衰期、长期事实、配额、`wx_memory`；对标 [dsh-fish-memory](https://github.com/Yuuyuko-uu/dsh-fish-memory) 思路） |
| media | `wx_sticker`：优先 **dsh-meme 风格本地图库**（大肥鱼/鲸鱼娘，`tag`/中文词）→ 旧 stickers → 搜狗缓存 |
| http `/physical` | 含 `health` / `memory` 诊断；可选 `token` |

## 配置（节选）

```yaml
- id: dsh-wechat-whale-companion
  config:
    ownerWxid: ""
    wechatStorageDir: ""
    modules:
      outbound:
        deliverAssistant: false        # true 会与 dsh-wechat 双发，勿开
        ensureWechatSilent: true       # 可选：少发过程气泡
      prompt:
        scope: wechat
        personaDir: ""          # 空 = 包内 assets/persona
      persona:
        timeZone: Asia/Shanghai        # 安静时段/干饭意图按此时区（防 Docker UTC 误判）
        proactiveChance: 0.18          # 基础概率；主人沉默越久越高
        proactiveCooldownMin: 22
        proactiveMinOwnerGapMin: 12    # 主人刚聊过不主动
        proactiveStickerChance: 0.28   # 主动时偶发表情
      memory:
        enabled: true
        halfLifeDays: 30        # 事件记忆淡一半的天数；fact 不淡
        maxInject: 6
        maxFacts: 3
        dailyQuota: 8           # 每天最多新记几条 event
        bridgeDiary: true       # wx_diary 同时写入 event 记忆
      media:
        memePacksDir: ""        # 额外图库根目录；空=只用包内 assets/meme-packs
        search: true            # 本地库未命中时再搜狗（ruseo / apihz）
        searchStyle: cute       # cute=偏可爱/软萌/治愈；raw=原词不改
        searchCacheMax: 80
        searchCooldownMs: 8000
      http:
        port: 3199
        token: ""               # 非空则 /physical?token=...
```

状态目录：`~/.dsh/plugins/dsh-wechat-whale-companion/`。  
内置图库：`assets/meme-packs/`（大肥鱼 + 鲸鱼娘，来自 [dsh-meme-packs](https://github.com/yyh-001/dsh-meme-packs)，见 `ATTRIBUTION.md`）。  
`wx_sticker` 优先 `tag=` / 中文词命中本地库，再搜网缓存到 `…/stickers-cache/`。

搜索源：ruseo 搜狗 → APIHZ。`searchStyle: cute` 偏可爱词；斗图改 `raw`。

发送前拷到会话 `.whale-stickers/` 并带 `agentId`；仍失败可开 dsh-wechat `allowAnyFilePath`。

> 搜网接口为第三方免费源，可能限频；图库多为非商业同人许可，建议私人自用。

## API

`ctx.get('whaleCompanion')`：`speak(text)`、`reprobeWechat()`。

## 边界

- 依赖 `~/.dsh-wechat/state.json` 会话绑定
- 主动推送受 iLink `context_token` 限制；失败时主人先发一句续期
- `toolGuard` 默认关（全局拦工具）
- 用小号；勿把 3199 暴露公网

## 测试

```bash
npm test
```

## License

MIT。与 DeepSeek / 腾讯微信官方互不隶属。
