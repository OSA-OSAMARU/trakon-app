# 基本設計書 v1.1 と Phase 0 実装の差分一覧

Sub-Phase 0.0〜0.6 の実装過程で、基本設計書 v1.1 から意図的に外した・簡素化した箇所をまとめる。次回の設計書改訂（v1.2）にフィードバックする。

| 項目 | 設計書 v1.1 | Phase 0 実装 | 理由 / 影響 | Phase 1+ 対応 |
|---|---|---|---|---|
| **OAuth エンドポイント** | `POST /auth/oauth/:provider/{start,callback}` を BE 側に実装 | **FE で `supabase.auth.signInWithOAuth` 直接呼び出し** + 既存 `/auth/me/sync` で完結 | Supabase JS SDK が PKCE/state を内蔵しており、BE 経由ルートは付加価値が薄い。実装量を約 200 行削減 | 監査・追加バリデーション要件が出れば BE ルート化 |
| **Tailwind** | 3 系 | **Tailwind v4**（@tailwindcss/vite） | Figma Make プロトタイプ（v4 採用）との整合性 | — |
| **DnD ライブラリ** | `react-dnd`（プロトタイプと統一） | **`@dnd-kit/core`** | React 18 + Vite 6 親和性、API のシンプルさ。操作セマンティクスは同じ | 必要なら react-dnd へ寄せ直しも可 |
| **メンバーかんばん列構造** | 2 次元（状態行 × メンバー列） | **メンバー列のみ**（縦に active 予定を積む）、完了はボタン | Phase 0 で 5–10 名想定のためシンプル化 | 列数増・状態複雑化のタイミングで 2 次元化 |
| **非会員 TOSS/完了 の `source`** | `ck_be_actor_consistency` を満たすため `human` か `auto_chain` のみ | **`source='auto_chain'` + actor_*=NULL** で記録（system actor 扱い） | `ck_be_actor_consistency` を変えずに済む最小妥協 | `source='share'` を ALTER で追加し CHECK を更新 |
| **plan 削除** | アクティブボールがあれば警告 (UC-12) | **`ball_events` が 1 件でも付いた plan は 409 `PLAN_HAS_EVENTS`** で物理削除拒否 | append-only との整合性を最優先。Phase 0 は「キャンセル」未実装のため | `status='canceled'` 遷移を導入してキャンセルを可能に |
| **dashboard の集計範囲** | 今日のタスク + 期限超過 + 自分が見える全プロジェクト | 同上だが `scheduled_date <= today` の **active のみ**（完了は除外） | シンプルな実装を優先 | 必要なら直近 N 日のフィルタやサマリー追加 |
| **shadcn primitives "use client"** | — | **そのまま残置**（Vite SPA では無害） | Next.js のディレクティブ。削除コストの方が高い | — |
| **CSP nonce 化** | Phase 0 から検討 | **`unsafe-inline` 許容**（vercel.json） | Vite + Vercel での nonce 注入は build/serve 仕掛けが要、Phase 1 で集中対応 | `vercel.json` を nonce + HTML transform に拡張 |
| **HIBP / ロックアウト / レート制限** | Phase 1 | **未実装**（設計書通り） | — | Phase 1 で Upstash + Edge Functions 検討 |
| **Resend 送信失敗時のリトライ** | Phase 1 で Inngest 非同期化 | **同期送信 + 失敗で transaction rollback** | Phase 0 は単純さ優先 | Inngest で非同期化、再送ジョブ追加 |
| **マイグレーション diff の自動生成** | `prisma migrate dev` 推奨 | **手書き SQL** で CHECK 制約・トリガを明示 | `prisma migrate dev` だけでは CHECK / トリガ / 部分インデックスを自動生成できない | 設計書 §6.9 に追記想定 |

## 設計書 v1.2 で追加・改訂すべき項目（提案）

1. **OAuth フローの図解**：FE 直接呼び出しを正規にし、BE ルートはオプション扱いに
2. **DnD ライブラリ**：`@dnd-kit` を採用例として記載
3. **`source='share'`**：`ck_be_actor_consistency` を 3 値 (`human`/`auto_chain`/`share`) に拡張する DDL を予約
4. **削除セマンティクス**：plan の物理削除は `ball_events` が無い場合のみ可能、キャンセル機能は Phase 1 で `status='canceled'` を使う
5. **shadcn 取り込み**：プロトタイプから流用する場合の `"use client"` の扱い指針

## 各サブフェーズで生まれた追加成果物

- `docs/operations.md`：外部サービスの初回セットアップ手順 + Run-book
- `packages/db/operations/setup-roles.sql`：DB ロール分離スクリプト
- `.github/workflows/release-deploy.yml`：GitHub Release → Production デプロイ
- `apps/web/server/lib/mailer.ts`：dummy / Resend ファクトリ
- `apps/web/server/lib/sentry.ts` / `apps/web/src/lib/sentry.ts`：FE/BE Sentry init
