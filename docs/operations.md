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
3. Settings → API から `Project URL` / `anon key` / `service_role key` を控える
4. 初回のみ DB ロール分離 SQL を実行（[2.5 節](#25-db-ロール分離)）
5. Prisma マイグレーションを `migrate deploy` で適用：
   ```bash
   DATABASE_URL=... DIRECT_URL=... pnpm --filter @trakon/db exec prisma migrate deploy
   ```

### 2.3 OAuth プロバイダ（Google / Microsoft）

[apps/web/README.md §「OAuth プロバイダ設定」](../apps/web/README.md) を参照。dev / prod で別 OAuth App を作成。

### 2.4 Resend（招待メール）

1. <https://resend.com/signup>
2. Domains で送信元ドメイン（例 `trakon.example.com`）を追加し、表示される **SPF / DKIM / DMARC** の DNS レコードを設定
3. API Keys から API キーを発行
4. Vercel Env に投入：
   - `RESEND_API_KEY=<key>`
   - `RESEND_FROM_EMAIL=TRAKON <noreply@trakon.example.com>`
5. `APP_ENV=prod` のとき必須。未設定だと起動時に例外

> dev / local では `RESEND_API_KEY` を空のままでも `console.log` ダミー送信にフォールバックする。

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
- **Custom SMTP**: 不要（Resend を使うため）

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

### 3.3 招待メール送信失敗時の対応

1. Sentry でエラー詳細を確認
2. Resend Dashboard で送信ログを確認（バウンス / SPF / DKIM）
3. ユーザーには手動で再送（管理画面の参加者管理タブから削除→再追加）

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
