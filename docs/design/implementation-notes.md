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
| **Supabase キー新方式移行（Phase 1 直前）** | 設計書 §6 は Legacy API keys（`anon` JWT / `service_role` JWT）前提 | **新方式 `sb_publishable_*` / `sb_secret_*` へ移行**。BE 側 env は `SUPABASE_SECRET_KEY` 優先 / `SUPABASE_SERVICE_ROLE_KEY` フォールバック、FE 側は `VITE_SUPABASE_PUBLISHABLE_KEY` に完全切替。JWT 署名キーとは独立管理になったため、`server/middleware/auth.ts` の iss/aud/JWKS 検証ロジックは不変 | Supabase Legacy API keys は 2026 年末でサポート終了予定。商用デプロイ前に新方式へ寄せて将来負債を回避。supabase-js は ^2.106.2 へ更新（新キー形式は apikey ヘッダーに渡すだけで透過対応） | 設計書 v1.2 § 6 環境変数表を新方式に書き換え |
| **認証メールのブランド統制（§5.3.2）** | Supabase 標準メールを OFF にし **auth Webhook 経由で Resend 送信**、テンプレは `server/lib/mail/` でコード管理 | **Supabase Custom SMTP に Resend を設定**し、件名/本文は Supabase Email Templates、from は SMTP 送信者設定で管理 | Webhook + Send Email Hook 実装より大幅に軽量。レート制限解消（デフォルト共有 SMTP 脱却）とブランド文言変更を設定作業のみで両立。手順は `operations.md §2.4.2` | 文言をコード/i18n で一元管理したくなれば Send Email Hook 方式へ移行 |
| **メールアドレス変更（#129）** | §5.3.9.5 は OAuth のメール変更を Webhook で片方向同期する想定 | **パスワードユーザーのみ実装**。FE `supabase.auth.updateUser({ email })`（`double_confirm_changes=true` で新旧両アドレスへ Resend 経由の確認メール）→ 確認後 `/auth/callback` 着地で `/auth/me/sync` が走り、`syncUser` の `reconcileEmailIfChanged` が `public.users.email` を JWT(=auth.users) に追随。Webhook は使わない | Supabase 組み込みフローを使うため BE の変更点は sync のリコンサイル 1 箇所のみ。監査は `email_changed`（`extra.previousEmail`）。OAuth ユーザーの変更 UI は非表示 | OAuth のメール変更（下記参照）と、必要なら変更完了の Resend 通知メール |

## 設計書 v1.2 で追加・改訂すべき項目（提案）

1. **OAuth フローの図解**：FE 直接呼び出しを正規にし、BE ルートはオプション扱いに
2. **DnD ライブラリ**：`@dnd-kit` を採用例として記載
3. **`source='share'`**：`ck_be_actor_consistency` を 3 値 (`human`/`auto_chain`/`share`) に拡張する DDL を予約
4. **削除セマンティクス**：plan の物理削除は `ball_events` が無い場合のみ可能、キャンセル機能は Phase 1 で `status='canceled'` を使う
5. **shadcn 取り込み**：プロトタイプから流用する場合の `"use client"` の扱い指針

## OAuth ユーザーのメールアドレス変更（#129・未実装 / 方針メモ）

パスワードユーザーのメール変更は本 PR で実装済み。OAuth（Google/Microsoft）ユーザーの
メール変更は、issue #129 で「良い方針があれば検討したい」とされた探索項目であり、**本 PR では
未実装**。以下は検討結果と将来方針。

- **ユースケース**（issue 記載）：フリー Gmail → Google Workspace への切替でメールが変わっても、
  TRAKON アカウントは同一のまま使い続けたい。
- **難所**：OAuth のメールは**プロバイダが正**であり、`updateUser({ email })` では変えられない。
  さらに Gmail → Workspace は**別の Google アカウント**（`identities[].id` が別物）になるため、
  実体は「別 OAuth アイデンティティを既存 TRAKON ユーザーへ**再リンク / 移行**する」問題。
  現行 `syncUser` は新しい `auth_user_id` を**新規ユーザー**として作るため、そのままでは別アカウント化する。
