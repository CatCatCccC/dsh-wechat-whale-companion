# dsh-wechat-whale-companion

DeepSeek Harness（DSH）**微信单人私聊**陪伴插件：挂在 [`dsh-wechat`](https://github.com/pan17/dsh-wechat) 之上，注入鲸鱼娘短句人设，并接管日常出站（`[[silent]]` / `---wx-next---` 分气泡）、情绪、主动找主人与 `wx_*` 工具。

> **一行不改** `node_modules/dsh-wechat`。入站/日常出站都由 `dsh-wechat` 推送；本插件做人设、情绪、主动找你与 `wx_*` 工具。  
> 注意：`/silent` 只表示「少发过程、只发最终回复」，**仍会推一条**。不要再开 `deliverAssistant`，否则同一句会发两次。

## 依赖

- DSH `>=0.2.x <0.3`
- **`dsh-wechat` >= 0.13**（先装并扫码）
- Node `>=22.19`

## 目录结构

```
dsh-wechat-whale-companion/
├── package.json              # 入口 exports → lib/index.js；dsh.bundle.patch
├── cordis.patch.yml          # 注册插件行 + 预设「微信鲸鱼娘」
├── LICENSE / README / AUTHORITY / DEVLOG
│
├── lib/                      # 运行时代码（随 npm 包发布）
│   ├── index.js              # 插件入口：装配 runtime、挂 modules
│   ├── core/                 # 无业务副作用的底座
│   │   ├── config.js         # 默认配置 / 合并
│   │   ├── ctx.js            # softGet 等 ctx 工具
│   │   ├── state.js          # mergeDefaults
│   │   ├── memory-store.js   # 插件状态落盘 ~/.dsh/plugins/...
│   │   ├── chat-journal.js   # 滚动【近期对话】
│   │   ├── meme-pack.js      # 本地表情包索引
│   │   ├── image-search.js   # 搜狗等搜图缓存
│   │   ├── tools.js          # 工具晚注册
│   │   ├── wechat.js         # 出站 speak / 绑定探测
│   │   ├── wechat-config.js  # 读 dsh-wechat 配置
│   │   └── wechat-state.js   # 读 ~/.dsh-wechat/state.json
│   └── modules/              # 按能力拆分的功能模块（apply* 模式）
│       ├── prompt.js         # 注入 SOUL/STYLE/【此刻】/【近期对话】
│       ├── persona.js        # 心情/精力/亲和/睡着/lastword
│       ├── mood-words.js     # 【此刻】中文标签
│       ├── owner-react.js    # 主人话 → 心情涨跌
│       ├── proactive.js      # 主动找主人意图池
│       ├── memory.js         # 鱼记忆 + journal + wx_memory
│       ├── nurture.js        # 日记/约定/关系档/作息
│       ├── media.js          # wx_sticker
│       ├── guard.js          # [[silent]] 等
│       ├── rhythm.js         # 分气泡节奏
│       ├── owner.js          # ownerWxid 识别
│       ├── reset.js          # /whale-reset
│       └── http.js           # :3199 /physical /reset
│
├── assets/                   # 静态资源（随包发布）
│   ├── persona/              # SOUL.md 人设 · STYLE.md 口吻
│   ├── meme-packs/           # dsh-meme 风格图库（多 pack + ATTRIBUTION）
│   └── stickers/             # 旧版兜底小图
│
├── test/                     # node:test（不进 npm pack）
└── scripts/                  # 维护脚本，如 export-meme-indexes
```

人设正文就是女娲蒸馏后的「小鱼思维 OS」（已微信适配），只维护 `assets/persona/`，无第二份 skills 底稿。

| 路径 | 进 npm 包？ | 说明 |
| --- | --- | --- |
| `lib/` `assets/` `cordis.patch.yml` | 是 | 运行时必需 |
| `test/` `scripts/` `DEVLOG.md` | 否 | 开发/参考 |

**运行时状态（不在仓库里）**

| 位置 | 内容 |
| --- | --- |
| `~/.dsh/plugins/dsh-wechat-whale-companion/` | fish-memory、chat-journal、mood、diary、promises… |
| `~/.dsh-wechat/state.json` | 微信会话绑定（依赖 dsh-wechat） |

工作区上层（`鲸鱼娘/`）还有部署笔记等，**不是本 npm 包的一部分**：

```
鲸鱼娘/
├── dsh-wechat-whale-companion/   ← 本插件（可独立 git/npm）
├── linux-deploy-dsh-whale.md
├── fish.md
└── _diag/                        # 本地诊断用，勿发布
```

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
| vision | 微信入站图（`文件已保存到: path`）→ DSH attachment，由 **deepseek-flash 原生识图**（无需额外 key）。可选 `vision.mode=describe` 走智谱转写 |
| http `/physical` | 含 `health` / `memory` / `vision` 诊断；可选 `token` |

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
      vision:
        enabled: true
        mode: native            # native=deepseek-flash 直接看图；describe=智谱转写(需 ZHIPU_API_KEY)
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
