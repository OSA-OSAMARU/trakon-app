# TRAKON 運用ハンドブック (Phase 0)

Phase 0 商用リリースに必要な **外部サービスのセットアップ手順** と、**運用上の Run-book / セキュリティチェックリスト** をまとめる。

> 設計書本体は `docs/design/` 配下。実装と設計書の差分は [docs/design/implementation-notes.md](design/implementation-notes.md) を参照。

---

## 1. 環境構成

| 環境 | 用途 | Supabase | Vercel | Domain |
|---|---|---|---|---|
| **local** | 開発者ローカル | `supabase start` で起動 | `pnpm dev` | <http://localhost:5173> |
| **dev** | 共有 Preview / QA | Supabase project (dev) | Vercel Preview (PR 連動) | プレビュー URL |
| **prod** | 本番 | Supabase project (prod) | Vercel Production | 本ドメイン |

環境変数のテンプレートは [`/.env.example`](../.env.example) を参照。

---

## 2. 初回セットアップ手順

### 2.1 Vercel プロジェクト

1. <https://vercel.com/new> で `OSAMARU-TRAKON/trakon-app` を Import
2. **Root Directory** を `apps/web` に設定
3. Framework Preset: Vite（自動検出されることを確認）
4. Build / Install / Output は `apps/web/vercel.json` の値で上書きされる
5. Regions: **hnd1**（Tokyo）

### 2.2 Supabase プロジェクト（dev / prod それぞれ）

1. <https://supabase.com/dashboard> で **Tokyo リージョン** にプロジェクト作成
2. Database → Connection Pooling から `DATABASE_URL`（Transaction）と `DIRECT_URL`（Session）を控える
3. Settings → API から `Project URL` / **`Publishable key`**（`sb_publishable_*`）/ **`Secret key`**（`sb_secret_*`）を控える
   - **新方式 API キー（Publishable / Secret）を使用すること**。旧 Legacy API keys（`anon` / `service_role` JWT）は 2026 年末でサポート終了予定
   - BE は旧 `SUPABASE_SERVICE_ROLE_KEY` への後方互換を残しているが、新規プロジェクトは Secret key で投入する
