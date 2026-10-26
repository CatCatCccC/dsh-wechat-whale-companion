# DEVLOG

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
