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

起動後、Supabase CLI が表示する `Publishable key` (`sb_publishable_*`) / `Secret key` (`sb_secret_*`) / `Studio URL` / `Inbucket URL` を控える。

> 旧 Legacy API keys（`anon` / `service_role` JWT）を使っている場合、BE は `SUPABASE_SERVICE_ROLE_KEY` への後方互換を残しているのでそのまま動く（2026 年末でサポート終了予定）。新方式への切替推奨。

### 3. 環境変数を `.env.local` に設定

ルートの `.env.example` をコピーし、Supabase CLI の出力を反映：

```bash
cp .env.example apps/web/.env.local
# 編集:
#   SUPABASE_URL, SUPABASE_SECRET_KEY (sb_secret_*)
#   VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY (sb_publishable_*)
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

### Magic-link

| URL | 内容 |
|---|---|
| `/login?screen=signup` | メール入力 → Magic-link 送信（Supabase Inbucket でメール確認） |
| Inbucket のリンク | <http://127.0.0.1:54324> でメールを開き、リンクをクリック |
| `/auth/callback` | Supabase SDK がセッションを確立、profile 完了状態で分岐 |
| `/login?screen=create-account` | 氏名 / 表示名 / パスワード入力で `/auth/me/complete-signup` 呼び出し |
| `/dashboard` | 認証 + プロフィール完了済みユーザー向け（Sub-Phase 0.4 で本実装） |

### OAuth（Google / Microsoft）

ログイン/サインアップ画面の OAuth ボタンから `supabase.auth.signInWithOAuth` を発火。

| 手順 | 内容 |
|---|---|
| 1. `/login` の OAuth ボタンクリック | Supabase Auth が provider の認可ページへリダイレクト |
| 2. provider で承認 | Supabase が `/auth/callback` にセッション付きで戻す |
| 3. `AuthCallbackPage` が `/auth/me/sync` 呼び出し | `users` + `oauth_identities` 行を INSERT |
| 4. `/dashboard` 自動遷移 | `primaryAuthMethod` は `google` / `microsoft` |

> 同一メール別プロバイダ（FR-AUTH-12）の場合、`POST /auth/me/sync` が **409 SAME_EMAIL_DIFFERENT_PROVIDER** を返します。

## OAuth プロバイダ設定（外部設定）

ローカル / Vercel Preview / Production それぞれで以下のセットアップが必要。

### Google Cloud Console

1. <https://console.cloud.google.com/apis/credentials> で OAuth 2.0 クライアント ID を作成
2. アプリ種別：**Web application**
3. **Authorized redirect URIs** に Supabase のコールバックを追加：
   - ローカル: `http://127.0.0.1:54321/auth/v1/callback`
   - dev: `https://<dev-project-ref>.supabase.co/auth/v1/callback`
   - prod: `https://<prod-project-ref>.supabase.co/auth/v1/callback`
4. 発行された **Client ID** / **Client secret** を控える

### Microsoft Entra ID（旧 Azure AD）

1. <https://entra.microsoft.com/> で「アプリの登録」を新規作成
2. **リダイレクト URI**：上記 Supabase コールバックを 3 件登録
3. 「証明書とシークレット」で **クライアントシークレット** を発行
4. 「API のアクセス許可」で `openid` / `email` / `profile` を追加

### Supabase Dashboard

各プロジェクト（dev / prod）の Authentication → Providers で Google / Azure を有効化し、上で発行した Client ID / Secret を貼り付ける。

### ローカル開発

`supabase/config.toml` の `auth.external.google` / `auth.external.azure` の `enabled = false` を `true` に変更し、`apps/web/.env.local` に以下を追加：

```dotenv
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
MICROSOFT_OAUTH_CLIENT_ID=...
MICROSOFT_OAUTH_CLIENT_SECRET=...
```

`supabase stop && supabase start` で再起動。

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
