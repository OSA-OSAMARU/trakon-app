# TRAKON 基本設計書 / 目次

| 項目 | 内容 |
|---|---|
| プロダクト名 | TRAKON |
| 発行元 | 株式会社おさまるカンパニー |
| ドキュメント版 | **v1.1（非会員URL Phase 0 化 + プロトタイプ反映）** |
| 発行日 | 2026-05-24 |
| ステータス | **v1.1 確定**（全6章） |
| 本書の位置づけ | 基本原則 > PRD > **本基本設計書** > 実装仕様書 |
| 上位ドキュメント | [TRAKON PRD v1.3](../prd/trakon-prd.md) |

---

## 改訂履歴

| 版 | 日付 | 変更概要 | 記載者 |
|---|---|---|---|
| v0.1 | 2026-05-09 | 初版起稿。章立てと作成方針を確定。第1章「アーキテクチャ・技術スタック」着手。 | — |
| v0.2 | 2026-05-09 | 第1章「アーキテクチャ・技術スタック」v1.0 確定（BE FW=Hono / ORM=Prisma / メール=Resend / FE状態管理=TanStack Query+Zustand / Vercel単一プロジェクト / Supabase Free→Pro / 長尺ジョブ=Inngest）。リポジトリ構成を Vercel 単一プロジェクト方式へ更新。 | — |
| v0.3 | 2026-05-09 | 第2章「DB物理設計」v1.0 確定（主キー UUID v7 / ENUM=text+CHECK+Prisma enum / 論理削除 Prisma middleware / append-only REVOKE+Trigger / Ball Holder アプリ層計算 / 期間外予定アプリ警告のみ / invitations 自前 / TZ DB UTC＋アプリ JST / email 片方向同期 / project_members.user_id NULL 許容）。 | — |
| v0.4 | 2026-05-09 | 第3章「API設計」v1.0 確定（camelCase JSON / `{ data, meta, warnings, error }` エンベロープ / 未参加 404 集約 / カスタム JSON エラー / アクションエンドポイント方式 / オフセットページング / 最大 limit 200 / 招待メール同期＋ロールバック / warnings 配列 / 楽観ロックなし）。Phase 0 必須エンドポイント全23本を §3.6 で詳細化。 | — |
| v0.4.1 | 2026-05-09 | 第3章 v1.0.1 改訂：「ネスト深さ最大2階層」の縛りを撤回。データ所有関係を完全に URL に反映する方針へ統一（plans/items/ball actions/Phase 1 系のパスを階層化、認可ミドルウェアも階層チェーン化）。§3.5 に Items 詳細エンドポイントを追加（計24本）。 | — |
| v0.5 | 2026-05-09 | 第4章「画面・コンポーネント設計」v1.0 確定（Data Router + TQ集約 / RHF+zodResolver / date-fns / Lucide / **モーダルはURL同期** / CSS Grid 縦型カレンダー / 楽観更新 Phase 0 から / 祝日 FE直接 / accent 仮確定 / i18n はjaのみ集約）。Phase 0 必須画面 SC-01,02,03,04,06,07,08,10,11 を §4.4 で詳細化、Ball Holder 楽観更新責務を §4.7 で定義。 | — |
| v0.6 | 2026-05-09 | 第5章「セキュリティ実装設計」v1.0 確定（FE トークン localStorage + CSP厳格化 / Resend 自前送信 / パスワード Phase 0 8文字英数記号、HIBP は Phase 1 / ロックアウト Phase 1 / レート制限 Phase 1 / CSP は Phase 0 unsafe-inline 許容 / 監査ログは同期トランザクション / サインイン失敗は区別なし / 規約は同意チェックのみ / Sentry は PII scrub）。多層防御 7層・OWASP Top 10 対策・招待トークン自前管理を §5.3〜§5.7 で定義。 | — |
| v1.0 | 2026-05-09 | 第6章「インフラ・デプロイ・運用」v1.0 確定（dev+prod 2環境 / Supabase CLI ローカル / 仮ドメイン → 商用前に本確定 / Sentry 1プロジェクト + env タグ / Phase 0 はレビュースキップ可 / 復元テスト Phase 1 から / ログは既定保管 + audit_logs のみ DB 長期 / Better Stack Uptime / app_user + app_migrator 分離 / **Production デプロイは GitHub Release 公開がトリガ**）。全6章 v1.0 確定により基本設計書 v1.0 完成。 | — |
| v1.1a | 2026-05-09 | **PRD v1.3 改訂（非会員URL共有を Phase 1 → Phase 0 へ前倒し）に追従**。FR-SHARE-01〜06、SR-AUTH-08、UC-23、SC-16、`share_links` テーブルを Phase 0 スコープに取り込み、第1〜6章の Phase 区切り・テーブル定義・エンドポイント一覧・画面ツリー・認可ガード・監査ログ記録対象を更新。組織レベル統制（FR-ORG-04, 05、FR-SHARE-07、SR-AUTH-09、`organizations` / `organization_settings`）は Phase 2 維持。 | — |
| v1.1b | 2026-05-24 | **Figma Make プロトタイプ反映による全章改訂**。① Google/Microsoft OAuth（FR-AUTH-10、Phase 0 から）／② 新規登録項目拡充（full_name + display_name、Magic-link 風サインアップ、FR-AUTH-11）／③ 後続紐付け自動 TOSS（plans.successor_plan_id、FR-SCH-17、FR-BALL-13、UC-25）／④ ダッシュボード階層ビュー（プロジェクト×メンバー×今日、SC-09 改訂、Phase 0 へ繰り上げ）／⑤ カテゴリ必須（plans.category 6値、FR-SCH-18）／⑥ メンバーかんばん SC-17 新規（DnD = TOSS、UC-26）／⑦ oauth_identities テーブル新規。PRD v1.3、02-database v1.1、03-api v1.1、04-frontend v1.1、05-security v1.1、06-infrastructure v1.1 を同期反映。v1.1a と統合し **v1.1 として確定**。 | — |
| #131 | 2026-07-24 | **確認者付き予定・進行責任者の追加（issue #131）**。① 予定に 3 役割（実施者 executor / 承認者 approver / 進行責任者 progress_manager）を追加、projects に既定進行責任者列。② ボール状態機械を 6 値（in_progress / review_pending / approved / tossed / sent_back / completed）へ拡張、承認と TOSS を分離。③ **自動連鎖 TOSS を廃止（#117）**。④ from/to を TOSS 履歴スナップショット（FROM=進行責任者 / TO=後続実施者）へ意味変更、`ck_plans_toss_members` 撤去。⑤ 共有リンクに確認依頼/承認/差し戻しを許可（**#59 の閲覧専用を撤回**、TOSS は共有不可）。⑥ ball_events/audit_logs の許可値拡張（マイグレーション 20260724000001 / 20260724000002）。02-database・03-api・05-security を全面更新、00/01/04/06 を整合修正。 | — |
| #140 | 2026-08-22 | **Figma デザインシステム反映（第1段：基盤）**。ブランドカラーを暫定 #1F6FEB から **#E7672C（オレンジ）** に確定。配色基調を無彩色グレーから**暖色ニュートラル**へ全面差し替え、コード中に散在していたドメイン配色をセマンティックトークン化。スケジュールカードの **10 カラーテーマ**を定義し「色は状態ではなくユーザーの視覚整理の道具」という配色ポリシーを明記。フォントを **Sora（ワードマーク）+ Noto Sans JP（本文）のセルフホスト**に確定。**ダークモードは非対応**として実装を削除。04-frontend §4.9 を全面改訂。 | — |
| #141 | 2026-08-22 | **Figma デザインシステム反映（第2段：UI 部品）**。shadcn プリミティブ（button / badge / input / select / label / sheet）を Figma 実測へ更新し、ボタンに次の工程へトス用の `accent` を追加。`dropdown-menu` / `popover` / `tooltip` を新規追加。TRAKON 固有コンポーネント（WorkflowButton / StatusPill / RoleRow / ScheduleThemeSwatch）を新設し 04-frontend §4.5.1 に記載。`categoryColor.ts` を `planTheme.ts` へ移行し、カテゴリ配色を 10 テーマへ集約。 | — |
| #142 | 2026-08-23 | **Figma デザインシステム反映（第3段：アプリシェル）**。サイドバーを Figma へ全面更新し、表示部分を `AppSidebar` として切り出し。`PageHeader` に 2 段目のツールバー行スロットを追加。ワードマークを `Wordmark` コンポーネントへ集約。プロジェクト一覧のタブを URL 同期。04-frontend §4.2.2 のレイアウト構造の記述を実態に合わせて改訂。 | — |
| #143 | 2026-08-23 | **スケジュール描画の共通化（Figma 反映 第4段の準備）**。`ItemSchedulePage` からボード描画を `features/plans/schedule/` へ切り出し、フォーク複製だった `ShareSchedule` を同じ `ScheduleBoard` の閲覧専用モードへ統合。見た目は変えず、共有画面のボール保持者導出とカード座標のずれ・SVG marker id の重複を解消。 | — |

