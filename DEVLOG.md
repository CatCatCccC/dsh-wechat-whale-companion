# DEVLOG

## 0.2.28

- Persona: 还原女娲蒸馏全文进 SOUL（工作流/证据/时间线/谱系/诚实边界/对照示例/场景手册），体量约五千字级；STYLE 保留表达 DNA 速查。

## 0.2.27

- Persona: SOUL/STYLE 直接采用女娲蒸馏稿（微信适配）；删除仓库内 `skills/`（避免双源）。

## 0.2.26

- Persona: Nuwa-distill 小鱼思维 OS → SOUL 加厚（中间态）；后由 0.2.27 直接升格为运行时人设。

## 0.2.25

- Reset: WeChat/DSH command `/whale-reset memory|mood|nurture|all`; also `GET /reset?scope=` and `wx_memory action=reset`.

## 0.2.24

- QQ/whale-loli live parity: SOUL is full 活人版（微信改）；every WeChat turn auto-writes `chat-journal.json` and injects 【近期对话】 so she stops acting amnesiac mid-chat.

## 0.2.23

- Persona: thicken to whale-loli 活人版 level — 铁律 / AI 味黑名单 / 示例；preset prefix aligned; hard nudges for memory/alarm turns.
- Memory: raise inject/quota; `autoCaptureOwner` for clear 喜好/名字/记住 lines so chat isn't empty when the model skips `wx_memory`.

## 0.2.22

- Promise: alarms still fire when `asleep` after 晚安 (was skipping the whole tick); poll every 1m; wake-style copy for 起床/叫醒; require `dueAt` on add; prompt insists verbal「记下了」is not enough.
- Prompt: honest vision rule — don't claim to see WeChat images without a vision/OCR path.

## 0.2.21

- Persona: rewrite SOUL/STYLE closer to 大肥鱼短人设（身份+口癖+底线）；【此刻】去掉长「口吻说明书」，改为短状态 +「刚才心里那一下」(feiyu-mood style).

## 0.2.20

- Persona: ban meta narration after stickers（「图发了」「表情包给你了」）；text only reacts to the owner’s words, not the tool action.

## 0.2.19

- Persona: `爱你`/`想你`/`在吗` no longer treated as dismiss (removed `length<=2` short-circuit); soft negations like `不喜欢你` skipped.
- Sleep: proactive「该睡了吧」no longer matches sleep detector; only clear sleep utterances (晚安/我睡了…).
- Outbound: wire `runtime.speak` (was only on whaleCompanion API — proactive/promise never hit guard/fingerprint); `speak()` forwards `agentId`/`to`; treat `sent===0` as failure; cooldown/recent only after successful send.
- Circadian: soft chance cut outside usual hours instead of hard skip.
- Memory: `formatWhen` uses Asia/Shanghai; `factKey` forces `kind=fact`.

## 0.2.18

- Stickers: alias `想你/想念` for proactive miss; `喝水` for hydrate; `findMeme` prefers name/query over tag when both set; stage names keep extension when truncating; drop unused `index.db` (~4MB) — runtime uses `index.json` only.

## 0.2.17

- Stickers: Chinese aliases (干饭/比心/困了…) now prefer caption/keyword match inside the mood bucket instead of pure random (avoids 干饭→加班).

## 0.2.16

- Stickers: expand packs to ~358 images (大肥鱼/学图、鲸鱼娘、女仆、泡泡、GPT大肥鱼、官方1号); inventory shows Chinese mood buckets; all fine-tags mapped into happy/angry/sad/shy/confused/daily.

## 0.2.15

- Stickers: bundle dsh-meme-packs under `assets/meme-packs` (caption/keywords via `index.json`); `wx_sticker` prefers `tag=` / 中文词 pack hit, then legacy files, then Sogou search. See `assets/meme-packs/ATTRIBUTION.md`.

## 0.2.14

