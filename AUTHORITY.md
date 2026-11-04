# Authority

- Channel: WeChat iLink via peer plugin `dsh-wechat` (not bundled).
- Companion behavior: this package (`dsh-wechat-whale-companion`).
- Design reference historically: `xfgil/dsh-onebot-companion` (QQ). This package is WeChat-DM-only and does not ship QQ group semantics.
- Daily WeChat outbound stays on dsh-wechat. `silent` only means "final reply only" (still one push). Do not enable `deliverAssistant` or replies double. Companion `speak()` is for proactive/promise/tools only.
- Persona assets under `assets/persona/` are community meme / fan-style defaults, not DeepSeek official branding.
- **Do not edit** files under `node_modules/dsh-wechat` on disk.
- **Allowed:** runtime prototype patch of `WeChatDSHBridge.sendReply` so persona `||` / `---wx-next---` / `[[next]]` become multi-bubble WeChat sends. Observability: `/physical` → `health.checks` `outbound.bubbleSplitPatch` / `outbound.bubbleSplitPeer`, and `stats.bubbleSplitPatch` / `bubbleSplitPeerVersion`.
