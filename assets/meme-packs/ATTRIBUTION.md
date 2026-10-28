# 表情图库来源说明

本目录收录的图库来自 [yyh-001/dsh-meme-packs](https://github.com/yyh-001/dsh-meme-packs)（dsh-meme 市场），格式兼容 dsh-meme（`memes/<tag>/` + `index.json`）。

每张图都带 **细分类 tag**（如 `like`/`sleep`）并归入六个情绪桶：`happy` / `angry` / `sad` / `shy` / `confused` / `daily`。`wx_sticker` 按桶或中文词选图。

| 包 | 数量 | 许可 | 说明 |
| --- | ---: | --- | --- |
| dafeiyu-001 | 24 | personal | 大肥鱼 chibi |
| dafeiyu-learned | 31 | personal | 大肥鱼·学图补充 |
| whale-girl-emoji | 91 | noncommercial-fan | 鲸鱼娘同人合集 |
| maid-emoji | 47 | CC-BY-NC-SA-4.0 | 女仆鲸鱼娘 |
| paopao-whale-girl | 55 | CC-BY-NC-SA-4.0 | 泡泡表情包（AI 二次创作） |
| pack-mvc2p5cv | 18 | CC-BY-NC-SA-4.0 | GPT 生大肥鱼 |
| official-001 | 92 | CC-BY-NC-SA-4.0 | Astrbot 官方表情包1号 |

合计约 **358** 张。详细许可见上游 [LICENSES.md](https://github.com/yyh-001/dsh-meme-packs/blob/main/LICENSES.md)。私人微信陪伴自用；请勿擅自商用。

运行时只读各包 `index.json`（不携带 `index.db`，减小安装体积）。若从上游 ZIP 重新导入带 `index.db` 的包，在**仓库根目录**再导出（`scripts/` 不随 npm 包发布）：

```bash
node --experimental-sqlite scripts/export-meme-indexes.mjs
```