- Persona authenticity: `【此刻】` injects tier voice + mood speech rules + day-part + length bias (no separate styleHint line); owner text drives mood/affinity via `reactToOwnerText` (dismiss / apology / praise / 大肥鱼); thicker SOUL habits; sticker rules allow sulky short reply after send; proactive pools less「本小姐」boilerplate.

## 0.2.13

- Memory: WeChat-side fish memory aligned with Yuuyuko-uu/dsh-fish-memory ideas — half-life freshness, long-term facts, daily quota, factKey supersede, auto-inject `【记忆】` into persona, `wx_memory` tool; diary can bridge into event memories. Data: `fish-memory.json` under stateDir.
- Memory hardening: daily quota uses `Asia/Shanghai` day boundary (Docker UTC safe); empty/stopword queries inject facts only (no random event dump); `formatWhen` distinguishes 去年 vs older years; `/physical` checks `tools.wx_memory`.

## 0.2.12

- Persona: thicken `SOUL.md` with situational reactions; loosen `STYLE.md` (default short, allow 2–3 bubbles); align preset prefix (drop daily `---wx-next---` / `[[silent]]`); add flex rule so replies feel less template-locked.

## 0.2.11

- Tools: wait for DSH `tools` service (`inject` + poll) before registering `wx_*`. One-shot `get('tools')` during `apply()` often no-ops → model claims「发图工具没挂着」. `/physical` now checks `tools.wx_sticker`.

## 0.2.10

- Stickers: pass WeChat-bound `agentId` into `send_wechat`. Without it dsh-wechat only allows registered workspaces (drops session cwd), so staged `.whale-stickers` copies were still refused after 0.2.9.

## 0.2.9

- Stickers: stage files into `<sessionCwd>/.whale-stickers/` before `send_wechat` so dsh-wechat's workspace path guard no longer refuses plugin/cache paths (the “图库罢工” symptom).

## 0.2.8

- Root-cause double bubbles: dsh-wechat `silent` still pushes the final reply; companion `deliverAssistant` was a second push. Default `deliverAssistant: false`. Auto-split kept for proactive/speak only.

## 0.2.7

- Stickers: re-bundle sample assets; harden prompt so「发个表情」must call `wx_sticker` (no verbal refusal); show inventory + turn nudge in persona block.

## 0.2.6

- Proactive / circadian hours use `persona.timeZone` (default `Asia/Shanghai`) so UTC Docker containers no longer treat China daytime as quiet hours.

## 0.2.5

- Fix double WeChat bubbles: if `deliverAssistant` is on but dsh-wechat `silent` is off, skip plugin delivery (observe only). Claim speak fingerprint before async send to drop concurrent duplicate events.

## 0.2.4

- Proactive rewrite: intent pools (meal/miss/night/…), silence-weighted chance, recent-line dedupe, optional sticker on ping. Config: `proactiveMinOwnerGapMin`, `proactiveStickerChance`. `/physical` shows last intent / skip reason.

## 0.2.3

- `media.searchStyle: cute` (default): bias sticker search keywords with 可爱/软萌/治愈 so results skew prettier; set `raw` for exact meme keywords.

## 0.2.2

- Replace Baidu generic image search with dedicated 表情包 providers: Sogou via ruseo (no key) → APIHZ Sogou → APIHZ library. Better meme results for chat stickers.

## 0.2.1

- Auto sticker search: `wx_sticker` resolves local/cache first, else web search + cache. Cooldown + NSFW query block + cache prune.
- Prompt/tools text updated; `/physical` shows search fail hints.

## 0.2.0

- Outbound takeover: ensure dsh-wechat `silent`, deliver bound `assistant/message` via `speak()` so `[[silent]]` / `---wx-next---` work for daily chat; fingerprint dedupe avoids double mood/lastword.
- Register slim agent preset「微信鲸鱼娘」in `cordis.patch.yml`.
- Stronger proactive (0.15 / 25m, time-of-day pools, lastword avoid, `proactiveFailReason`).
- Stickers in `assets/stickers/` + tool/prompt triggers; mood as Chinese words; `personaDir` config.
- `/physical` gains `health` + optional `http.token`; sleep/lastword folded into persona; fatFishHits + quiet affinity hint.
- Drop duplicate mood `systemPrompt.context`.