- **想定アプローチ（いずれも Phase 1+）**：
  1. **アカウント連携（推奨）**：ログイン中に「別の Google/Microsoft を連携」させ、
     `oauth_identities` に 2 つ目の provider identity を追加。ログインは複数 identity → 同一
     `users.id` に解決。`primaryAuthMethod` は据え置き。UI とセキュリティ（乗っ取り防止の再認証）設計が要る。
  2. **メール到達性ベースの移行**：新メールに確認メール（Resend）を送り、確定後に
     `users.email` と `oauth_identities.email`、必要なら `auth_user_id` を張り替える。実装は重い。
  3. **プロバイダ側メール変更の片方向同期**：同一 Google アカウントのプライマリメールだけが変わる
     ケースに限り、§5.3.9.5 の Webhook 同期で `users.email` / `oauth_identities.email` を追随
     （別アカウント移行は対象外）。本 PR の `reconcileEmailIfChanged` は JWT email が変われば
     provider を問わず `users.email` を追随するため、この片方向同期の一部は既に満たしている。
- **結論**：安全な UX を伴う「アカウント連携」を第一候補として別 issue 化する。

## 各サブフェーズで生まれた追加成果物

- `docs/operations.md`：外部サービスの初回セットアップ手順 + Run-book
- `packages/db/operations/setup-roles.sql`：DB ロール分離スクリプト
- `.github/workflows/release-deploy.yml`：GitHub Release → Production デプロイ
- `apps/web/server/lib/mailer.ts`：dummy / Resend ファクトリ
- `apps/web/server/lib/sentry.ts` / `apps/web/src/lib/sentry.ts`：FE/BE Sentry init

---

## Phase 0.5（有料プラン・組織・権限ロール）実装時の補足

設計書 v1.2 の記述と実装が一致していることを前提に、**実装で初めて確定した細部**だけを残す。

| 項目 | 設計書 v1.2 | 実装 | 理由 / 影響 |
|---|---|---|---|
| 請求期間の読み取り | 「Subscription の current_period_*」 | Subscription 直下と Subscription Item の**両方**を見る | Stripe の API バージョンによって置き場所が異なるため、どちらでも読めるようにした |
| Price → プランの判定 | 環境変数の Price ID と突き合わせる | 同左（`planCodeFromPriceId`） | Price ID をソースコードに書かない方針の帰結。**env が未設定だと free 扱いになる**ので、本番では env 検証で必須にしている |
| 座席の再チェック（受諾時） | 「受諾時に再チェックする」 | この招待自身が消費している 1 座席を差し引いて判定する | 受諾は「招待 1 → 会員 1」の振り替えにすぎず、差し引かないと自分自身で上限に当たってしまう |
| 反映待ちのポーリング | 「状態が変わったら停止」 | 加えて **30 秒でタイムアウト**する | Webhook が遅延・欠落したときにポーリングが止まらなくなるのを防ぐ |
| `POST /plans` 系のガード | §3.4 の認可マトリクスに記載 | 新規に `requireProjectAction` を追加 | Phase 0 では「参加者なら誰でも」で**ノーガードだった**。型エラーにならないため、認可置換で最も漏れやすい箇所 |
| MSW の既定ハンドラ | 記述なし | `GET /billing/subscription` だけ既定を置く | 共通レイアウトが毎回呼ぶため。既定が無いと全ページのテストが未ハンドルで落ちる |

### 未実施（環境要因）

- **マイグレーションの適用と統合テストの実行**：ローカルの Docker が起動しておらず、
  `pnpm db:deploy` と `pnpm test:integration` を実行できていない。
  型チェック・lint・ユニットテスト（クライアント / サーバー）はすべて通っている。
  マイグレーション適用と統合テストは DB を起動できる環境で必ず実施すること。
- **Stripe テスト環境での E2E**：`docs/operations.md` §6.1 の 18 項目。
