# TRAKON

> **Keep the ball moving.**

進行を整え、前に進めるためのプロダクト。制作プロジェクトの「ボール（責任の所在）」を可視化し、停滞を検知して次の一手を判断できる状態をつくる。

[![CI](https://github.com/OSA-OSAMARU/trakon-app/actions/workflows/ci.yml/badge.svg)](https://github.com/OSA-OSAMARU/trakon-app/actions/workflows/ci.yml)
![backend coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/GIST_USER/GIST_ID/raw/trakon-backend-coverage.json)
![frontend coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/GIST_USER/GIST_ID/raw/trakon-frontend-coverage.json)
![shared coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/GIST_USER/GIST_ID/raw/trakon-shared-coverage.json)

> カバレッジバッジは初回セットアップが必要です（[テスト](#テスト) 参照）。`GIST_USER` / `GIST_ID` を実際の Gist に置き換えてください。

---

## ステータス

| 項目 | 状態 |
|---|---|
| PRD | v1.4（[docs/prd/trakon-prd.md](docs/prd/trakon-prd.md)） |
| 基本設計 | **v1.2 確定**（全7章、[docs/design/00-index.md](docs/design/00-index.md)）／実装差分は [implementation-notes](docs/design/implementation-notes.md) |
| 実装 | **Phase 0（MVP）完了** ✅ — **Phase 0.5（有料プラン・組織・権限ロール）実装中** |
| 運用手順 | [docs/operations.md](docs/operations.md) — Vercel / Supabase / Resend / Sentry / Better Stack |

### Sub-Phase 進捗

| Sub-Phase | 内容 | 状態 |
|---|---|---|
| **0.0** | 基盤セットアップ（モノレポ / Vite + Hono / Prisma / CI） | ✅ |
| **0.1** | 認証基盤（Magic-link / OAuth Google・Microsoft / JWT 検証） | ✅ |
| **0.2** | プロジェクト・制作物・参加者・招待受諾 | ✅ |
| **0.3** | 予定 / TOSS / 完了 / 自動連鎖 / SC-06 縦型カレンダー | ✅ |
| **0.4** | ダッシュボード SC-09 / メンバーかんばん SC-17（DnD） | ✅ |
| **0.5** | 非会員 URL 共有 SC-16 / `/share/:token` | ✅ |
| **0.6** | 仕上げ（Resend / Sentry / Release Deploy / DB ロール分離） | ✅ |

---

## ドキュメント

ドキュメント階層は **基本原則 > PRD > 基本設計書 > 実装仕様書** の順で運用する。判断が分かれた場合は上位ドキュメントへ立ち返る。

### 要件定義（PRD）
- [docs/prd/trakon-prd.md](docs/prd/trakon-prd.md) — TRAKON PRD v1.4

### 基本設計書
- [docs/design/00-index.md](docs/design/00-index.md) — 目次・改訂履歴・前提整理
- [docs/design/01-architecture.md](docs/design/01-architecture.md) — システム構成・技術スタック・拡張戦略
- [docs/design/02-database.md](docs/design/02-database.md) — DB 物理設計
- [docs/design/03-api.md](docs/design/03-api.md) — REST API・OpenAPI・認可ガード
- [docs/design/04-frontend.md](docs/design/04-frontend.md) — 画面・コンポーネント・状態管理
- [docs/design/05-security.md](docs/design/05-security.md) — 認証・認可・監査・OWASP 対策
- [docs/design/06-infrastructure.md](docs/design/06-infrastructure.md) — Vercel/Supabase 構成・CI/CD・運用
- [docs/design/07-billing.md](docs/design/07-billing.md) — 料金プラン・Stripe 連携・利用権限判定・権限ロール

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

## ローカルセットアップ

Supabase ローカルスタック（Postgres / Auth / Studio / メール確認）にフル接続して、FE + API を一度に立ち上げる手順。FE/API は同一オリジン（Vite が `/api` を Hono にプロキシ）なので追加設定は不要。

### 前提

| ツール | 要件 | 確認 |
|---|---|---|
| Node.js | 20〜22（`.nvmrc` 準拠） | `node -v` |
| pnpm | 10 系 | `pnpm -v` |
| Docker | **起動していること**（Supabase ローカルが利用） | `docker info` |
| Supabase CLI | `pnpm dlx supabase`（都度実行）または `brew install supabase/tap/supabase`（常設） | `pnpm dlx supabase --version` |

### 手順

```bash
# 1. 依存インストール + Prisma クライアント生成
pnpm install
pnpm db:generate

# 2. Supabase ローカルスタックを起動（初回は Docker イメージ取得で数分）
pnpm dlx supabase start
#   → 出力される Project URL / Publishable key / Secret key / DB URL を控える

# 3. 環境変数ファイルを作成し、上記の値を反映
cp .env.example apps/web/.env.local
#   apps/web/.env.local を編集:
#     SUPABASE_URL / SUPABASE_SECRET_KEY            (sb_secret_*)
#     VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (sb_publishable_*)
#     DATABASE_URL / DIRECT_URL                     (postgresql://postgres:postgres@127.0.0.1:54322/postgres?schema=public)

# 4. マイグレーションをローカル DB へ適用
pnpm db:deploy

# 5. 開発サーバ起動（Vite 5173 + Hono 3001 を同時起動）
pnpm dev
```

ブラウザで **http://localhost:5173** を開く。

### アクセス先

| 用途 | URL |
|---|---|
| アプリ（SPA） | http://localhost:5173 |
| API ヘルスチェック | http://localhost:5173/api/v1/healthz |
| Supabase Studio（DB GUI） | http://127.0.0.1:54323 |
| 受信メール確認（Magic-link 等） | http://127.0.0.1:54324 |

### Magic-link でログインを試す

1. http://localhost:5173/login?screen=signup でメールアドレスを入力して送信
2. http://127.0.0.1:54324 （メール確認 UI）に届いたメールのリンクを開く
3. プロフィール入力後 `/dashboard` へ

> 詳細な認証フロー・OAuth 設定は [apps/web/README.md](apps/web/README.md) を参照。

### 環境変数の読み込み（仕組み）

実値は **`apps/web/.env.local`**（gitignore）に集約する。Vite（FE）はこのファイルを自動ロードする。Hono dev サーバと Prisma は自動ロードしないため、`dotenv-cli` 経由で同ファイルを注入している（`dev:server` / `db:*` スクリプトに配線済み）。

### よく使うコマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` | FE + API を同時起動 |
| `pnpm db:deploy` | 既存マイグレーションをローカル DB へ非対話で適用（初回セットアップ向け） |
| `pnpm db:migrate` | 新規マイグレーション作成（スキーマ変更を伴う開発時） |
| `pnpm db:studio` | Prisma Studio を起動 |
| `pnpm dlx supabase stop` | Supabase ローカルスタックを停止 |
| `Ctrl + C` | 開発サーバ停止 |

> 補足: `pnpm db:migrate`（`prisma migrate dev`）は、`schema.prisma` の `@unique` と生 SQL の部分ユニークインデックスの差分により非対話環境で確認プロンプトを返すことがある。初回適用・ローカル再構築では `pnpm db:deploy` を使う。

設計上の方針（背景）：
- ローカル開発 DB：[docs/design/06-infrastructure.md](docs/design/06-infrastructure.md)（§6.3.4、Supabase CLI でフルローカル）
- 環境変数：[docs/design/06-infrastructure.md](docs/design/06-infrastructure.md)（§6.5.3 / §6.7）
- マイグレーション運用：[docs/design/06-infrastructure.md](docs/design/06-infrastructure.md)（§6.9）

---

## テスト

テストは Vitest で、3 つのプロジェクトに分割している（`apps/web/vitest.workspace.ts`）。

| 種別 | プロジェクト | 環境 | 対象 |
|---|---|---|---|
| FE ユニット / 統合 | `web-client` | jsdom + MSW | `apps/web/src/**/*.test.{ts,tsx}` |
| BE ユニット | `web-server-unit` | node（Prisma モック） | `apps/web/server/**/*.test.ts` |
| BE 統合 | `web-server-integration` | node（実テスト DB） | `apps/web/server/**/*.integration.test.ts` |
| 共有ドメイン | `@trakon/shared` | node | `packages/shared/src/**/*.test.ts` |

### コマンド

| コマンド | 内容 |
|---|---|
| `pnpm test` | 全 workspace のユニット + FE 統合（DB 不要） |
| `pnpm test:coverage` | カバレッジ付きで実行（`coverage/coverage-summary.json` 生成） |
| `pnpm test:integration` | BE 統合テスト（**実テスト DB が必要**） |
| `node scripts/coverage-summary.mjs` | BE / FE / shared の層別カバレッジを表示 |

> 単体テストの目標は **カバレッジ 80%**。閾値は各 `vitest.config.ts` の `coverage.thresholds` に固定の下限として保持し（現状値より少し低めに設定して環境差での誤検知を防ぐ）、退行を検知する。目標 80% へはテスト追加に合わせて段階的に手動で引き上げる。

### BE 統合テストの方針とローカル実行

ルートを `app.request()` でミドルウェアチェーン（認証 → 認可 → service → Prisma）ごと実行し、基本的な正常系と異常系（401 / 404 集約 / 422 / 409）を網羅する。

- 認証は Supabase のリモート JWKS をテスト用ローカル鍵に差し替え（`apps/web/server/test/auth.ts`）、`jwtVerify`・issuer / audience 検証は本物のまま任意ユーザーの JWT を発行する。
- DB は **使い捨てのテスト DB** を前提に、各テスト前に全テーブルを TRUNCATE する（`apps/web/server/test/integration.setup.ts`）。開発 DB を指さないこと。

```bash
# 例: Supabase ローカルとは別の test DB を用意して実行
createdb -h 127.0.0.1 -p 54322 -U postgres trakon_test   # 任意の方法で作成
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/trakon_test
export DIRECT_URL=$DATABASE_URL
pnpm --filter @trakon/db exec prisma migrate deploy        # スキーマ適用
pnpm test:integration
```

CI では `postgres:15` サービスコンテナ上で同等に実行する（`.github/workflows/ci.yml` の `integration` ジョブ）。

### FE 統合テストの方針

Playwright による実ブラウザ E2E は将来 Phase へ先送りし、当面は **jsdom + Testing Library + MSW** によるコンポーネント統合で主要ページ / モーダルのユーザー操作〜表示を検証する（`apps/web/src/test/render.tsx`・`handlers.ts`）。

### カバレッジバッジのセットアップ

非公開リポジトリのため、外部 SaaS を使わず GitHub Actions + Gist で可視化する。

1. Gist scope を付与した GitHub PAT を作成し、リポジトリの Secret `GIST_TOKEN` に登録。
2. 空の公開 Gist を 1 つ作成し、その ID をリポジトリの Variable `COVERAGE_GIST_ID` に登録。
3. README 冒頭のバッジ URL の `GIST_USER` / `GIST_ID` を、その Gist のユーザー名 / ID に置き換え。

`main` への push 時に CI が `schneegans/dynamic-badges-action` で Gist を更新し、shields.io エンドポイント経由でバッジに反映される。

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
| **Phase 0** | MVP：縦型スケジュール上でボールの受け渡しを可視化 | **完了** ✅ |
| **Phase 0.5** | 商用リリース：有料プラン（Stripe）・組織・プロジェクト権限ロール・ロール付き招待 | **実装中** |
| Phase 1 | ディレクターツール化（ダッシュボード・予定種別・差し戻し・通知・PDF） | 未着手 |
| Phase 2 | チームコラボ・組織レベル統制・MFA | 未着手 |
| Phase 3 | プロジェクト OS（テンプレート・KPI・公開 API） | 未着手 |

---

## ライセンス

Confidential — 株式会社おさまるカンパニー。社内・関係者向け。
