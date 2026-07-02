# 尖塔試煉（CardGame）

Slay the Spire 風格的卡牌構築肉鴿遊戲。TypeScript + Vite，零執行期依賴，
遊戲核心是一顆與 DOM 完全分離的純邏輯引擎。

## 特色

- **三幕地城**：10 層分支地圖 × 3 幕，戰鬥／精英／營火／事件／商店／頭目節點。
- **55 張可入手卡牌**（全部含升級版）＋ 18 種敵人（含分裂 Boss、半血狂暴最終 Boss）。
- **遺物、藥水、金幣經濟、文字事件**：完整的輪迴資源循環。
- **確定性戰鬥**：所有隨機皆走種子化 RNG，同一顆種子必然重現同一場戰鬥。
- **自動存檔**：地圖階段自動存檔（localStorage），關頁隨時續玩。
- **平衡模擬器**：貪婪策略 AI 自動打整輪，量測通關率驅動數值調整（目前 ~25%）。
- 傷害飄字、受擊震動、Web Audio 合成音效（零音檔）。

## 開始

```bash
npm install
npm run dev    # http://localhost:5173
```

其他指令：

```bash
npm test                          # vitest（92 tests）
npm run build                     # type check + production build
npm run sim                       # 平衡基準表 + 整輪通關率
npm run sim -- --runs 500 --full 1000   # 自訂模擬場數
```

## 架構

```
src/engine/   純邏輯引擎（絕不 import DOM）
  rng.ts        mulberry32 種子化 RNG
  types.ts      Effect union 等核心型別（新卡牌＝組合既有原子效果）
  statuses.ts   狀態效果與傷害公式（StS 規則）
  cards.ts      卡牌資料庫
  enemies.ts    敵人資料庫（sequence／weighted AI、死亡分裂、半血狂暴）
  battle.ts     單場戰鬥狀態機
  map.ts        分支地圖生成
  run.ts        整輪狀態機（地圖→節點→獎勵→過幕）
  relics.ts / potions.ts / events.ts
src/sim/      平衡模擬（貪婪策略、整輪模擬器）
src/ui/       DOM 渲染層（app.ts 是唯一操作 DOM 的地方）
tests/        vitest 測試
docs/         設計文件（規則以 docs/DESIGN.md 為準）
```

設計原則：邏輯與畫面分離、資料驅動內容、一切隨機可重現。
細節見 [CLAUDE.md](CLAUDE.md) 與 [docs/DESIGN.md](docs/DESIGN.md)；
開發歷程見 [PROGRESS.md](PROGRESS.md)。
