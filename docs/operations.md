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

### 2.10 Stripe（有料プラン / Phase 0.5）

設計書 [07-billing.md](design/07-billing.md) §7.3 / §7.5、PRD §9.12。

> **【重要】Secret Key と Webhook Secret を、この文書・チャット・メール・
> スクリーンショットに一切記載しない**（PRD SR-BILL-04）。値は Vercel の
> 環境変数へ直接登録する。テストモードと本番モードで ID はすべて別値になるため、
> **テスト環境で本番 ID を流用しない**。

**A. 商品カタログ（テスト / 本番でそれぞれ実施）**

1. Product を 2 件作る：`Personal` と `Team`（プラン名は「Team」。"Teams" ではない）
2. 各 Product に月額 Price を 1 件ずつ作る
   - Personal: 980 JPY / month
   - Team: 9,800 JPY / month
   - 通貨は JPY（ゼロデシマル通貨なので小数点処理は不要）
   - **`tax_behavior` は `inclusive`（税込）**
3. **Price 作成後、`tax_behavior` が実際に `inclusive` になっているか API で確認する。**
   ダッシュボードの画面上では確認できない（Stripe 実装仕様書 §4.1）。

   ```bash
   stripe prices retrieve <PRICE_ID> | grep tax_behavior
   ```

   > ⚠️ **`tax_behavior` は一度 `inclusive` / `exclusive` を設定すると変更できない。**
   > `exclusive` のまま作ってしまった Price は、内税 Tax Rate と組み合わせると
   > Stripe が契約作成を拒否する（`tax_behavior that conflicts with the tax rates`）。
   > その場合は Price を作り直し、旧 Price を非アクティブ化して使用禁止 Price に加えること。
   > 作成直後の `unspecified` であれば `inclusive` へ更新できる。

4. 手動 Tax Rate を 1 件作る：日本国内向け消費税 10%・**内税（inclusive）**
   - 自動税計算（Stripe Tax）は使わない。この Tax Rate は請求書に消費税の内訳を
     表示するためのもので、課金総額は変えない

**A-2. Managed Payments を確認する**

Stripe アカウントの既定で **Managed Payments が有効**だと、Stripe が税を代行する前提に
なり `automatic_tax.enabled = true` が必須になる。本設計は税込 Price + 手動 Tax Rate なので
噛み合わず、**Checkout Session の作成が拒否される**。

アプリ側は `managed_payments.enabled = false` を明示的に渡してこれを回避するため、
ダッシュボードの設定を変更する必要はない。ただし挙動を把握しておくこと。

```
https://dashboard.stripe.com/settings/managed-payments
```

**B. Customer Portal**

1. Portal の構成（Configuration）を作る
2. **許可する**：支払方法の変更 / 請求書・領収情報の閲覧 / 期間終了時解約
3. **無効化する**：プラン変更、数量（quantity）の変更
   - トライアルの扱い・日割り請求・Team の会員数・Personal のプロジェクト数を
     いずれも TRAKON 側で確認する必要があるため。Portal 単独でのプラン変更を
     許すとこれらの条件確認をバイパスしてしまう（設計書 §7.8）
4. 構成 ID を `STRIPE_PORTAL_CONFIGURATION_ID` に登録する（既定構成に依存しない）

**C. Webhook（Event destinations）**

1. 送信先を登録する：`https://<環境のドメイン>/api/v1/stripe/webhook`
2. 購読イベント（設計書 §7.5.2）：
   - `checkout.session.completed`
   - `customer.subscription.created` / `updated` / `deleted` / `trial_will_end`
   - `invoice.paid` / `payment_failed` / `payment_action_required` / `updated`
3. 署名シークレットを `STRIPE_WEBHOOK_SECRET` に登録する
4. 支払い失敗時の再試行（スマートリトライ）が **7 日間・最大 4 回**であることを確認する
5. カード決済失敗時の顧客向け自動メールが有効になっていることを確認する
6. 適格請求書（インボイス制度）の登録番号が登録されていることを確認する

**D. 環境変数（Vercel に直接登録）**

`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PERSONAL_MONTHLY_PRICE_ID` /
`STRIPE_TEAM_MONTHLY_PRICE_ID` / `STRIPE_JP_TAX_RATE_ID` / `STRIPE_PORTAL_CONFIGURATION_ID`

クライアント公開鍵（Publishable Key）は**不要**。ホスト型 Checkout へサーバーサイドで
リダイレクトするだけで、ブラウザ側で Stripe SDK を動かさないため。

**E. ローカルでの疎通確認**

```bash
stripe listen --forward-to localhost:3001/api/v1/stripe/webhook
```

表示される `whsec_...` をローカルの `STRIPE_WEBHOOK_SECRET` に設定してから
`pnpm dev` を起動する。別ターミナルでイベントを流して反映を確認する：