4. 初回のみ DB ロール分離 SQL を実行（[2.5 節](#25-db-ロール分離)）
5. Prisma マイグレーションを `migrate deploy` で適用：
   ```bash
   DATABASE_URL=... DIRECT_URL=... pnpm --filter @trakon/db exec prisma migrate deploy
   ```

### 2.3 OAuth プロバイダ（Google / Microsoft）

[apps/web/README.md §「OAuth プロバイダ設定」](../apps/web/README.md) を参照。dev / prod で別 OAuth App を作成。

### 2.4 Resend（メール送信）

TRAKON のメールは **2 系統** あり、いずれも Resend に集約する：

| 系統 | 送信経路 | 対象メール | from / 文面の管理 |
|---|---|---|---|
| **アプリ独自** | Resend SDK（`server/lib/mailer.ts`） | プロジェクト招待 | コードで制御（`RESEND_FROM_EMAIL` / `mailer.ts`） |
| **認証系** | **Supabase Auth → Resend Custom SMTP** | サインアップ確認 / Magic Link / パスワード再設定 | Supabase の Email Templates / SMTP 送信者設定 |

> **重要（レート制限）**：Supabase の認証メールは、Custom SMTP を設定しないと **Supabase 共有のデフォルト SMTP**（1 時間あたり数通の極めて厳しい制限）で送られる。複数人が一斉にサインアップすると即詰まる。**下記 2.4.2 の Custom SMTP 設定でこの制限を解消する**こと。

#### 2.4.1 Resend セットアップ（共通）

1. <https://resend.com/signup>
2. Domains で送信元ドメイン（例 `trakon.example.com`）を追加し、表示される **SPF / DKIM / DMARC** の DNS レコードを設定（**検証完了**まで待つ。未検証だと迷惑メール判定・送信失敗の原因）
3. API Keys から API キーを発行
4. Vercel Env に投入（招待メール = アプリ独自送信用）：
   - `RESEND_API_KEY=<key>`
   - `RESEND_FROM_EMAIL=TRAKON <noreply@trakon.example.com>`
5. `APP_ENV=prod` のとき必須。未設定だと起動時に例外

> dev / local では `RESEND_API_KEY` を空のままでも `console.log` ダミー送信にフォールバックする。

#### 2.4.2 Supabase Custom SMTP（認証メールを Resend 経由にする）

prod の Supabase プロジェクトで設定する（dev も同様に設定推奨）。

1. Resend の SMTP 接続情報を用意：
   - Host: `smtp.resend.com` / Port: `465`（または `587`）
   - Username: `resend` / Password: **Resend API キー**（2.4.1 で発行したもの）
2. Supabase Dashboard → **Authentication → Emails → SMTP Settings** を有効化し、上記を入力
3. **Sender**（送信者）に `noreply@trakon.example.com` / 表示名 `TRAKON` を設定 → これが認証メールの `from` になる
4. **Authentication → Rate Limits → Email sending** を運用想定に合わせて引き上げる（Custom SMTP 設定後はここが実質の上限。デフォルトの 30 通/時などでは一斉登録で不足する場合あり）
5. **Authentication → Email Templates** で Confirm signup / Magic Link / Reset Password / Change Email の **件名・本文** を編集。**貼り付け用テンプレートは [email-templates.md](email-templates.md) に用意済み**（PRD UXR-05「煽らず濁さず逃げない」。招待メール `mailer.ts` とトーン統一）

> ローカル（`supabase start`）は `[inbucket]` でメールを受けるため Custom SMTP 設定は不要。

### 2.5 DB ロール分離

設計書 §6.9 / §5.4 に従い `app_user`（DML）と `app_migrator`（DDL）を分離する。

```bash
psql "$DIRECT_URL" \
  -v trakon.migrator_password='<strong-pw>' \
  -v trakon.app_user_password='<strong-pw>' \
  -f packages/db/operations/setup-roles.sql
```

その後、**アプリの `DATABASE_URL` は `app_user`**、**`release-deploy.yml` の `PROD_DATABASE_URL`/`PROD_DIRECT_URL` は `app_migrator`** で接続する。

### 2.6 Sentry

1. <https://sentry.io> で 1 プロジェクト作成（Phase 0 は単一プロジェクトに `environment` タグで dev/prod を区別）
2. DSN を控える
3. Vercel Env に投入：
   - `SENTRY_DSN`（BE 用）
   - `VITE_SENTRY_DSN`（FE 用）
   - `SENTRY_ENVIRONMENT=prod`（または `dev`）
4. 未設定なら Sentry SDK は no-op で動作（開発中は OK）

### 2.7 Better Stack Uptime

1. <https://betterstack.com/uptime>
2. 監視対象 URL: `https://<prod-domain>/api/v1/healthz`
3. Check 間隔: 5 分（設計書 §6.8）
4. アラート通知先（Slack / Email など）を設定

### 2.8 Supabase Pro 昇格（商用リリース前）

設計書 §6.5 / §6.8 に従い、prod 環境のみ Pro プランへ昇格する。

- **PITR**: 有効化（任意の時点へリストア可能）
- **Daily backups**: 7 日間保持
- **Custom SMTP**: **必須**（Resend を Custom SMTP として設定する。手順は [2.4.2 節](#242-supabase-custom-smtp認証メールを-resend-経由にする)）。未設定だと認証メールが Supabase デフォルト SMTP の厳しいレート制限に当たり、一斉サインアップで失敗する

### 2.9 GitHub Actions Secrets

`release-deploy.yml` で使う Secrets を Settings → Secrets and variables → Actions に登録：

| Secret | 値 |
|---|---|
| `VERCEL_TOKEN` | Vercel Personal Settings → Tokens で発行 |
| `VERCEL_ORG_ID` | Vercel Team Settings → ID |
| `VERCEL_PROJECT_ID` | 対象 Vercel プロジェクトの ID |
| `PROD_DATABASE_URL` | 本番 DB の `app_migrator` 接続 URL |
| `PROD_DIRECT_URL` | 本番 DB の `app_migrator` Direct URL |

---

## 3. デプロイ Run-book

### 3.1 通常リリース

1. `main` に PR をマージ → Vercel が自動で **Preview** デプロイ（dev 環境）
2. QA が Preview URL で受け入れ確認
3. GitHub で **Release** を作成（`v0.1.0` などのタグ）
4. `release-deploy.yml` が自動起動：
   1. `prisma migrate deploy`（本番 DB へマイグレーション適用）
   2. `vercel deploy --prod`
5. デプロイ後、`/api/v1/healthz` が 200 を返すことを Better Stack で確認

### 3.2 ロールバック

- **コード**：直前の Release を再公開すれば `vercel deploy` で復元
- **DB マイグレーション**：**前進的修正リリース**で対応（後方互換のあるカラム追加/データ移行で巻き戻す）
- 緊急時：Supabase PITR で本番 DB を直前の時点に巻き戻し（要 Pro プラン）

### 3.3 メール送信失敗時の対応

**招待メール（アプリ独自送信）**

1. Sentry でエラー詳細を確認
2. Resend Dashboard で送信ログを確認（バウンス / SPF / DKIM）
3. ユーザーには手動で再送（管理画面の参加者管理タブから削除→再追加）

**認証メール（サインアップ / Magic Link / パスワード再設定）**

1. **「メールが届かない・一斉登録で失敗する」場合、まず Custom SMTP（[2.4.2](#242-supabase-custom-smtp認証メールを-resend-経由にする)）が設定済みか確認**。未設定だと Supabase デフォルト SMTP の数通/時の制限に当たる
2. Resend Dashboard の送信ログに認証メールが出ているか確認（出ていなければ Supabase 側で Custom SMTP が効いていない）
3. Supabase Dashboard → Authentication → Rate Limits の上限と、ドメインの SPF/DKIM 検証状態を確認

---

## 4. セキュリティチェックリスト (Phase 0)

- [x] **TLS**：Vercel 標準で強制
- [x] **HSTS**：`vercel.json` で `max-age=63072000; includeSubDomains; preload`
- [x] **CSP**：Phase 0 は `'unsafe-inline'` 許容（nonce 化は Phase 1）
- [x] **X-Frame-Options: DENY** / **Permissions-Policy** / **Referrer-Policy** すべて設定
- [x] **JWT 検証**：Supabase JWKS から取得し RS256 + iss/aud 検証（`server/middleware/auth.ts`）
- [x] **同一メール 1 認証手段（FR-AUTH-12）**：409 `SAME_EMAIL_DIFFERENT_PROVIDER`
- [x] **招待トークン**：256bit 乱数 + SHA-256 ハッシュ、72h 有効期限
- [x] **非会員 URL**：同様に 256bit + SHA-256、scope 範囲外は 404 集約、`X-Robots-Tag: noindex,nofollow`
- [x] **append-only**：`audit_logs` / `ball_events` に UPDATE/DELETE を拒否するトリガ
- [x] **DB ロール分離**：`app_user`（DML）/ `app_migrator`（DDL）
- [x] **Sentry PII scrub**：Authorization / Cookie ヘッダを除去
- [x] **CI 監査**：lint + type-check + test
- [ ] **HIBP 照合**：Phase 1（パスワード漏えいチェック）
- [ ] **ロックアウト / レート制限**：Phase 1（Supabase Edge Functions or Vercel KV）
- [ ] **CSP nonce 化**：Phase 1

設計書 §5（セキュリティ）の全項目との詳細マッピングは [design/05-security.md](design/05-security.md) を参照。

---

## 5. よくある操作

### ローカル DB のリセット

```bash
supabase db reset      # 全テーブル削除
pnpm db:migrate        # 再適用
```

### スキーマ変更

1. `packages/db/prisma/schema.prisma` を編集
2. `pnpm --filter @trakon/db exec prisma migrate dev --name <description>`
3. PR でレビュー
4. main マージ後、Release で本番に適用

### 招待リンクの調査

監査ログから追跡可能：

```sql
SELECT al.occurred_at, al.action, al.ip, al.user_agent, al.extra
FROM audit_logs al
WHERE al.share_link_id = '<uuid>'
ORDER BY al.occurred_at DESC;
```