---

## 本書の位置づけ

PRD で「**何を・誰に・なぜ作るか**」が確定した内容を、**「どのように作るか」** に落とすドキュメント。実装仕様書（DB詳細設計／コンポーネント詳細／API個別仕様）の手前に位置する。

```
┌──────────────────────────────────────────┐
│  TRAKON 基本原則 v1.0（思想・判断基準の最上位）│
├──────────────────────────────────────────┤
│  TRAKON PRD v1.3（要件定義：非会員URL前倒し + プロトタイプ反映）│
├──────────────────────────────────────────┤
│  TRAKON 基本設計書 v1.1（本書）              │ ← ココ
│   - 構成・スタック・スキーマ・API・画面・運用 │
├──────────────────────────────────────────┤
│  実装仕様書 ／ コードベース                  │
└──────────────────────────────────────────┘
```

**判断が分かれた場合、上位ドキュメント（PRD → 基本原則）に立ち返る。本書は常に PRD の下位にある。**

---

## 確定済み前提（プラン承認時に決定）

| 項目 | 内容 |
|---|---|
| 対象スコープ | Phase 0（MVP）を中心に Phase 1 を見据える |
| 構成方針 | **構成B：Vercel + Supabase（RLS不使用、BE経由認可）** ／ Phase 2 で GCP 移行を選択肢に残す |
| 技術スタック | TypeScript / Vite + React SPA / Hono on Vercel Functions / Prisma / Supabase Postgres / Supabase Auth / Resend / Sentry |
| API スタイル | REST + OpenAPI スキーマ駆動 + Zod |
| 進め方 | 章ごとに「たたき台 → レビュー → 確定」を順次実施 |

