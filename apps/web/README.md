# @trakon/web

TRAKON の FE + BE 一体パッケージ（Vite + React + Hono on Vercel Functions）。

詳細設計は `docs/design/01-architecture.md` を参照。

## ローカル開発

### 1. ルートで依存をインストール

```bash
pnpm install
pnpm db:generate
```

### 2. Supabase ローカルスタックを起動

Supabase CLI が必要（未導入の場合 `brew install supabase/tap/supabase` または `pnpm dlx supabase`）。

```bash
supabase start                # Postgres / Auth / Studio / Inbucket をローカル起動
```

起動後、Supabase CLI が表示する `service_role key` / `anon key` / `Studio URL` / `Inbucket URL` を控える。

### 3. 環境変数を `.env.local` に設定

ルートの `.env.example` をコピーし、Supabase CLI の出力を反映：

```bash
cp .env.example apps/web/.env.local
# 編集:
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
#   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
#   DATABASE_URL, DIRECT_URL
```

### 4. マイグレーション適用

```bash
pnpm db:migrate                # prisma migrate dev
```

### 5. 開発サーバ起動

```bash
pnpm dev                        # web (5173) + server (3001) を concurrently で起動
```

ブラウザで <http://localhost:5173> を開く。

## 認証フロー（Sub-Phase 0.1）

| URL | 内容 |
|---|---|
| `/login?screen=signup` | メール入力 → Magic-link 送信（Supabase Inbucket でメール確認） |
| Inbucket のリンク | <http://127.0.0.1:54324> でメールを開き、リンクをクリック |
| `/auth/callback` | Supabase SDK がセッションを確立、profile 完了状態で分岐 |
| `/login?screen=create-account` | 氏名 / 表示名 / パスワード入力で `/auth/me/complete-signup` 呼び出し |
| `/dashboard` | 認証 + プロフィール完了済みユーザー向け（Sub-Phase 0.4 で本実装） |

## ディレクトリ

```
apps/web/
├─ src/                  # FE (Vite ビルド対象)
│  ├─ app/               # ページコンポーネント
│  ├─ components/ui/     # shadcn primitives
│  ├─ features/auth/     # SC-01 ログイン画面 / hooks / API クライアント
│  ├─ lib/               # supabase / api クライアント
│  └─ styles/            # Tailwind + shadcn テーマ
├─ server/               # BE (Hono アプリ)
│  ├─ routes/v1/         # /healthz, /auth/*
│  ├─ middleware/        # auth (JWT 検証), error
│  ├─ services/          # auth service など
│  ├─ schemas/           # Zod スキーマ
│  └─ lib/               # env / supabaseAdmin / errors
└─ api/[[...slug]].ts    # Vercel Functions エントリ
```

## スクリプト

| コマンド | 内容 |
|---|---|
| `pnpm dev` | FE + BE 同時起動 |
| `pnpm dev:web` / `pnpm dev:server` | 個別起動 |
| `pnpm build` | 本番ビルド (Vite) |
| `pnpm lint` / `pnpm type-check` / `pnpm test` | 品質ゲート |