```bash
stripe trigger customer.subscription.updated
```

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

### トライアル重複判定の手動解除（Phase 0.5）

設計書 [07-billing.md](design/07-billing.md) §7.9.3。

無料トライアルは 1 アカウント・1 組織につき原則 1 回。判定は
ユーザー ID / 正規化メール / 組織 ID / 過去の顧客 ID で行う。
**法人カードの共有などで誤判定があり得るため、運営が手動で解除できる。**

> 管理画面は用意していない（Phase 0.5 の意図的なスコープ外）。Supabase の
> SQL Editor から直接更新する。**行は削除せず `released_*` を埋める**（履歴を残すため）。

1. 対象を特定する

   ```sql
   SELECT id, organization_id, user_id, email_normalized, email_domain,
          claimed_at, released_at
     FROM billing_trial_claims
    WHERE email_normalized = lower('対象のメールアドレス')
      AND released_at IS NULL;
   ```

2. 解除する（`released_by` には対応した運用者が分かる文字列を入れる）

   ```sql
   UPDATE billing_trial_claims
      SET released_at = now(),
          released_reason = '法人カード共有による誤判定のため解除（問い合わせ #____）',
          released_by = '運用者名'
    WHERE id = '<対象の id>';
   ```

3. 監査ログを 1 行残す

   ```sql
   INSERT INTO audit_logs (action, resource_type, resource_id, result, extra)
   VALUES ('trial_released', 'subscription', '<organization_id>', 'success',
           jsonb_build_object('releasedBy', '運用者名', 'reason', '誤判定のため'));
   ```

4. ユーザーに再度お申し込みいただく

> `email_domain` の一致は**記録のみで自動拒否には使っていない**ため、
> 同一ドメインというだけで解除が必要になることはない。

### 支払い失敗時の対応（Phase 0.5）

1. 支払い失敗は Webhook（`invoice.payment_failed`）で自動的に検知され、
   契約は「支払遅延」になり **猶予期限（初回失敗 + 7 日）** が設定される
2. 猶予期間中は**通常どおり利用できる**。アプリ内バナーと通知メールで案内される
3. ユーザーが Customer Portal でカードを更新し、再試行が成功すると自動復旧する
4. 7 日間・最大 4 回の再試行がすべて失敗すると `unpaid` となり、
   編集を停止して閲覧のみになる。**データは削除しない**
5. 状態を確認する場合：

   ```sql
   SELECT organization_id, plan_code, status,
          last_payment_failed_at, grace_period_ends_at
     FROM billing_subscriptions
    WHERE status IN ('past_due', 'unpaid');
   ```

> 猶予期限は**初回失敗時に一度だけ**設定し、再試行のたびに延ばさない（設計書 §7.10.2）。

### Webhook の再送・詰まりの調査（Phase 0.5）

受信は `stripe_events` に台帳として残る。イベント ID に一意制約があるため、
同じイベントを二重に処理することはない。

```sql
-- 失敗・スキップしたイベント
SELECT stripe_event_id, event_type, status, error, received_at
  FROM stripe_events
 WHERE status IN ('failed', 'skipped')
 ORDER BY received_at DESC
 LIMIT 50;
```

`failed` のものは Stripe 側からの再送で自動的に解消することが多い（処理は冪等）。
解消しない場合は Stripe ダッシュボードの Webhook 画面から手動で再送する。

### 招待リンクの調査

監査ログから追跡可能：

```sql
SELECT al.occurred_at, al.action, al.ip, al.user_agent, al.extra
FROM audit_logs al
WHERE al.share_link_id = '<uuid>'
ORDER BY al.occurred_at DESC;
```

---

## 6. 本番公開前チェックリスト（有料プラン / Phase 0.5）

Stripe 実装仕様書 §16 / §17 に対応する。**すべて満たしてからリリースする。**

### 6.1 Stripe テスト環境での確認

テスト環境は Product / Price / Tax Rate / Webhook をすべて新規に作る（本番 ID の流用は禁止）。