---

## 章別構成（INDEX）

| 順 | ファイル | 領域 | ステータス |
|---|---|---|---|
| 0 | [00-index.md](00-index.md) | 全章のINDEX・改訂履歴・前提整理 | Draft（随時更新） |
| 1 | [01-architecture.md](01-architecture.md) | システム構成・スタック詳細・拡張戦略 | **v1.0 確定（2026-05-09）** ※v1.1 で変更なし |
| 2 | [02-database.md](02-database.md) | テーブル定義・制約・インデックス・マイグレーション | **v1.1 確定（2026-05-24）** |
| 3 | [03-api.md](03-api.md) | REST エンドポイント・OpenAPI・認可ガード・エラーモデル | **v1.1 確定（2026-05-24）** |
| 4 | [04-frontend.md](04-frontend.md) | 画面ツリー・ルーティング・状態管理・モーダル制御 | **v1.1 確定（2026-05-24）** |
| 5 | [05-security.md](05-security.md) | 認証・認可・監査・添付・XSS/CSRF・トークン管理 | **v1.1 確定（2026-05-24）** |
| 6 | [06-infrastructure.md](06-infrastructure.md) | Vercel/Supabase 構成・環境分離・CI/CD・バックアップ・監視 | **v1.1 確定（2026-05-24）** |

