# AGENTS.md

## Repository overview
- Purpose: ローカルで動く Codex CLI 風のフロント + Hono バックエンドで `codex app-server` を橋渡しする開発支援アプリ
- Primary language/runtime: Node.js 22+ / TypeScript（React + Vite / Hono）
- Key entry points: `src/main.tsx`, `server/index.ts`

## Repo map (where to look / where NOT to touch)
- `src/`: フロントエンド
- `server/`: バックエンド（Hono + app-server ブリッジ）
- `tests/`: テスト（Vitest）
- `Docs/`: 仕様/ドキュメント
  - `Docs/codex-app-server-official-doc.md`: `codex app-server` の公式ドキュメント
- `data/`: 実行時データ（`data/repos.json` など）
- Avoid: `dist/`, `node_modules/`, `data/`

## Dev environment
- Required: node@22
- Install:
  - `pnpm install`
- Run locally:
  - `pnpm dev`
- Notes:
  - 重要な環境変数: `PORT`, `CODEXDOCK_DATA_DIR`, `LOG_LEVEL`
  - 実行時データは `data/` に保存される前提（秘密情報はコミットしない）

## Commands to validate changes (run these after edits)
- `pnpm check`（format + lint + typecheck + test）

## Coding conventions
- Formatting/lint: Biome（2スペース、import整理、lintは推奨ルール）
- Naming: 既存の命名に合わせる（ReactコンポーネントはPascalCase、関数/変数はcamelCase）
- Error handling/logging: 例外は握りつぶさない。ログはpinoを使い、文脈情報を含める。機密は出力しない
- Types/clean code: `any` 禁止。`unknown` + 型ガードで安全に絞り込む。未使用変数/型の放置禁止。最小変更で読みやすさを維持

## Working style
- ユーザーの明示的な指示があるまでコード編集はしない。問題の仮説・説明・プランニングに留める
- コードベースの調査などread onlyな作業は指示を仰ぐ前に積極的に行う
- install/check系のコマンドはユーザーに依頼せず自分で実行する。編集が完了したら毎回必ず実行する
- TDDを徹底する。常に「t-wadaならどうするか」を基準に考える
