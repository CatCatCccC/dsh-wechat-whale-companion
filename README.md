# dsh-wechat-whale-companion

DeepSeek Harness（DSH）**微信单人私聊**陪伴插件：对标 [xfgil/dsh-onebot-companion](https://github.com/xfgil/dsh-onebot-companion) 的全量陪伴能力，挂在 [`dsh-wechat`](https://github.com/pan17/dsh-wechat) 之上，内置鲸鱼娘短句人设。

> 不重写微信通道；**一行不改** `node_modules/dsh-wechat`。QQ 群专属能力（@ / 戳一戳 / 名片赞等）配置保留但默认关闭。

## 依赖

- DSH `>=0.2.x <0.3`
- 先安装并扫码登录 **`dsh-wechat`**
- Node `>=22.19`

## 安装

```bash
dsh plugin --profile web add dsh-wechat
dsh plugin --profile web add /绝对路径/dsh-wechat-whale-companion
# 或发布后：
# dsh plugin --profile web add github:你的账号/dsh-wechat-whale-companion
```

重启 `dsh web`。可选配置 `ownerWxid`；留空且 `lockFirstPeer: true` 时，第一个私聊用户会被锁定为主人。

## 能力对照（vs QQ companion）

| 模块 | 本插件 | 说明 |
| --- | --- | --- |
| guard | 有 | `[[silent]]`、剥旁白、吞报幕 |
| rhythm | 有 | 入站合并 + 出站分气泡 + 延迟 |
| prompt | 有 | 每轮规则 + 鲸鱼 SOUL/STYLE |
| persona | 有 | 心情/精力/亲和 + 主动找主人 |
| stamp / adopt / sleep / lastword | 有 | 时间间隔、会话 resume、睡意、最后一句话 |
| diary / promise / tier / temper / circadian / solitude / focus | 有 | `wx_*` 工具与状态落盘 |
| media | 有 | 发图 / 表情目录；语音可选降级 |
| ownerGate + toolGuard | 有 | 单人白名单；默认禁危险工具 |
| http `/physical` | 有 | 仅 `127.0.0.1:3199` |
| isolation / mention / poke / hands / linkcard | 无对等 | 微信无私聊群语义，默认关 |

## 配置（节选）

见 `cordis.patch.yml`。常用：

```yaml
- id: dsh-wechat-whale-companion
  config:
    ownerWxid: ""           # 主人 wxid；空则锁定首个私聊对象
    lockFirstPeer: true
    modules:
      rhythm:
        inboundMergeMs: 2000
        bubbleDelayMs: "600,1800"
        # 仅当宿主不会自己把助手正文推到微信时再开，否则会双发
        speakOnAgentEnd: false
        # 宿主已自行把入站送进 agent 时改 false，避免双回合
        deliverToAgent: true
        autoIngest: true
      media:
        voice: false
      toolGuard:
        allowDangerous: false
```

状态目录默认：`~/.dsh/plugins/dsh-wechat-whale-companion/`。

## 运行时 API

插件加载后挂在 `ctx.whaleCompanion`：

- `ingest({ peer, text, at })` — 主人校验 + stamp + 入站合并
- `speak(text)` — guard 清洗后分气泡发送

观测：`http://127.0.0.1:3199/physical`

## 人设

默认：`assets/persona/SOUL.md`、`STYLE.md`。可直接改文件或在后续版本用配置覆盖。

## 边界

- ClawBot **无微信群**；主动推送受 iLink `context_token` 限制，失败时需主人先发一条续期。
- `dsh-wechat` 内部 API 不稳定：探测失败则降级，不崩宿主。
- 用**小号**；面板与本插件 HTTP 面勿暴露公网。

## 测试

```bash
npm test
```

## License

MIT。与 DeepSeek / 腾讯微信官方互不隶属。