> ステータス凡例：未着手 / Draft（たたき台） / Review中 / **v1.x 確定** / Phase 1 拡張

---

## 章ごとの確定基準

各章は以下を満たした時点で「v1.0 確定」とする：

1. **PRD整合**：当該章スコープ内の FR/NFR/SR/UC/SC が章のいずれかで扱われている（明示的に Phase 1+ 持ち越しと判定したものは章末リスト化）
2. **Phase 接続**：Phase 0 で実装する範囲と Phase 1 で追加する範囲が章内で明確に区別されている
3. **ユーザー合意**：章中の「議論ポイント」「選択肢」が全て決着
4. **目次反映**：本ファイル（00-index.md）のINDEXとステータスが更新されている

---

## 用語

PRD §1.3 と §13.3 を参照。本書で新たに定義する用語は各章の冒頭で明示する。

### v1.1 で整理した用語（プロトタイプ反映に伴う追加・統一）

| 用語 | 採用方針 | 注意 |
|---|---|---|
| 予定 / Plan / Ball / Task | **「予定（plan）」が物理テーブル名・正規用語、「ボール」は責任の概念**として両者を併用。**「タスク」はプロトタイプ UI 用語で、設計書では「予定」に統一**（PRD v1.3 §1.3 用語集に明記） | プロトタイプの「today's task」は本設計書では「今日の予定」と読み替え |
| 制作物 / 納品物 / item / deliverable | **「制作物（project_items）」を物理／設計用語として維持**、URL も `/items/` 維持。プロトタイプの「deliverable」は画面表示文言レベルの言い換え | データモデル・API は変更なし。画面表示は「制作物」/「納品物」の選択肢があるが、Phase 0 は「制作物」で統一 |
| メンバー | プロジェクト参加者（`project_members`）の通称、横軸／カンバン列の単位 | ユーザー（`users`）とは区別（メンバーは特定プロジェクト内、ユーザーは横断アカウント） |
| カテゴリ | 予定の作業種別（`plans.category`、6 値 CHECK） | wireframe / design / coding / review / meeting / other |
| 後続紐付け | 1 つの予定（先行）に対し 1 つの後続予定を紐付ける関係（`plans.successor_plan_id`、1対1、UNIQUE） | **#131：先行の承認 → 進行責任者による TOSS で後続へボールを渡す。~~自動 TOSS~~ は #117 で廃止**（承認と TOSS は分離） |
| 役割（#131） | 予定の 3 役割：**実施者 executor**（作業/確認、実質必須）／**承認者 approver**（任意）／**進行責任者 progress_manager**（承認済みを後続へ TOSS）。1 人が複数役割を兼任可 | ballState は 6 値（in_progress / review_pending / approved / tossed / sent_back / completed） |
| Magic-link サインアップ | メール先行 → 認証リンク押下 → 詳細入力 → 自動ログインの2段階フロー | UC-01 改訂、SC-01 で 7 状態統合 |
| OAuth | Google / Microsoft の外部 ID 連携。Phase 0 から提供 | 同一メール 1 認証手段制約（FR-AUTH-12） |
| メンバーかんばん | プロジェクト参加メンバーごとの予定を状態別かんばんで表示（SC-17、`/projects/:projectId/members`） | **#131：DnD は状態機械の各操作（確認依頼 / 承認 / 差し戻し / TOSS）に対応**。SC-11 参加者管理とは別タブで併設 |

> **本書の判断**：用語の物理レイヤー（DB・API・コード）は **既存命名を維持**し、画面表示文言は柔軟に運用。プロトタイプとの命名差分は実装時の翻訳テーブル（`packages/shared/i18n/messages.ja.ts`）で吸収する。
