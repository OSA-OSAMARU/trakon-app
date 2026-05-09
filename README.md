# TRAKON

> **Keep the ball moving.**

進行を整え、前に進めるためのプロダクト。制作プロジェクトの「ボール（責任の所在）」を可視化し、停滞を検知して次の一手を判断できる状態をつくる。

---

## ステータス

| 項目 | 状態 |
|---|---|
| PRD | v1.2（[docs/prd/trakon-prd.md](docs/prd/trakon-prd.md)） |
| 基本設計 | **v1.0 確定**（全6章、[docs/design/00-index.md](docs/design/00-index.md)） |
| 実装 | Phase 0（MVP）着手前 |

---

## ドキュメント

ドキュメント階層は **基本原則 > PRD > 基本設計書 > 実装仕様書** の順で運用する。判断が分かれた場合は上位ドキュメントへ立ち返る。

### 要件定義（PRD）
- [docs/prd/trakon-prd.md](docs/prd/trakon-prd.md) — TRAKON PRD v1.2

### 基本設計書
- [docs/design/00-index.md](docs/design/00-index.md) — 目次・改訂履歴・前提整理
- [docs/design/01-architecture.md](docs/design/01-architecture.md) — システム構成・技術スタック・拡張戦略
- [docs/design/02-database.md](docs/design/02-database.md) — DB 物理設計
- [docs/design/03-api.md](docs/design/03-api.md) — REST API・OpenAPI・認可ガード
- [docs/design/04-frontend.md](docs/design/04-frontend.md) — 画面・コンポーネント・状態管理
- [docs/design/05-security.md](docs/design/05-security.md) — 認証・認可・監査・OWASP 対策
- [docs/design/06-infrastructure.md](docs/design/06-infrastructure.md) — Vercel/Supabase 構成・CI/CD・運用

---

## 技術スタック（Phase 0 確定）

| 層 | 採用 |
|---|---|
| FE | React 18 + TypeScript + Vite + React Router v6 + Tailwind CSS + shadcn/ui |
| FE データ取得 | TanStack Query |
| FE クライアント状態 | Zustand |
| BE | Node.js + Hono on Vercel Functions（Node Runtime, hnd1） |
| API | REST + OpenAPI 3.1 + Zod |
| DB | Supabase Postgres（Tokyo、RLS 不使用、BE 経由認可） |
| ORM | Prisma |
| 認証 | Supabase Auth（招待トークンは自前 `invitations` テーブル） |
| メール | Resend（テンプレートは自前送信） |
| 長尺ジョブ | Inngest（Phase 1〜） |
| 監視 | Sentry + Vercel Logs + Better Stack Uptime |
| デプロイ | GitHub Release 公開トリガ → Vercel CLI 経由 Production |

詳細は [docs/design/01-architecture.md](docs/design/01-architecture.md) を参照。

---

## リポジトリ構成（予定）

```
trakon-app/
├─ apps/
│  └─ web/                          # Vite + React SPA + Hono on Vercel Functions
│     ├─ public/
│     ├─ src/                       # FE コード（Vite ビルド対象）
│     │  ├─ app/                    # React Router ルート定義・レイアウト
│     │  ├─ features/               # 機能別（auth / projects / items / plans / balls）
│     │  ├─ components/             # 共通 UI（shadcn/ui 取り込み）
│     │  ├─ lib/                    # API クライアント / Supabase Auth ラッパー
│     │  ├─ hooks/                  # カスタムフック
│     │  └─ stores/                 # Zustand ストア
│     ├─ server/                    # BE コード（Hono アプリ本体）
│     │  ├─ routes/v1/              # REST エンドポイント
│     │  ├─ middleware/             # 認証 / 認可 / ロギング
│     │  ├─ services/               # ドメインサービス
│     │  ├─ repositories/           # Prisma 経由データアクセス
│     │  └─ schemas/                # Zod スキーマ（OpenAPI 生成元）
│     └─ api/                       # Vercel Functions エントリ
├─ packages/
│  ├─ db/                          # Prisma スキーマ・マイグレーション・seed
│  └─ shared/                      # FE/BE 共有型・Zod スキーマ・ドメイン定数
├─ openapi/                        # OpenAPI 3.1 仕様書（apps/web/server から生成）
├─ supabase/                       # Supabase CLI 設定（ローカル開発・Branching）
├─ infra/                          # IaC（Phase 1〜）
├─ docs/                           # PRD・基本設計書
│  ├─ prd/
│  └─ design/
└─ .github/workflows/              # CI / OpenAPI チェック / Release デプロイ
```

詳細は [docs/design/01-architecture.md](docs/design/01-architecture.md)（§1.4 リポジトリ構成）を参照。

---

## セットアップ

> Phase 0 実装着手とともに整備します。

設計上の方針：
- ローカル開発 DB：[docs/design/06-infrastructure.md](docs/design/06-infrastructure.md)（§6.3.4、Supabase CLI でフルローカル）
- 環境変数：[docs/design/06-infrastructure.md](docs/design/06-infrastructure.md)（§6.5.3 / §6.7）
- マイグレーション運用：[docs/design/06-infrastructure.md](docs/design/06-infrastructure.md)（§6.9）

---

## デプロイ

| トリガ | 環境 | 内容 |
|---|---|---|
| PR 作成 / 更新 | **Preview**（Vercel） | Vercel Git Integration による自動デプロイ |
| `main` マージ | **Preview のみ** | Production には流れない |
| **GitHub Release 公開** | **Production** | `release-deploy.yml` が DB マイグレーション + Vercel CLI で本番デプロイ |

詳細は [docs/design/06-infrastructure.md](docs/design/06-infrastructure.md)（§6.5.4 デプロイ戦略）を参照。

---

## フェーズ計画（PRD §10）

| Phase | 概要 | 状態 |
|---|---|---|
| **Phase 0** | MVP：縦型スケジュール上でボールの受け渡しを可視化 | 設計完了・実装着手前 |
| Phase 1 | ディレクターツール化（ダッシュボード・予定種別・差し戻し・通知・PDF・非会員URL共有） | 未着手 |
| Phase 2 | チームコラボ・組織・権限・MFA | 未着手 |
| Phase 3 | プロジェクト OS（テンプレート・KPI・公開 API） | 未着手 |

---

## ライセンス

Confidential — 株式会社おさまるカンパニー。社内・関係者向け。
