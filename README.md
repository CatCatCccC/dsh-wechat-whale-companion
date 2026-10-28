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
| prompt | SOUL/STYLE + 精简 RULES；心情用语词；默认只注入微信绑定会话 |
| outbound | 默认不接管日常出站（防双发）；主动发言仍用 speak |
| persona | 心情/精力/亲和 + **意图化主动找你**（沉默加权、偶发贴纸） |
| guard / rhythm | `[[silent]]`、分气泡延迟 |
| diary / promise | `wx_diary` / `wx_promise` |
| media | `wx_send_image` / `wx_sticker`（本地 + **搜狗等表情包搜索缓存**） |
| http `/physical` | 含 `health` 诊断；可选 `token` |

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
      media:
        search: true            # 搜狗表情包（ruseo / apihz），免费国内
        searchStyle: cute       # cute=偏可爱/软萌/治愈；raw=原词不改
        searchCacheMax: 80
        searchCooldownMs: 8000
      http:
        port: 3199
        token: ""               # 非空则 /physical?token=...
```

状态目录：`~/.dsh/plugins/dsh-wechat-whale-companion/`。  
搜到的表情缓存在：`…/stickers-cache/`。

表情搜索源（按顺序尝试）：
1. `api.ruseo.cn` 搜狗表情包（无需 Key）
2. `cn.apihz.cn` 搜狗通道（公共 id/key，共享限频）
3. `cn.apihz.cn` 官方表情库

`searchStyle: cute`（默认）会把「傲娇」变成「傲娇可爱/软萌/治愈」再搜，同一池里更偏好看一点；要斗图表情改 `raw`。

发送前会把图片拷到微信会话工作区下的 `.whale-stickers/`，并带上绑定会话的 `agentId`（dsh-wechat 按「调用方会话」校验路径；不传会丢掉会话 cwd）。仍失败时可在 dsh-wechat 设置打开 `allowAnyFilePath`。

> 均为第三方免费接口，可能限频或失效；失败时用颜文字。注意版权，建议自用。

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