| # | 項目 | 結果 | 確認できたこと |
|---|---|:---:|---|
| 1 | Personal の新規加入 | ✅ | Checkout に「5 日間無料 / ¥980 / 消費税 (10% を含む) ¥89 / 今日 ¥0」 |
| 2 | Team の新規加入 | ✅ | Checkout 発行・契約作成とも成功（Price 修正後） |
| 3 | 120 時間のトライアル中であること | ✅ | `trial_end - trial_start` がちょうど 120 時間 |
| 4 | トライアル終了後の初回請求書生成・決済成功 | ✅ | 税込 9,800 円ちょうど（内税 891 円）。Test Clocks |
| 5 | トライアル終了後の初回請求書生成・決済失敗 | ✅ | `past_due` + 猶予ちょうど 7 日。再試行で猶予が延びないことも確認 |
| 6 | Checkout の途中離脱（契約が作られないこと） | ✅ | DB・Stripe とも契約なし。「完了していません」を表示 |
| 7 | Checkout 成功後にブラウザを閉じても反映されること | ✅ | success URL 到達だけでは Free のまま。Webhook 受信で有効化 |
| 8 | Webhook の重複受信で副作用が 1 回だけであること | ✅ | 同一 `event.id` の 2 回目は `duplicate:true` で早期 200。DB は +1 のみ |
| 9 | Webhook の順序逆転で最終状態が壊れないこと | ✅ | 1 時間前の `trialing` が後着しても `active` を維持 |
| 10 | Personal → Team のプラン変更（決済成功まで昇格しないこと） | ✅ | 直後は `pending_plan_code=team` のみ。`invoice.paid` で昇格 |
| 11 | Team → Personal のプラン変更（次回更新時に適用） | ✅ | Subscription Schedule を作成し `pending_plan_effective_at` を記録 |
| 12 | トライアル中の解約 | ✅ | `canceled_pending` として期間終了まで利用可 |
| 13 | 通常解約（期間終了までの利用継続を含む） | ✅ | 予約・取り消しとも成功。プロジェクト・会員は減らない |
| 14 | Customer Portal でのカード変更 | ✅ | 構成はプラン変更のみ無効。カード変更が `mastercard ****4444` として反映 |
| 15 | 支払い失敗後の復旧 | ✅ | 未払いを支払うと `active` へ戻り、猶予と失敗時刻がクリア |
| 16 | Free 上限超過状態での解約（**データが消えないこと**） | ✅ | 実効 Free へ降格し 1 件凍結。プロジェクト 3 件すべて残存 |
| 17 | 再契約（既存顧客・保存データの再利用） | ✅ | 既存顧客を再利用。トライアルは再付与されず `trial_blocked` を記録 |
| 18 | テスト環境と本番環境の ID が混在していないこと | ✅ | Price / Tax Rate が本番 ID と別物であることを確認 |

> **実施日**: 2026-09-06（テストモード / `stripe listen` によるローカル疎通）

#### 実施中に見つかった不具合（すべて修正済み）

| 事象 | 影響 | 対応 |
|---|---|---|
| Team Price の `tax_behavior` が `exclusive` | 内税 Tax Rate と衝突し **Team の契約作成が全滅** | Price を作り直し（`tax_behavior` は変更不可） |
| Managed Payments がアカウント既定で有効 | `automatic_tax=true` を要求され **Checkout の発行が全滅** | `managed_payments.enabled=false` を明示指定 |
| 解約後も契約プランを表示していた | **同じプランへ再契約できない**。解約ボタンで 500 | 表示と導線を `effectivePlanCode` に統一 |
| カード情報がどこからも保存されていなかった | 「お支払い方法」が常に非表示 | 契約イベントの `retrieve` で展開しブランドと下 4 桁を保存 |

いずれも**実際に Stripe を叩いて初めて出た**もので、ユニットテスト（Stripe を差し替える）や
型チェックでは検出できなかった。

**時間経過を伴う 3 項目（トライアル 120 時間の経過 / 請求サイクルの更新 /
支払い失敗 7 日後の unpaid 移行）は Stripe Test Clocks で圧縮して確認する。**
自動テストには入れていない（外部依存と実行時間のため）。

### 6.2 本番公開の合格条件

- [ ] 本番の Product / Price が作成済みで、**使用禁止 Price をコード上で参照していない**
      （過去に作られた誤り Price・アーカイブ済み Price。ID は Stripe ダッシュボードで確認）
- [x] 各 Price の `tax_behavior` が実際に `inclusive` であることを **API で確認済み**
      （ダッシュボード画面では確認できない。**2026-09-06 に本番の 2 件とも `inclusive` を確認**）
- [ ] **本番 Webhook エンドポイントを登録し、疎通と署名検証を確認済み** ← 未実施。残る最大の作業
- [ ] 購読イベントすべてについて DB への反映を確認済み
- [x] §6.1 のテスト項目 18 件をテスト環境で実施しパス（2026-09-06）
- [x] 本番の環境変数（Secret 含む）が Vercel へ直接登録済みで、
      **文書・チャット上に値が残っていない**
      （Production / Preview とも 6 件登録済み。値は Sensitive 設定で CLI からも復号できない）
- [ ] Customer Portal の**本番**設定でプラン変更が無効化されていることを確認済み
      （テストモードの構成では確認済み）
- [x] テスト環境と本番環境の ID（Product / Price / Customer）が混在していない