## 0.1.13

- Drop unused `patch.js`, `httpSendText`, legacy `wechat/outbound` hook, `wx_say`/voice (no TTS), `owner.allow`/`lockFirstPeer` (ingest gone), `persona.bump`, stamp leftover prompt rule.
- Prefer `send_wechat` tool probe first; keep a thin legacy service fallback.
- Single outbound queue via `rhythm.sendPaced` (remove duplicate speakChain).

## 0.1.12

- WeChat-only slim: drop QQ stubs (`isolation` / `mention` / `poke` / `hands` / `linkcard`), unused `stamp` / `adopt`, and placeholder `temper` / `solitude` / `focus` (no writers).
- Remove custom-host inbound bridge (`ingest`, `autoIngest`, `deliverToAgent`, `speakOnAgentEnd`, inbound merger). Daily chat stays on `dsh-wechat`; this plugin keeps `speak()` for proactive / promise / tools.
- README rewritten around the WeChat path only.

## 0.1.11

- Fix persona section never registering: `systemPrompt` is not guaranteed to be mounted when the profile bundle's `apply()` runs, so the one-shot `ctx.get('systemPrompt')` in 0.1.10 returned undefined and the plugin silently injected nothing (`prompt.injected=0`, `prompt.skipped=0`). Registration now waits with `ctx.inject(['systemPrompt'], …)` plus a short poll, and records `prompt.registered` / `prompt.source` in `/physical`.
- Add a regression test for a `systemPrompt` service that appears after `apply()`.

## 0.1.10

- Persona not sounding like 鲸鱼娘: inject via `systemPrompt.section` (system instructions), not only weak `context()` user-snapshots.
- Broader wechat session match (agent.id / session.id / cwd); `/physical` now shows `wechatSessions` + prompt hit/skip counters for diagnosis.
- Strengthen SOUL.md identity lines (anti assistant-voice).

## 0.1.9

- Fix the `session/event` observer: DSH puts the message payload under `event.data` (`data.message.content`), while 0.1.8 read only flat `event.message`/`event.content`. As a result the bound WeChat session was recognized, but `persona.lastOwnerAt`, `stats.wechatUserMessages` and `lastword` stayed empty.
- Ignore non-human `user/message` events (`source.kind !== "user"`): runtime context, skill reminders and time-context are also appended as user messages and must not count as the owner speaking.

## 0.1.8

- Fix `cannot set property "whaleCompanion" without provide`: Cordis 4 only allows declared services on `ctx`. Register the runtime API with `ctx.provide('whaleCompanion', api)` instead of assigning `ctx.whaleCompanion`, and drop the manual delete on dispose (the provide effect owns cleanup).
- Register a teardown effect before any module runs, so a throwing module cannot leak the HTTP listener or timers.
- **Tools**: `wx_diary` / `wx_promise` / `wx_send_image` / `wx_sticker` / `wx_say` now use DSH's `tools.register({ name, description, parameters, output, execute })` shape. The old three-argument call silently failed on DSH 0.2.x because `output` was missing, so none of the tools were visible.
- **Prompt**: replace the ineffective `agent/pre-step` message rewrite with `systemPrompt.context()`. The pre-step listener only mutated its local payload; `next()` built the request from its own claimed messages. The context is gated by the session bindings in `~/.dsh-wechat/state.json` (`prompt.scope: wechat`, default), so it no longer leaks the whale persona into GUI/coding sessions. `scope: all` is opt-in.
- **Channel**: dsh-wechat 0.13 exposes no `wechat` service; add an outbound adapter over its `send_wechat` tool. `speak()`, proactive pings and promise reminders now work again, and re-probe lazily if dsh-wechat registers after us.
- **Inbound state**: observe `session/event` only for dsh-wechat-bound sessions; feed `persona.onOwnerMessage` / `onReply`, `sleep.observeOutbound`, `lastword.record` and `circadian.touch`. This makes proactive cooldowns and mood state real under dsh-wechat instead of only working through the unused `ingest()` path.
- **Owner gate**: prefer dsh-wechat's persisted first user instead of racing to lock a different first peer. `ownerWxid` still overrides.
- **toolGuard**: default off. `tools.guard()` is profile-global, so the old default denied dangerous tools for every agent, not just the WeChat session.
- Fix `wx_promise complete` returning `undefined`, non-numeric `dueAt` comparison, UTC day keys in `temper`, and non-finite `circadian.touch` timestamps.
- README now marks `temper` / `solitude` / `focus` as state placeholders: they have storage shapes but no tool or caller, so they produce no data today.

