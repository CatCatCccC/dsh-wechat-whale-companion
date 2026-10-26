# DEVLOG

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