## 0.1.7

- Fix `cannot get property "wechat" without inject`: all optional services via `ctx.get` / `softGet` (never `ctx.wechat` etc.).

## 0.1.6

- Remove exported `Config = {}` (breaks DSH config projection; same as onebot-companion).
- `/physical` bind `0.0.0.0` inside Docker so host port publish works; bare metal stays loopback.
- Slim `cordis.patch.yml` to `insert` only; exports/repository fields aligned with DSH packages.
- Default `deliverToAgent`/`autoIngest`/`speakOnAgentEnd` = false — `dsh-wechat` already bridges; avoids double turns.

## 0.1.5

- Fix enable stuck PENDING: remove fake-optional `inject: ['agents?', …]` — Cordis waits forever; use `ctx.get` / `?.` instead.

## 0.1.4

- Fix DSH install reject: `dsh.bundle` must be `{ patch: "./cordis.patch.yml" }` (not flat `bundle: true` + `bundle.patch`).
- Align `cordis.patch.yml` with official `insert:` shape (same as onebot-companion).

## 0.1.2

- Windows-safe atomic state overwrite; state key basename lock.
- Stamp once per merged batch (was per-line gap spam).
- `autoIngest` + skip host `next` when `deliverToAgent` (anti double-turn).
- Promise/temper prune; proactive soft backoff 20m; corrupt JSON array guards.
- Ingest 800ms dedupe (multi-event double); outbound send queue; merge `firstAt`.
- `wx_say` text fallback fixed (was blocked when sendVoice existed); image path allowlist.
- speak always cleans (even if guard off); side-effects after successful send; wall-clock dedupe; path.relative allowlist.

## 0.1.1

- Fix `StateStore.flush()` dropping debounced payloads (would lose mood on restart).
- Fix proactive send when `sendPaced` missing; rollback `lastProactiveAt` on send failure.
- Wire inbound merge flush → agent `followup`/`send` (`deliverBatchToAgent`).
- Idempotent dispose; delayed wechat re-probe; energy regen; quiet hours / focus / circadian gates.
- Guard: bubble cap, consecutive dedupe, safer silent strip; persona mergeDefaults for partial disk state.
- Prompt asset mtime cache; promise reminder doesn't complete on send fail; image size/type checks.
- Circadian `activeHours` only returns hours with activity (was gating proactive to hours 0–4 forever).
- `agent/end` paced speak off by default (`rhythm.speakOnAgentEnd`) to avoid double-send.
- Adopt: resume failure falls through to create; promise fail backs off 30m; proactive/promise pass `to: owner`.

## 0.1.0

- Initial scaffold: Cordis bundle entry, config merge, state store.
- WeChat probe adapter (fail-soft).
- Modules: guard, rhythm, prompt (+ whale SOUL/STYLE), persona, stamp, adopt, sleep, lastword.
- Nurture: diary, promise, tier, temper, circadian, solitude, focus + wx_* tools.
- Media: wx_send_image / wx_sticker; optional wx_say degrade.
- Owner whitelist + tool hard gate; loopback `/physical`.
- QQ-only stubs forced off with warnings.
- Node native tests for guard / stamp / config / rhythm.
