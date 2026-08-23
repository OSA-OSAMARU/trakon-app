# 第4章 画面・コンポーネント設計

| 項目 | 内容 |
|---|---|
| 章番号 | 04 |
| ステータス | **v1.1 確定**（v1.0: 2026-05-09 / v1.1: 2026-05-24 プロトタイプ反映） |
| 確定日 | 2026-05-24 |
| 上位ドキュメント | [TRAKON PRD v1.3](../prd/trakon-prd.md) ／ [01-architecture.md](01-architecture.md) ／ [03-api.md](03-api.md) |
| 主参照 PRD 節 | §7（SC-01〜SC-17、v1.3 で SC-09 改訂・SC-17 新規）／§4.1.1（FR-AUTH-10〜12）／§4.1.4（FR-SCH-17, 18）／§4.1.7（FR-DASH 改訂）／§4.4（UXR）／§13.1（画面遷移図）／§2.6（3層構造）／NFR-UX-01〜03、NFR-A11Y-01、NFR-MOBILE-01 |

---

## 4.1. 本章の範囲

Phase 0 必須の画面・FE コンポーネント設計を行う。スコープ：

- ルーティングとレイアウト
- 画面別仕様（SC-01, 02, 03, 04, 06, 07, 08, 10, 11）
- 共通コンポーネント（モーダル・フォーム・空状態など）
- **縦型カレンダーの描画モデル**（SC-06 の中核）
- **Ball Holder ヘッダー更新の責務配置**
- 状態管理（Zustand ストア境界、TanStack Query キー設計）
- デザインシステム（最低限のトークン）

本章で**扱わない**もの：
- ピクセルカンプ・コンポーネントカタログ（実装フェーズで Storybook 等を整備）
- アニメーションの細部（PRD NFR-UX「装飾で強さを演出しない」に従い、原則として最小）
- Phase 1 の SC-05 / 09 / 12 / 13 / 14 / 16（一部 §4.3.5 で URL のみ予約）

---

## 4.2. 設計方針

### 4.2.1. SPA ルーティング戦略

| 観点 | 方針 |
|---|---|
| **ライブラリ** | React Router v6（章1 §1.2） |
| **モード** | **Data Router**（`createBrowserRouter`）+ `loader` / `action` は使わず、TanStack Query に集約 |
| **コード分割** | ルートごとに `lazy()` で遅延ロード（NFR-PERF-01「2秒以内」素地） |
| **URL 設計** | **API のリソース階層に揃える**（章3 §3.2.1 と同方針）。例：`/projects/:projectId/items/:itemId` |
| **404** | 未マッチ・存在しないリソースは共通 404 ページ（NotFoundPage）に集約 |
| **認証ガード** | ルートレベルで `<RequireAuth>` でラップ。未認証は `/login?next=<元URL>` へリダイレクト |

### 4.2.2. レイアウト構造

```
┌──────────────┬─────────────────────────────┐
│ ① サイドバー  │ ② ページヘッダー（ページ固有）│
│  （全ページ）  │   - パンくず／タイトル／期間  │
│  - ワードマーク │   - 検索・通知・主要アクション │
│  - ダッシュボード├─────────────────────────────┤
│  - プロジェクト │   - ツールバー行（任意）      │
│  - ヘルプ／法務 ├─────────────────────────────┤
│  - ユーザー情報 │ ③ メインコンテンツ           │
│              │   - 縦型カレンダー／リスト／  │
│              │     フォーム                 │
└──────────────┴─────────────────────────────┘
④ モーダル／トースト（オーバーレイ）
```

| 層 | 役割 | 実装 |
|---|---|---|
| ① サイドバー | 全ページ共通のナビゲーションとユーザー情報。幅 224px | `components/layout/AppSidebar`（表示）＋ `app/SidebarLayout`（配線） |
| ② ページヘッダー | コンテキスト固有（パンくず・タイトル・期間・アクション）。`toolbar` に 2 段目の操作行を差し込める | `components/layout/PageHeader` |
| ③ メインコンテンツ | 画面の中身 | 各ページ |
| ④ オーバーレイ | モーダル・トースト | Portal で `<body>` 直下 |

> v1.1 までの「上部グローバルヘッダー + コンテンツヘッダー」の 2 段構成は、実装・Figma とも**左サイドバー + ページヘッダー**であるため記述を実態に合わせた。

### 4.2.3. 状態管理レイヤの責務分離

| 状態の種類 | 担い手 | 例 |
|---|---|---|
| **サーバ状態** | TanStack Query | プロジェクト一覧、参加者一覧、プラン一覧、ボール詳細 |
| **クライアント UI 状態（永続性なし）** | Zustand | モーダル開閉、選択中ボール ID、サイドバー開閉 |
| **URL 状態** | React Router | 現在のプロジェクト ID、フィルタ、ページング |
| **フォーム入力中の状態** | React Hook Form | 個別フォームの入力値・タッチ・エラー |
| **ユーザー設定（永続性あり）** | localStorage 経由 Zustand | 表示設定（Phase 1〜） |

> **大原則**：サーバから取れるものを Zustand に置かない。Zustand は「画面表示するためにブラウザ内で完結する状態」のみ。

### 4.2.4. モーダル制御（URL 同期方式）

| 観点 | 方針 |
|---|---|
| **管理方法** | **URL クエリパラメータで状態管理**。React Router の `useSearchParams` で読み書き |
| **URL 規約** | `?modal=<name>&<key>=<value>` の形式。例：`?modal=create-plan&date=2026-05-15`、`?modal=ball-detail&planId=01J...` |
| **モーダル名（Phase 0）** | `create-plan` / `ball-detail` / `confirm-delete-plan` / `confirm-delete-item` / `confirm-discard-form` |
| **カスタムフック** | `useModal()` を提供：`openModal(name, params)` → `setSearchParams`、`closeModal()` → modal 系 params を削除、`currentModal` で現状取得 |
| **コンポーネント** | shadcn/ui の `<Dialog>`（Radix UI ベース）で A11Y 確保 |
| **重ね表示** | 原則1モーダルのみ。確認系（`confirm-*`）は `<AlertDialog>` で別管理し、メインモーダルの上にオーバーレイ可 |
| **ブラウザ戻る** | URL に同期しているため、戻るボタンで自動的にモーダルが閉じる |
| **ディープリンク** | `?modal=ball-detail&planId=xxx` で直接該当ボールを開ける（Phase 1 のメール通知から直リンク等の素地） |
| **閉じる** | ESC キー／オーバーレイクリック／明示的な「閉じる」ボタン → 全て `closeModal()`（URL から modal 系 params を削除）。データ未保存時は確認ダイアログ（PRD FR-SCH-09 と整合：Draft 状態を持たない） |
| **history 戦略** | モーダル open は `replace: true`（URL 履歴を増やさない）／close は同様に replace。連続的にモーダルを開閉しても戻るボタン履歴を汚染しない |

### 4.2.5. データ取得とキャッシュ無効化

| 観点 | 方針 |
|---|---|
| **取得** | TanStack Query の `useQuery` で各画面のデータ取得 |
| **クエリキー** | API パスと一致させる（§4.8.2）。例：`['projects', projectId, 'items', itemId, 'plans']` |
| **キャッシュ無効化** | mutation 後に `queryClient.invalidateQueries` で関連キーを無効化 |
| **楽観更新** | TOSS / 完了 などの状態遷移は `setQueryData` で即時 UI 反映 → API 完了後に `invalidate` で確定（§4.7） |
| **再取得タイミング** | フォーカス復帰時（`refetchOnWindowFocus: true`、デフォルト）／ボール操作後の即時無効化 |

### 4.2.6. エラー・ローディング・空状態

PRD §4.4 UXR-05「煽らず・濁さず・逃げない言葉遣い」を全画面に適用。

| 状態 | 表示方針 | 文言例 |
|---|---|---|
| **ローディング** | スケルトン（コンテンツ形状を保持）。Spinner は最小限 | — |
| **エラー** | エラーカード（エラー種別ごとに簡潔な日本語）。リトライボタン | 「読み込みに失敗しました。もう一度お試しください。」 |
| **空状態** | アイコン＋簡潔な説明＋次の一手の CTA | SC-06 空：「日付セルをクリックして予定を作成」 |
| **未認可（403）** | 専用ページ（リダイレクトしない） | 「この操作の権限がありません。」 |
| **見つからない（404）** | 専用ページ＋「プロジェクト一覧に戻る」 | 「指定されたページが見つかりませんでした。」 |
| **トースト** | 成功・警告のみ。エラーは画面内表示を優先 | 「TOSSしました」「保存しました」 |

文言は `packages/shared/i18n/messages.ja.ts` に集約（Phase 0 から国際化レイヤを噛ませる：将来の英語化負担を最小化）。

### 4.2.7. フォーム

| 観点 | 方針 |
|---|---|
| **ライブラリ** | **React Hook Form + Zod（zodResolver）** |
| **スキーマ共有** | API リクエストの Zod スキーマ（`packages/shared/schemas`）を **そのままフォーム検証に流用** |
| **エラー表示** | フィールド直下にインライン表示。フォーム全体エラーは上部にバナー |
| **送信中** | submit ボタンを disabled、ローディング表記 |
| **二重送信防止** | mutation の `isPending` で抑止 |

### 4.2.8. アクセシビリティ（NFR-A11Y-01：WCAG 2.1 AA 目標）

| 項目 | 方針 |
|---|---|
| キーボード操作 | shadcn/ui（Radix UI ベース）の標準対応に乗る。フォーカストラップ・矢印キー操作・Tab 順序を維持 |
| コントラスト | デザイントークンの段階で 4.5:1 以上を確保（§4.9） |
| ラベル | フォーム要素は必ず `<label>` 紐付け。アイコンボタンは `aria-label` |
| ライブリージョン | TOSS 実行成功などは `aria-live="polite"` で読み上げ |
| 言語属性 | `<html lang="ja">` |

### 4.2.9. レスポンシブ（NFR-MOBILE-01）

| 画面幅 | 方針 |
|---|---|
| **デスクトップ ≥1024px** | フル機能（縦型カレンダー含む） |
| **タブレット 768〜1023px** | フル機能だがカラム数を縮小、フォントサイズ調整 |
| **モバイル <768px** | **Phase 0 では一覧系（SC-03）と SC-08 ボール詳細のみ最適化**。SC-06 縦型カレンダーは横スクロール許容 |
| Phase 1 | ダッシュボード（SC-09）のモバイル最適化を優先（NFR-MOBILE-01） |

---

## 4.3. ルーティングと画面ツリー

### 4.3.1. URL 構造（Phase 0、v1.1 更新）

| URL | 画面 | 認証 | コンポーネント |
|---|---|:---:|---|
| `/login` | SC-01 ログイン（**7 状態統合：login / signup / email-sent / create-account / password-reset-*** ） | ❌ | `LoginPage` |
| `/invitations/:token` | SC-02 招待受諾 | ❌ | `InvitationAcceptPage` |
| `/share/:token` **(v1.1 非会員URL前倒し)** | 非会員URL閲覧（プロジェクト／制作物／ボール スコープ） | ❌ | `GuestSharePage` |
| `/auth/oauth/:provider/callback` **(v1.1 プロトタイプ反映)** | OAuth コールバック | ❌ | `OAuthCallbackPage`（最小、`POST /auth/oauth/:provider/callback` → `/auth/me/sync` → ダッシュボード遷移） |
| `/` | ルート（→ **`/dashboard`** にリダイレクト、v1.1 で変更） | ✅ | — |
| **`/dashboard`** **(v1.1 Phase 0 必須)** | **SC-09 ダッシュボード（階層ビュー、ログイン直後の起点）** | ✅ | **`DashboardPage`** |
| `/projects` | SC-03 プロジェクト一覧 | ✅ | `ProjectListPage` |
| `/projects/new` | SC-04 プロジェクト新規作成 | ✅ | `ProjectNewPage` |
| `/projects/:projectId` | プロジェクト直下、最初の制作物にリダイレクト | ✅ | `ProjectShellPage` |
| `/projects/:projectId/items/:itemId` | SC-06 各制作物画面（縦型スケジュール） | ✅ | `ItemSchedulePage` |
| `/projects/:projectId/edit` | SC-10 プロジェクト編集 | ✅ | `ProjectEditPage` |
| **`/projects/:projectId/members`** **(v1.1 役割変更)** | **SC-17 メンバーかんばん（既定）／SC-11 参加者管理（タブで切替）** | ✅ | **`MemberKanbanPage`**（タブで `ProjectMembersManagePage` に切替） |
| `/projects/:projectId/members?tab=manage` **(v1.1)** | SC-11 参加者管理 | ✅ | `ProjectMembersManagePage` |
| `/projects/:projectId/share-links` **(v1.1 非会員URL前倒し)** | SC-16 非会員URL 発行・管理 | ✅ | `ShareLinkAdminPage`（ディレクターのみ） |
| `/account` | アカウント基本情報 | ✅ | `AccountPage`（最小） |
| `*` | 404 | — | `NotFoundPage` |

> Phase 1 で予約：ダッシュボードの「進行判定フィルター」タブ（FR-DASH-08）。
>
> **v1.1 ルーティング方針変更点（プロトタイプ反映）**：① SC-01 ログイン関連 7 状態を **`/login` に統合**（プロトタイプ仕様、`useSearchParams` で screen 切替）／② `/dashboard` を **Phase 0 必須化** し、`/` リダイレクト先を変更／③ `/projects/:projectId/members` の既定タブを **メンバーかんばん（SC-17）** に変更、SC-11 参加者管理は `?tab=manage` で切替。
>
> **v1.1 ルーティング方針変更点（非会員URL前倒し）**：④ `/share/:token` を Phase 0 公開ルートに追加／⑤ `/projects/:projectId/share-links` を Phase 0 ディレクター画面として追加。

### 4.3.2. ルートツリー（v1.1 更新）

```
RootLayout（グローバルヘッダー）
├── 公開ルート
│   ├── /login → LoginPage（7 状態統合：useSearchParams で切替）
│   ├── /invitations/:token → InvitationAcceptPage
│   ├── /share/:token → GuestSharePage（非会員URL閲覧／FR-SHARE、Phase 0）
│   └── /auth/oauth/:provider/callback → OAuthCallbackPage（v1.1 プロトタイプ反映）
├── 認証必須ルート（<RequireAuth>）
│   ├── / → Navigate to /dashboard
│   ├── /dashboard → SidebarLayout + DashboardPage（v1.1 Phase 0 必須）
│   ├── /projects → ProjectListPage
│   ├── /projects/new → ProjectNewPage
│   ├── /projects/:projectId
│   │   ├── ProjectLayout（プロジェクトヘッダー＋ナビ）
│   │   ├── index → ProjectShellPage（最初の item へ Navigate）
│   │   ├── /items/:itemId → ItemSchedulePage（SC-06）
│   │   ├── /edit → ProjectEditPage（SC-10）
│   │   ├── /members → MemberKanbanPage（SC-17 既定）or ProjectMembersManagePage（?tab=manage、SC-11）
│   │   └── /share-links → ShareLinkAdminPage（SC-16、ディレクターのみ、v1.1 非会員URL前倒し）
│   └── /account → AccountPage
└── * → NotFoundPage
```

### 4.3.3. 画面遷移図（Phase 0、v1.1 更新）

```mermaid
flowchart LR
    Login[SC-01 ログイン<br/>7状態統合] --> Dashboard[SC-09 ダッシュボード<br/>v1.1 Phase 0]
    Login -. OAuth .-> OAuthCb[/auth/oauth/:p/callback] --> Dashboard
    Invitation[SC-02 招待受諾] -. 受諾 .-> Dashboard
    Dashboard --> ItemSchedule[SC-06 制作物画面]
    Dashboard --> ProjectList[SC-03 プロジェクト一覧]
    ProjectList --> ProjectNew[SC-04 プロジェクト新規作成]
    ProjectList --> ItemSchedule
    ProjectNew --> ItemSchedule
    ItemSchedule --> PlanCreate[SC-07 予定作成モーダル<br/>カテゴリ+次の予定]
    ItemSchedule --> BallDetail[SC-08 ボール詳細モーダル]
    ItemSchedule --> ProjectEdit[SC-10 プロジェクト編集]
    ItemSchedule --> MemberKanban[SC-17 メンバーかんばん<br/>v1.1 新規]
    ProjectEdit --> Members[SC-11 参加者管理<br/>?tab=manage]
    MemberKanban -. タブ切替 .-> Members
    ProjectEdit --> ShareAdmin[SC-16 非会員URL 発行・管理<br/>v1.1 Phase 0 前倒し]
    ShareAdmin -.発行.-> GuestEntry[非会員URL]
    GuestEntry --> GuestShare[GuestSharePage<br/>非会員URL閲覧]
    GuestShare -. 確認依頼／承認／差し戻し（#131・TOSS不可） .-> GuestShare
    BallDetail -. 確認依頼／承認／差し戻し／TOSS（#131） .-> ItemSchedule
    MemberKanban -. DnD=状態機械操作（#131） .-> MemberKanban
```

---

## 4.4. 画面別仕様

> 各画面は次の節構成：**目的／URL／表示項目／状態（ローディング・エラー・空・成功）／API 呼び出し／インタラクション／エッジケース**。

### 4.4.1. SC-01 ログイン（`/login`、v1.1 改訂：Magic-link + OAuth、7 状態統合）

**目的**：既存ユーザーのログイン／新規サインアップ／パスワード再発行／OAuth サインイン（FR-AUTH-01, 10, 11, 12）。

**画面状態（7 ステップ統合、`useSearchParams` で screen を切替）**：
`login` / `signup` / `email-sent` / `create-account` / `password-reset-request` / `password-reset-email-sent` / `password-reset` / `password-reset-complete`

#### `login` 画面の表示項目

- メールアドレス（Email、必須）
- パスワード（Password、必須）
- 「ログイン状態を保存する」チェックボックス
- 「ログイン →」ボタン
- 「パスワードをお忘れですか？」リンク → `screen=password-reset-request`
- **「または」区切り線下に：「Google で続ける」「Microsoft で続ける」ボタン**（v1.1、FR-AUTH-10）
- 「アカウントをお持ちでない方は新規登録」リンク → `screen=signup`

#### `signup` 画面（Magic-link 開始）

- メールアドレスのみ入力 → 「はじめる →」
- **OAuth ボタン（Google / Microsoft）**
- 利用規約・プライバシー同意文言（明示の同意チェックボックスなし、ボタン押下で同意とみなす）

#### `email-sent` 画面

- メール送信完了表示
- 再送ボタン（60 秒カウントダウン）
- （開発用：直接 `screen=create-account` に進めるデバッグボタン）

#### `create-account` 画面（メール認証リンク押下後）

- メールアドレス（読取専用）
- **お名前（full_name）**（必須、1〜100文字、v1.1、FR-AUTH-11）
- **ユーザー名／表示名（display_name）**（必須、1〜50文字、v1.1、FR-AUTH-11）
- パスワード（必須、8文字以上）
- パスワード（確認、必須）
- 「プロジェクト作成 →」ボタン

#### `password-reset-*` 画面群

- パスワード再発行フロー（4 状態：request / email-sent / new-password / complete）

#### 処理フロー

**login（メール+パスワード）**：
1. submit → Supabase Auth `signInWithPassword`
2. 成功 → `POST /api/v1/auth/me/sync` → `next` クエリ or `/dashboard` へ
3. 失敗 → 同一文言エラー（メール／パスワード違い区別なし）

**signup（Magic-link）**：
1. メール入力 → Supabase Auth `signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: APP_URL/login } })`
2. `screen=email-sent` へ
3. ユーザーがメールリンク押下 → `/login?token=...&type=signup` で戻る
4. `verifyOtp(token)` → セッション確立 → `screen=create-account` へ
5. 詳細入力 → `POST /api/v1/auth/me/complete-signup { fullName, displayName, password }` → `/dashboard` へ

**OAuth**：
1. 「Google で続ける」押下 → `POST /api/v1/auth/oauth/google/start` → returned `authorizeUrl` へ遷移
2. プロバイダ同意 → `/auth/oauth/google/callback?code=...&state=...` に戻る
3. FE が `POST /api/v1/auth/oauth/google/callback` → セッション確立
4. `POST /api/v1/auth/me/sync` → users 行作成（同一メール別 provider なら 409 SAME_EMAIL_DIFFERENT_PROVIDER 表示）
5. **requiresProfileCompletion = true なら** `screen=create-account` で display_name 設定（OAuth から full_name は取得済み）→ `/dashboard` へ

#### エッジケース

- メール未認証：「メール認証が完了していません。」+ 再送ボタン
- ロックアウト（PRD SR-AUTH-04）：詳細は章5
- **同一メール別認証手段**（v1.1）：「このメールアドレスは Google 認証で登録済みです。Google で続けてください。」と本来の認証手段を案内

---

### 4.4.2. SC-02 招待受諾（`/invitations/:token`）

**目的**：招待リンク経由でプロジェクトに参加（FR-AUTH-02、UC-03）。

**表示項目**：
- 招待内容：プロジェクト名、招待者（メンバー名・所属名）、自分のロール（Phase 1〜）
- 状態に応じた CTA：
  - **未認証**：「サインインして受諾」「アカウント作成して受諾」
  - **認証済み**：「受諾」ボタン
  - **期限切れ／受諾済／失効済**：エラー表示（404 と区別なし、§4.2.6）

**API**：
- 初期表示：`GET /api/v1/invitations/:token`
- 受諾：`POST /api/v1/invitations/:token/accept`（要 JWT）

**処理フロー**：
1. ページロード → トークン検証
2. 認証済み → 「受諾」ボタンで `POST /api/v1/invitations/:token/accept` → 成功時 `/projects/:projectId/items/:firstItemId` へ
3. 未認証 → サインアップ／サインインに `?next=/invitations/:token` を付けて遷移、ログイン後に戻ってきて受諾

---

### 4.4.3. SC-03 プロジェクト一覧（`/projects`）

**目的**：自分が参加するプロジェクトの俯瞰（FR-PRJ-02）。

**表示項目**：
- ヘッダー：「プロジェクト」、右上に「+ 新規作成」ボタン（全ユーザー、Phase 0）
- カードまたはテーブル形式で：
  - プロジェクト名／期間（YYYY/MM/DD〜YYYY/MM/DD）／自分のロール／最終更新
  - クリックで `/projects/:projectId` へ
- 並び順：`updated_at:desc`（既定）
- フィルタ（Phase 0 はなし、Phase 1 でアーカイブタブ追加）

**API**：`GET /api/v1/projects?limit=50&sort=updated_at:desc`

**空状態**：
- 「まだプロジェクトがありません」+「最初のプロジェクトを作成」ボタン

**ページング**：50件超で「もっと見る」ボタン（Phase 0）。

---

### 4.4.4. SC-04 プロジェクト新規作成（`/projects/new`）

**目的**：プロジェクト・制作物・参加者の一括登録（UC-02、FR-PRJ-01）。

**表示項目（PRD §7 SC-04）**：

| セクション | 項目 |
|---|---|
| プロジェクト基本情報 | 名称（1〜255）／開始日／終了日（startDate 以降） |
| 制作物 | 繰返（最低1件、最大不問）。各：名称、並び順 |
| 参加者 | 繰返（最大10名、初期3行）。各：名前／所属名／メール／種別（client / production） |

**フォーム実装**：
- React Hook Form + Zod（`useFieldArray` で繰返セクション管理）
- 「+ 制作物を追加」「+ 参加者を追加」ボタン
- 行削除ボタン（最後の1行は削除不可）
- 「未入力行は無効扱い」（PRD UC-02）：参加者の name/email 両方空の行は送信時に除外

**バリデーション**：
- name: 1〜255 文字
- endDate >= startDate
- items 1件以上必須
- members の email 重複チェック（フォーム内）
- 参加者の所属名未入力（無効扱い）→ name もしくは email が入っている行は organizationName 必須

**API**：`POST /api/v1/projects`

**送信中・成功・失敗**：
- 送信中：「保存中…」（disabled）
- 成功：作成された projectId / firstItemId を取得 → `/projects/:projectId/items/:firstItemId` へ遷移、トースト「プロジェクトを作成しました。招待メールを送信しました。」
- 失敗：エラーカード（メール送信失敗時はメッセージで言及）

**画面遷移**：
- キャンセル → 確認ダイアログ → `/projects`

---

### 4.4.5. SC-06 各制作物画面（縦型スケジュール）（`/projects/:projectId/items/:itemId`）

**目的**：単一制作物での予定・ボール操作（UC-05, UC-08, UC-12, UC-15）。**Phase 0 の中核画面**。

#### 4.4.5.1 画面構造

```
┌──────────────────────────────────────────────────┐
│ プロジェクトヘッダー（パンくず＋プロジェクト名＋期間） │
│ Ball Holder バッジ：「<所属名> <表示名>」← 常時表示     │
├────────────┬─────────────────────────────────────┤
│ 制作物リスト │ 制作物ヘッダー（名前＋編集／削除）       │
│ サイドバー  │ Ball Holder バッジ（制作物単位）         │
│ ・Item A    ├─────────────────────────────────────┤
│ ・Item B ◀│ 縦型スケジュール（§4.6）                │
│ ・Item C    │ ┌──┬──┬──┬──┐                        │
│             │ │日付│PA│PB│PC│ ← 横軸：参加者列        │
│             │ ├──┼──┼──┼──┤                        │
│             │ │5/1│  │● │  │ ← ボールチップ          │
│             │ │5/2│  │  │  │                        │
│             │ │…  │  │  │  │                        │
│             │ └──┴──┴──┴──┘                        │
└────────────┴─────────────────────────────────────┘
```

#### 4.4.5.2 主要コンポーネント

実装は `apps/web/src/features/plans/schedule/` に置き、**認証済み画面（`ItemSchedulePage`）と共有リンク画面（`ShareSchedule`）で同じ描画を共有**する。`ScheduleBoard` に `editing` を渡すと編集モード、渡さなければ閲覧専用になる。

| コンポーネント | 責務 | 主な props |
|---|---|---|
| `ScheduleBoard` | 縦型カレンダー本体（§4.6）。ドラッグ移動・期間リサイズ・後続紐づけ・チェーン強調を持つ | days, items, plansByItem, rowHeight, editing?, onSelectPlan? |
| `DateAxis` | 縦軸（日付・曜日・週末/祝日/本日の色分け） | days, dayTones, rowHeight |
| `ColumnHeader` | 制作物列のヘッダー（名前・件数・現在のボール保持者） | itemId, name, planCount, holders |
| `BallChip` | ボールチップ。`mode='edit' \| 'view'` で操作可否を切り替える | plan, days, rowHeight, lane, mode, … |
| `LinkLayer` | 列内の後続コネクトを描く SVG オーバーレイ | plans, laneOf, days, rowHeight |
| `ZoomControl` | 行高（＝縦横ズーム）を変える浮遊コントロール | rowHeight, onChange |
| `chain.ts` | 後続チェーンの探索・紐づけ可否判定・保持者解決（純粋関数） | — |

> 横軸は**参加者列ではなく制作物列**（実装・Figma とも）。v1.1 までの「横軸＝参加者列」の記述は実態と乖離していたため、この節の図と併せて後続フェーズで整理する。

#### 4.4.5.3 表示項目

- **プロジェクトヘッダー**：プロジェクト名、期間、編集ボタン（ディレクターのみ）
- **Ball Holder バッジ**（制作物単位、PRD FR-BALL-03）：
  - 形式：「<所属名> <表示名>」
  - **代表ボールの選定はアプリ側ロジック**（Phase 1 で正規化、Phase 0 は当該制作物の最新 active プラン）
- **縦軸**：プロジェクト期間内の日付（FR-SCH-01）
  - 月切替に区切り線（FR-SCH-11）
  - 本日を強調表示（FR-SCH-05）
  - 土日・祝日に背景色（FR-SCH-03、FR-SCH-04）
- **横軸**：参加者列（FR-SCH-02）
  - クライアント／制作チームでグルーピング
  - 各列に所属名＋表示名
- **ボールチップ**：
  - **FROM列とTO列を跨ぐ表現**で TOSS 方向を可視化（PRD SC-06「構造で意味を伝える」）
  - 現在の Ball Holder 側にバッジ装飾
  - クリックで SC-08（ボール詳細モーダル）

#### 4.4.5.4 データ取得

```typescript
useQuery(['projects', projectId], fetchProject)
useQuery(['projects', projectId, 'items'], fetchItems)
useQuery(['projects', projectId, 'items', itemId], fetchItem)
useQuery(['projects', projectId, 'members'], fetchMembers)
useQuery(['projects', projectId, 'items', itemId, 'plans'], fetchPlans)
```

> 4 クエリ並列取得。詳細は §4.8.2 のクエリキー設計で。

#### 4.4.5.5 インタラクション

| 操作 | 結果 |
|---|---|
| 日付セルクリック | SC-07 予定作成モーダルを開く（`useModalStore`） |
| ボールチップクリック | SC-08 ボール詳細モーダルを開く |
| 制作物リストクリック | `navigate('/projects/:projectId/items/:itemId')` |
| プロジェクト編集ボタン | `navigate('/projects/:projectId/edit')` |

#### 4.4.5.6 空状態

予定0件時：縦型カレンダー上に「日付セルをクリックして予定を作成」のオーバーレイガイド（PRD SC-06）。

---

### 4.4.6. SC-07 予定作成モーダル

**目的**：TOSS予定の作成（Phase 0、UC-05、FR-SCH-06〜09）。

**起動**：SC-06 の日付セルクリックで開く。`openModal('create-plan', { date: 'YYYY-MM-DD' })` → URL が `?modal=create-plan&date=2026-05-15` に更新される。

**表示項目（Phase 0、TOSS のみ、v1.1 でカテゴリ・後続追加）**：

| 項目 | 型 | 必須 | 補足 |
|---|---|:---:|---|
| 予定種別 | Radio | × | Phase 0 は「TOSS予定」固定表示・選択不要（Phase 1 で3種選択） |
| 予定名 | Text | ✅ | 1〜255 文字 |
| **カテゴリ** | **Select** | **✅** | **6種固定（wireframe / design / coding / review / meeting / other、v1.1、FR-SCH-18）** |
| **実施者（executor）** | **Select** | **✅** | **#131：作業/確認を行う。プロジェクト参加メンバーから** |
| **承認者（approver）** | **Select** | **×** | **#131：任意。実施者の成果を承認する。空欄なら実施者が直接承認** |
| **進行責任者（progress_manager）** | **Select** | **×** | **#131：承認済みを後続へ TOSS する。未指定ならプロジェクト既定（`projects.progress_manager_member_id`）を採用** |
| 開始日（旧 予定日） | Date | ✅ | 起動時の日付がプリセット（プロトタイプに合わせ「開始日」表記） |
| 終了日 | Date | ✅ | 開始日以降。プロトタイプでは必須扱い |
| **次の予定** | **Select** | **×** | **任意。同制作物の他予定から選択、`successor_plan_id` に設定（v1.1、FR-SCH-17）**。空欄なら紐付けなし。説明文「承認後、進行責任者が TOSS すると次の予定へボールが渡ります」（**#131：~~自動開始~~ ではなく明示 TOSS**） |
| メモ | Textarea | × | 任意（プロトタイプには未実装、Phase 0 で追加検討） |

**フォーム実装**：
- React Hook Form + Zod（`packages/shared/schemas/plans.ts` を流用）
- **#131：役割は任意項目で 1 人が複数役割を兼任可（FROM≠TO のような相違チェックは無い）**

**API**：`POST /api/v1/projects/:projectId/items/:itemId/plans`

**送信成功**：
- モーダルを閉じる
- TanStack Query `['projects', projectId, 'items', itemId, 'plans']` を invalidate
- トースト「予定を作成しました」

**送信失敗**：モーダル内にエラーバナー。

**閉じる**：
- 入力途中（dirty）の場合、確認ダイアログ「変更を破棄しますか？」
- そうでなければ即座に閉じる

---

### 4.4.7. SC-08 ボール詳細モーダル

> **v1.2（#145）**：Figma node 37:2 に合わせ、幅 480px の右ドロワーを **概要 / 履歴 の 2 タブ**構成に改訂した。主要操作（ボールを渡す／戻す／承認／次の工程へトス）はフッターの `WorkflowButton` に最大 2 つまで出し、取り消し系・前工程への差し戻し・削除はヘッダーの「⋯」メニューへ寄せる。状態機械と役割別の操作可否そのものは #131 から変更していない。

**目的**：ボールの内容確認と状態機械操作（確認依頼・承認・差し戻し・TOSS、#131、UC-08, UC-10, UC-12）。

**起動**：SC-06 のボールチップクリック。`openModal('ball-detail', { planId })` → URL が `?modal=ball-detail&planId=01J...` に更新される。**この URL を共有すれば直接該当ボールが開く**（Phase 1 でメール通知からの直リンクに活用）。

**表示項目**：

| セクション | 内容 |
|---|---|
| ヘッダー | 予定名／予定日／期日 |
| Ball Holder | `BallHolderBadge`：現在のホルダー（ballState に応じたロール） |
| 関係者 | **#131：実施者 / 承認者 / 進行責任者（所属名＋表示名）。TOSS 済なら FROM/TO 履歴も表示** |
| メモ | 予定のメモ |
| 履歴 | `ball_events` の時系列表示（確認依頼／承認／差し戻し／TOSS 等。共有由来は匿名表示） |

**状態別ボタン出し分け**（#131 状態機械。現ホルダー or ディレクターに操作ボタンを出す）：

| ballState（保持者） | 表示ボタン |
|---|---|
| `in_progress` / `sent_back`（実施者） | 閉じる / 編集 / **確認依頼**（承認者あり）または **承認**（承認者なし＝実施者が直接承認） |
| `review_pending`（承認者） | 閉じる / **承認** / **差し戻し** / 確認依頼を取り消す |
| `approved`（進行責任者） | 閉じる / **TOSS する**（後続あり）／承認を取り消す。後続なしは承認時点で完了 |
| `tossed`（後続実施者） | 閉じる / 履歴を見る / **TOSS を取り消す**（誤TOSS救済 #50） |
| `completed` | 閉じる / 履歴を見る |

> **#131**：状態機械（確認依頼 → 承認 → TOSS、差し戻し、各取消）を Phase 0 で実装済み。承認と TOSS は分離され、~~完了時の自動連鎖 TOSS~~ は #117 で廃止。「完了する」は承認（approve）に対応（後方互換で `complete` エイリアスあり）。

**操作フロー（共通）**：各ボタンは対応する Ball Action API（§3.6.8）を呼ぶ。TOSS は PRD SC-08 の「確認ダイアログ挟まず、TOSS中…→相手にTOSSしました→自動クローズ」体験を踏襲し、`setQueryData` で楽観更新（§4.7）。差し戻しは理由入力（note）を伴う。

**API**：
- 詳細：`GET /api/v1/projects/:projectId/items/:itemId/plans/:planId`
- 確認依頼：`POST .../request-review`（取消 `.../request-review-undo`）
- 承認：`POST .../approve`（取消 `.../approve-undo`。`.../complete` は後方互換エイリアス）
- 差し戻し：`POST .../send-back { note? }`
- TOSS：`POST .../toss`（取消 `.../toss-undo`）
- 編集：`PATCH .../`（編集モード時、別フォーム。役割は ball の進み具合でロック §3.6.7）
- 削除：`DELETE .../`（#131：ディレクターのみ・ball_events 無しのみ物理削除）

**A11Y**：
- TOSS 成功時に `aria-live="polite"` でメッセージ読み上げ
- ボタン状態変化時に focus を維持

---

### 4.4.8. SC-10 プロジェクト編集（`/projects/:projectId/edit`）

**目的**：プロジェクト基本情報の編集（PRD FR-PRJ-03）。

**表示項目**：
- 名称／開始日／終了日（PATCH）
- 制作物の追加・編集・削除（リンク or インライン管理）
- 参加者管理は別タブ／別画面（→ `/projects/:projectId/members`）への動線

**API**：
- 取得：`GET /api/v1/projects/:projectId`
- 更新：`PATCH /api/v1/projects/:projectId`（warnings 対応）
- 制作物追加：`POST /api/v1/projects/:projectId/items`
- 制作物編集：`PATCH /api/v1/projects/:projectId/items/:itemId`
- 制作物削除：`DELETE /api/v1/projects/:projectId/items/:itemId`（409 時は `?force=true` で再送）

**警告表示**：
- 期間変更で warnings に `PLANS_OUT_OF_RANGE` が含まれる場合、保存後にダイアログ表示「○件の予定が期間外になりました。確認してください。」+ 該当 plan へのリンク

---

### 4.4.9. SC-11 参加者管理（`/projects/:projectId/members?tab=manage`、v1.1：SC-17 と URL を共有しタブ分離）

**目的**：参加者の追加／編集／削除（FR-AUTH-07〜09）。

**URL**：`/projects/:projectId/members?tab=manage`（SC-17 メンバーかんばんと同 URL、タブで切替）

**表示項目（PRD SC-11）**：
- 上部タブ：「**メンバー**」（既定、SC-17 メンバーかんばん）／「**管理**」（SC-11 本画面）
- テーブル：名前／所属名／メール／種別（client/production）／sortOrder／受諾状態（accepted/pending/expired）／操作
- ソートハンドルで `sortOrder` 変更（ドラッグ＆ドロップ、Phase 0）
- 「+ 参加者を追加」ボタン → モーダル

**API**：
- 一覧：`GET /api/v1/projects/:projectId/members`
- 追加：`POST /api/v1/projects/:projectId/members`
- 編集：`PATCH /api/v1/projects/:projectId/members/:memberId`
- 削除：`DELETE /api/v1/projects/:projectId/members/:memberId`（409 = アクティブボールあり時はエラー表示）

---

### 4.4.10. SC-09 ダッシュボード（`/dashboard`、v1.1 改訂：階層ビュー、Phase 0 必須）

> **v1.2（#146）**：Figma node 57:2 に合わせ、プロジェクト×メンバーの階層リストから**「次に必要な行動」で並べる 4 列のボード**へ改訂した。列の導出は `packages/shared/src/domain/ballBoard.ts` の `ballBoardColumnOf()` に置き FE/BE で共有する。
>
> | 列 | ボール状態 | 意味 |
> |---|---|---|
> | 作業中 | `in_progress` | 実施者が作業中 |
> | 返答待ち | `review_pending` | 承認者の返答待ち |
> | RETURN対応 | `sent_back` | 差し戻された。実施者が対応する必要がある |
> | 次の工程TOSS待ち | `approved` | 承認済み。進行責任者が TOSS するのを待っている |
>
> `tossed` と `completed` はボードに出さない。`tossed` はボールが後続予定の実施者へ渡った状態で、その**後続予定自体が別のカードとして出るため二重計上**になる。
>
> 「要対応のみ」トグルは**自分が保持しているボール**だけに絞る。この判定のため `DashboardMemberSectionDTO.member.isMe` を、カードの進行責任者表示のため `DashboardTaskDTO.progressManager` を API に追加した。

**目的**：ログイン直後の起点画面として、自分が見られる全プロジェクトの「今日のタスク」を俯瞰（FR-DASH-01〜09、UC-13）。

**URL**：`/dashboard`

**画面構成**：

```
┌────────────────────────────────────────────────┐
│ ダッシュボード（今日 yyyy/m/d）                  │
├────────────┬────────────────────────────────┤
│ 今日のタスク │ 期限超過                       │
│   42        │   3                             │
├────────────┴────────────────────────────────┤
│ 🔵 ECサイトリニューアル (12件)                  │
│   👤 田中 太郎 (3件)                           │
│     [予定カード wireframe] [予定カード design]  │
│   👤 佐藤 花子 (5件)                           │
│     [予定カード design]    [予定カード review] │
│ 🟢 コーポレートサイト制作 (5件)                 │
│   ...                                          │
└────────────────────────────────────────────────┘
```

**主要コンポーネント**：

| コンポーネント | 責務 |
|---|---|
| `DashboardSummaryCards` | 上部 2 サマリーカード（今日のタスク数 / 期限超過数） |
| `DashboardProjectGroup` | プロジェクトドット + 名前 + ヘッダー、配下メンバーセクション |
| `DashboardMemberSection` | メンバーアバター + 名前 + 配下予定カードグリッド |
| `DashboardTaskCard` | 予定カード（カテゴリ色、期限超過時赤系）。クリックで SC-06 へ遷移 |

**表示項目**：

| セクション | 内容 |
|---|---|
| ヘッダー | 「ダッシュボード」+ 「今日（yyyy/m/d）のプロジェクトとメンバーの状況」 |
| サマリー | 「今日のタスク」総数 + 「期限超過」数（赤系） |
| プロジェクトグループ | プロジェクトカラードット + 名前 + (件数) |
| メンバーセクション | アバター（イニシャル）+ 名前 + (件数) |
| 予定カード | 予定名 + 制作物名 + 期間（yyyy/m/d 〜 yyyy/m/d）、カテゴリ色背景、期限超過時赤背景 |
| 空状態 | 「今日のタスクはありません」 |

**API**：`GET /api/v1/users/me/dashboard`

**インタラクション**：
- 予定カードクリック → `navigate('/projects/:projectId/items/:itemId', { state: { scrollToBallId: planId } })`
- 該当制作物画面（SC-06）でハイライト + 該当位置へスクロール

**カテゴリ色マップ**（章 4.9 デザイントークンに統合）：

| カテゴリ | 背景 | 枠線 |
|---|---|---|
| wireframe | purple-50 | purple-300 |
| design | blue-50 | blue-300 |
| coding | green-50 | green-300 |
| review | orange-50 | orange-300 |
| meeting | yellow-50 | yellow-300 |
| other | gray-50 | gray-300 |
| **期限超過** | **red-50** | **red-400** |

**Phase 1 拡張**：
- 「進行判定フィルター」タブ（平常／要確認／遅延の3カラム、FR-DASH-08）
- メンバー指定の絞り込み・検索（FR-DASH-09, 10）

---

### 4.4.11. SC-17 メンバーかんばん（`/projects/:projectId/members`、v1.1 新規、Phase 0 必須）

**目的**：プロジェクト参加メンバーごとに、担当している予定を状態別（#131：実施中／確認待ち／承認済み／TOSS済／差し戻し／完了）に並べたかんばんビュー。DnD で状態機械の各操作（確認依頼／承認／差し戻し／TOSS）を実行（UC-26、FR-BALL-02, 03, 08, 11）。

**URL**：`/projects/:projectId/members`（既定タブ、SC-11 参加者管理は `?tab=manage` で切替）

**画面構成**：

```
┌────────────────────────────────────────────────┐
│ プロジェクト名 | [メンバー][管理]タブ            │
├──────────┬──────────┬──────────┬──────────┤
│ 状態＼担当  │ 田中 太郎 │ 佐藤 花子 │ 鈴木 次郎 │
├──────────┼──────────┼──────────┼──────────┤
│ 準備中     │ [card][card]│         │ [card]    │
├──────────┼──────────┼──────────┼──────────┤
│ TOSS済    │ [card]     │ [card]   │           │
├──────────┼──────────┼──────────┼──────────┤
│ 完了      │ [card]     │ [card]   │ [card]    │
└──────────┴──────────┴──────────┴──────────┘
```

**主要コンポーネント**：

| コンポーネント | 責務 |
|---|---|
| `MemberKanbanGrid` | グリッドレイアウト（CSS Grid：縦軸=状態、横軸=メンバー） |
| `KanbanColumn` | 状態×メンバーのセル（DnD ドロップターゲット） |
| `KanbanCard` | 予定カード（DnD ドラッグソース）、カテゴリ色 |
| `MemberColumnHeader` | メンバーヘッダー（クライアント／制作グルーピング） |

**DnD ライブラリ**：react-dnd（プロトタイプと同じ）

**DnD 操作のドメインマッピング**（#131 状態機械。章 §4.7.4 と整合）：

> **#131**：かんばんの状態列は 6 状態（実施中 / 確認待ち / 承認済み / TOSS済 / 差し戻し / 完了）に対応し、状態列間の DnD は状態機械の各アクションを呼ぶ。~~メンバー列間 DnD で任意の相手へ TOSS~~／~~自動連鎖~~ は廃止（TOSS 先は `successor_plan_id` の後続実施者に固定）。

| DnD 操作 | API 呼び出し | event_type |
|---|---|---|
| 実施中/差し戻し → 確認待ち | `POST .../plans/:planId/request-review` | review_requested |
| 確認待ち → 承認済み（or 実施中→承認済み、承認者なし） | `POST .../plans/:planId/approve` | approved |
| 確認待ち → 差し戻し | `POST .../plans/:planId/send-back { note? }` | sent_back |
| 承認済み → TOSS済（進行責任者、後続あり） | `POST .../plans/:planId/toss` | tossed |
| TOSS済 → 承認済み（取消） | `POST .../plans/:planId/toss-undo` | approved（再追記） |

**認可・エラー処理**：
- すべての DnD 操作は既存 API のミドルウェアで認可される（Ball Holder でない／状態遷移不可なら 403/422）
- 失敗時：トースト「操作できませんでした：{エラーメッセージ}」+ カード位置を元に戻す（楽観更新ロールバック）

**楽観更新**：
- DnD でドロップした瞬間にカードを新位置に移動（`setQueryData`）
- API 成功で確定、失敗で元に戻す（§4.7 と整合）

**API**：
- 一覧：`GET /api/v1/projects/:projectId/items/{各itemId}/plans` を全制作物分まとめて取得（or 専用 EP `/projects/:projectId/plans` を Phase 1 で検討）
- 各 DnD：上記マッピング表参照

**空状態**：「このプロジェクトには予定がまだありません」 + 「最初の予定を作成」リンク → SC-06 への導線

**A11Y**：
- DnD は **キーボード操作（矢印キー）** にも対応（react-dnd の HTML5Backend + KeyboardBackend）
- カード移動時に `aria-live="polite"` で読み上げ「{予定名} を {新メンバー} に TOSS しました」

**議論ポイント（§4.10）**：
- カンバンでメンバー多数時の UX（横スクロール vs グルーピング）
- 自己 TOSS（同一メンバー列内の状態移動）の API 表現
- 状態カラム名の表示文言（「準備中」「TOSS済」「完了」が PRD ボール状態名と一致するか確認）

---

### 4.4.12. SC-16 非会員URL 発行・管理（`/projects/:projectId/share-links`、v1.1 非会員URL前倒し）

**目的**：クライアント向けの非会員URLの発行・有効期限管理・個別失効・アクセスログ確認（FR-SHARE-01〜04、UC-23）。

**権限**：プロジェクトディレクターのみ（`requireProjectDirector`）。Phase 2 以降は組織で機能 OFF の場合に本画面そのものへのアクセスを禁止（FR-SHARE-07）、Phase 0〜1 は常時アクセス可。

**表示項目（PRD SC-16）**：
- 「+ 新規発行」ボタン
- 発行モーダル：共有スコープ（プロジェクト全体／特定の制作物／特定のボール）、有効期限（Date / Duration、既定値はサーバ側システム規定）
- 発行済URL一覧：URL／発行者／発行日時／有効期限／状態（有効／失効／期限切れ）／個別失効ボタン
- アクセスログ：時刻／IP／UA／参照リソース（FR-SHARE-04、`audit_logs.share_link_id` で紐付く行を集計）

**重要な UX 制約**：
- **生トークンを含む完全な URL は発行直後の1回のみ表示**（章3 §3.6.9 POST レスポンス）。再表示・再取得は不可。閉じるとトークン平文は失われる旨を明示
- 「URL をコピー」ボタンは発行直後のモーダル内のみ提供
- 失効操作は確認ダイアログ必須（`ConfirmDialog`）。失効後の取り消し不可

**API**：
- 一覧：`GET /api/v1/projects/:projectId/share-links?status=...`
- 発行：`POST /api/v1/projects/:projectId/share-links`
- 個別失効：`DELETE /api/v1/projects/:projectId/share-links/:shareLinkId`

**フォーム**：React Hook Form + zodResolver。`packages/shared/schemas` に発行スキーマ（scopeType / scopeTargetId / expiresInSeconds）を集約、API と型共有。

**状態**：未発行（空状態）／発行済（有効）／失効済／期限切れ。空状態は `EmptyState` で「最初の非会員URLを発行する」CTA を表示。

---

### 4.4.13. 非会員URL 閲覧画面（`/share/:token`、v1.1 非会員URL前倒し）

**目的**：非会員URL閲覧者（クライアント）が、共有スコープに応じてプロジェクト・制作物・ボールを閲覧し、自分が Ball Holder のボールに対して TOSS／完了／差し戻しを実行する（FR-SHARE-05、UC-23、SR-AUTHZ-02）。

**権限**：未認証可。トークン自体が認可（`requireShareToken`、章5 §5.x）。

**処理フロー**：
1. URL アクセス → `GET /api/v1/share/:token` でスコープ・対象データ取得
2. トークン無効（404）→ 「失効ページ」を表示（「このリンクは無効になりました。発行者にお問い合わせください」）
3. 有効 → スコープに応じた画面（**#131：閲覧専用ではなく操作可能。#59 の閲覧専用方針は撤回**）：
   - `scope='project'`：プロジェクトTOP相当（Phase 0 では各制作物画面の簡易版＋ヘッダ）
   - `scope='item'`：SC-06 縦型スケジュール＋状態機械のボール操作
   - `scope='plan'`：SC-08 ボール詳細モーダル相当の単一画面
4. ボール操作（**#131：確認依頼／承認／差し戻し**。TOSS は共有リンク不可＝進行責任者=会員のみ）：
   - SC-08 と同じ UI。**保持者の種別を問わず、scope 内かつ状態機械が許す限り操作可**
   - 操作前に表示名（ハンドル）または受領メールアドレスを任意入力（FR-SHARE-06）
   - 入力値は localStorage に保存して再入力を省く（同一ブラウザ内）

**コンポーネント**：
- `GuestSharePage`（ルート、`/share/:token`）
- `GuestProjectView` / `GuestItemView` / `GuestPlanView`（scope に応じた切替）
- `GuestActionInputDialog`（FR-SHARE-06：表示名／メールの確認入力）
- `ShareLinkExpiredPage`（404 時の失効表示）

**API**（#131）：
- 取得：`GET /api/v1/share/:token`
- 確認依頼：`POST /api/v1/share/:token/plans/:planId/request-review`
- 承認：`POST /api/v1/share/:token/plans/:planId/approve`
- 差し戻し：`POST /api/v1/share/:token/plans/:planId/send-back`
- （TOSS・完了の旧共有エンドポイントは廃止）

**SEO 対策**：`<meta name="robots" content="noindex, nofollow">` を `/share/:token` 配下のページに必ず付与（章5 §5.x のクローラ防止と整合）。

**楽観更新**：Phase 0 では非会員URL経由の操作は **楽観更新を実装しない**（管理画面相当でレアケース、`/dashboard` 等の一覧キャッシュとの整合が複雑）。サーバ確定後に画面更新する素直な実装にとどめる。Phase 1 で利用頻度が見えたら再評価。

**フォントと文言**：認証画面と同一トーン（NFR-UX-01「煽らず濁さず逃げない」）。「このリンクは TRAKON 上で発行された短期共有URLです」のサブ説明をフッタに常時表示。

---

## 4.5. 共通コンポーネント

| コンポーネント | 用途 | ベース |
|---|---|---|
| `BallHolderBadge` | Ball Holder 表示の統一 | shadcn/ui Badge |
| `MemberAvatar` | 参加者アバター（ニックネーム頭文字） | shadcn/ui Avatar |
| `DateCell` | 縦型カレンダーの日付セル | div + Tailwind |
| `ConfirmDialog` | 削除・破棄など重要操作の確認 | shadcn/ui AlertDialog |
| `EmptyState` | 空状態の統一表示 | div + アイコン |
| `ErrorBoundary` | エラー画面化（リトライボタン付き） | React |
| `LoadingSkeleton` | スケルトンローディング | shadcn/ui Skeleton |
| `Toast` | 成功・警告通知 | shadcn/ui Sonner |
| `FormField` | React Hook Form + ラベル + エラー一体化 | shadcn/ui Form |
| `RequireAuth` | 認証ガード | カスタム |
| `AppSidebar` | 全ページ共通の左サイドバー（表示専用） | カスタム |
| `PageHeader` | ページヘッダー（パンくず／タイトル／アクション／ツールバー行） | カスタム |

### 4.5.1. TRAKON 固有コンポーネント（`src/components/trakon/`）

Figma のデザイン言語のうち、shadcn の汎用プリミティブでは表しきれない TRAKON 固有の語彙をここに置く。定義（ラベル・色・アイコンの対応表）はコンポーネントと別ファイルに分け、画面側からも参照できるようにする。

| コンポーネント | 定義ファイル | 責務 | Figma |
|---|---|---|---|
| `WorkflowButton` | `workflow.ts` | ボール操作 4 種（ボールを渡す／戻す／承認／次の工程へトス）。「次の工程へトス」だけがブランドオレンジで、工程を前へ進める唯一の操作であることを色で示す | node 42:4 |
| `StatusPill` | `planStatus.ts` | ボール状態機械 6 値の表示（ラベル・配色・アイコン） | node 11:19 ほか |
| `RoleRow` | `planRole.ts` | 3 役割（実施者／承認者／進行責任者）の行表示。アバター色は人ではなく**役割**に紐づく | node 25:2 |
| `ScheduleThemeSwatch` | `scheduleTheme.ts` | スケジュールカラーテーマの色見本。予定ごとの色選択 UI の下地 | node 54:2 |
| `Wordmark` | — | TRAKON ロゴタイプ。Sora のライブテキストで描画する | node 33:19 / 9:3 |

`scheduleTheme.ts` は 10 テーマのカタログ（§4.9.2）を保持する純粋なデザインデータで、予定ドメインには依存しない。カテゴリ → 既定テーマの対応は `features/plans/planTheme.ts` 側に置く。

---

## 4.6. 縦型カレンダーの描画モデル（SC-06 の中核）

PRD §7 SC-06 と「カレンダー表示仕様 v1.0」「MVP仕様書 画面B」が示す縦型スケジュールを、SPA で素直に描画するための実装方針。

### 4.6.1. レイアウト方式

| 方式 | 採用 | 理由 |
|---|---|---|
| **CSS Grid（display: grid）** | ✅ 採用 | 縦軸（日付）×横軸（参加者）の二次元表現が素直、各セルに position 計算不要、ブラウザ最適化が効く |
| Table タグ | ❌ | 列固定スクロール・スティッキー要素の制御がしづらい |
| 絶対配置（calc + position: absolute） | ❌ | ボールチップの跨ぎ表現には便利だが、ハンドリングが複雑、A11Y も劣る |

### 4.6.2. 描画モデル

```
ScheduleGrid (display: grid; grid-template-columns: 60px repeat(N, 1fr))
├── ヘッダー行（sticky top）：日付カラム見出し + 参加者列見出し
├── 日付行 × プロジェクト期間日数
│   ├── 日付セル（左カラム、sticky left）
│   └── 参加者セル × N（クリック可能、空の場合 cursor: pointer）
└── ボールチップオーバーレイ層（grid-row-start/grid-column-start で配置）
```

- **行**：プロジェクト期間内の各日（DATE 型を順次生成）
- **列**：参加者（`project_members` を `sort_order` 順、所属名でグルーピング）
- **ボールチップ**：
  - `grid-row` = 予定日に対応する行
  - `grid-column-start/end` = FROM 列〜TO 列を span することで「FROM→TO」の方向視覚化（PRD SC-06「構造で意味を伝える」）
  - 重なり時はチップ高さを縮めるか z-index で前面化

### 4.6.3. パフォーマンス対策

| 観点 | 方針 |
|---|---|
| 想定上限 | NFR-PERF-02：100 予定／プロジェクトで遅延なし |
| 仮想スクロール | **Phase 0 では不要**（1プロジェクト最大数百日×参加者10列 + 数十ボール = 数千ノード、ブラウザで十分処理可能） |
| 必要時の対応 | Phase 1 で要件超過したら `react-virtuoso` 等で行仮想化を検討 |
| メモ化 | `<DateCell>` を `React.memo`、ボールチップも plan ID キーでメモ化 |
| 再レンダリング抑制 | TanStack Query のセレクタで「自分が表示する範囲のデータのみ」を購読 |

### 4.6.4. 日付計算

| 観点 | 方針 |
|---|---|
| ライブラリ | **date-fns**（軽量、tree-shaking 効く、日本語ロケール充実） |
| タイムゾーン | サーバ・クライアント両方で `Asia/Tokyo` 暦日（章2 §2.2.5） |
| 「本日」判定 | `isToday()`（クライアント時計、誤差は許容） |
| 土日判定 | `isWeekend()` |
| 祝日判定 | Google カレンダー JSON を 1日1回フェッチして localStorage キャッシュ（FR-SCH-04）。BE 経由 GET `/api/v1/holidays`（Phase 1）か、FE で直接フェッチ（Phase 0） |
| 月切替判定 | 前日と月が異なる行に区切り線（FR-SCH-11） |

> **議論ポイント §4.10-7**：祝日データを Phase 0 で BE 経由にするか FE 直接にするか。

---

## 4.7. Ball Holder 表示の更新責務（楽観更新）

### 4.7.1. なぜ楽観更新するか

PRD SC-08「TOSS実行：確認ダイアログ挟まず、モーダル内で TOSSする→TOSS中…→相手にTOSSしました→自動クローズ」。
体感速度を確保しつつ、ヘッダー Ball Holder バッジ・スケジュール上のチップ装飾を **API 完了を待たず即時に切り替える** 必要がある。

### 4.7.2. 実装方針（TanStack Query + `packages/shared` 共有関数）

```typescript
// apps/web/src/features/balls/use-toss-mutation.ts
const tossMutation = useMutation({
  mutationFn: () => api.toss({ projectId, itemId, planId }),
  onMutate: async () => {
    await queryClient.cancelQueries({ queryKey: planKey });
    const previous = queryClient.getQueryData(planKey);
    queryClient.setQueryData(planKey, (old) => {
      // 章3 §3.8 の deriveBallHolder を共通関数として呼び出す
      const optimisticEvent = { eventType: 'tossed', actorMemberId: currentMember.id, source: 'human' };  // v1.1 source 追加
      const newHolder = deriveBallHolder(old.plan, optimisticEvent);
      return { ...old, plan: { ...old.plan, ballHolder: newHolder, ballState: 'tossed' } };
    });
    // ヘッダー用クエリも同様に更新
    queryClient.setQueryData(plansKey, (old) => /* ... */);
    return { previous };
  },
  onError: (err, _, context) => {
    queryClient.setQueryData(planKey, context.previous);  // ロールバック
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: planKey });
    queryClient.invalidateQueries({ queryKey: plansKey });
  },
});
```

**`deriveBallHolder` 関数の置き場所**：
- BE：`apps/web/server/services/plans.ts` から呼ぶ
- FE：`apps/web/src/features/balls/use-toss-mutation.ts` から呼ぶ
- 共通：`packages/shared/domain/ball-holder.ts`（章3 §3.8.1 で定義）

これにより、**FE と BE で同じロジックが Ball Holder を導出**するため、楽観更新の表示と API 確定後の表示が一致する。

### 4.7.3a. ~~自動 TOSS 連鎖（auto_chain）の楽観更新~~（#117 で廃止）

> **#131 改訂**：自動連鎖 TOSS（`complete` 時に後続へ自動 TOSS）は **#117 で廃止**された。承認（approve）と TOSS は分離され、進行責任者が明示的に TOSS するため、レスポンスの `autoTossed` は常に `null`。各操作（confirm-review / approve / send-back / toss）はそれぞれ独立した mutation として §4.7.2 と同じパターンで楽観更新する（対象 plan の `ballState` / `ballHolder` を `deriveBallHolder` の結果で差し替え、`onError` でロールバック）。

### 4.7.4. カンバン DnD の楽観更新（v1.1 / #131 改訂、SC-17）

SC-17 メンバーかんばんでの DnD 操作は、内部的に状態機械の各 mutation（request-review / approve / send-back / toss / toss-undo）を呼ぶ。

**DnD ハンドラの実装イメージ**（#131：状態列間の遷移をアクションにマップ）：

```typescript
function handleCardDrop(planId: string, fromState: string, toState: string) {
  // 状態列間の遷移を状態機械アクションへマップ（§4.4.11 SC-17 の表と一致）
  const action = resolveBallAction(fromState, toState);  // 'request-review' | 'approve' | 'send-back' | 'toss' | 'toss-undo' | null
  if (!action) return;               // 許可されない遷移は無視（カードは元位置へ）
  ballActionMutation.mutate({ planId, action });
}
```

**楽観更新**：
- ドロップ即座にカード位置を変更（kanban state を更新）
- mutation の `onError` でロールバック
- 章 §4.4.11 SC-17 と整合

### 4.7.5. 競合した場合（API が 409 等を返した場合）

- 楽観更新をロールバック（`onError`）
- トースト「他の操作と競合しました。最新の状態を取得します」
- `invalidateQueries` で再取得

---

## 4.8. 状態管理の詳細

### 4.8.1. Zustand ストアと URL 同期フック

| ストア／フック | 責務 | 実装 | サンプル |
|---|---|---|---|
| `useAuthStore` | 現在のユーザー情報（Supabase Auth + アプリ users 同期後） | Zustand | `currentUser`, `signOut()` |
| `useModal()` | **モーダル開閉（URL 同期）** | カスタムフック（`useSearchParams`） | `openModal(name, params)`, `closeModal()`, `currentModal` |
| `useToastStore` | トースト | Zustand（または shadcn/ui Sonner と直接連携） | `success(msg)`, `error(msg)` |

> **モーダルは URL に同期するため Zustand には置かない**（§4.2.4）。Zustand は「ブラウザ内で完結する非永続 UI 状態」のみに使う。Zustand は「ストア＝1ファイル＝1関数」を原則とし、巨大化を避ける。

#### `useModal()` の実装イメージ

```typescript
// apps/web/src/hooks/use-modal.ts
const MODAL_PARAM_KEYS = ['modal', 'date', 'planId', 'memberId', 'itemId'] as const;

export function useModal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentModal = searchParams.get('modal');

  const openModal = (name: string, params: Record<string, string> = {}) => {
    const next = new URLSearchParams(searchParams);
    next.set('modal', name);
    Object.entries(params).forEach(([k, v]) => next.set(k, v));
    setSearchParams(next, { replace: true });
  };

  const closeModal = () => {
    const next = new URLSearchParams(searchParams);
    MODAL_PARAM_KEYS.forEach((k) => next.delete(k));
    setSearchParams(next, { replace: true });
  };

  return { currentModal, openModal, closeModal, params: searchParams };
}
```

### 4.8.2. TanStack Query キー設計

| クエリキー | データ | 無効化トリガ |
|---|---|---|
| `['auth', 'me']` | 現在のユーザー（GET /auth/me） | ログアウト・プロジェクト作成 |
| `['projects']` | プロジェクト一覧 | POST /projects |
| `['projects', projectId]` | プロジェクト詳細 | PATCH /projects/:projectId |
| `['projects', projectId, 'members']` | 参加者一覧 | POST/PATCH/DELETE /members |
| `['projects', projectId, 'items']` | 制作物一覧 | POST/PATCH/DELETE /items |
| `['projects', projectId, 'items', itemId]` | 制作物詳細 | 同上 |
| `['projects', projectId, 'items', itemId, 'plans']` | 予定一覧 | POST/PATCH/DELETE /plans, TOSS, 完了 |
| `['projects', projectId, 'items', itemId, 'plans', planId]` | 予定詳細 | 上記 + イベント追加 |

> クエリキーは API パスと厳密に揃える。`queryClient.invalidateQueries({ queryKey: ['projects', projectId] })` で配下の `members` / `items` / `plans` も全部無効化される（部分一致）。

### 4.8.3. クエリのデフォルト設定

```typescript
// apps/web/src/lib/query-client.ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,         // 30秒は再取得しない
      gcTime: 5 * 60_000,        // 5分でキャッシュ削除
      retry: 1,                  // 失敗時1回リトライ
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
});
```

---

## 4.9. デザインシステム

PRD §4.4 UXR-04「派手さ・色数・動きで強さを演出しない」、NFR-UX-01「静かな強さ」を尊重する。

**v1.2（#XXX）で Figma「TRAKON｜Landing Page」(fileKey `6juEDpIueDBvcfYvOmPJ3w`) を正とするデザインシステムへ全面改訂。** 実装は `apps/web/src/styles/globals.css` の CSS 変数に集約し、Storybook の `foundation/Design Tokens` で一覧確認できる。

基調は **暖色ニュートラル + ブランドオレンジ**。v1.1 までの無彩色グレー基調（Figma Make プロトタイプ由来）は廃止した。

### 4.9.1. カラー

shadcn の標準トークン名（`--background` / `--foreground` / `--primary` …）は据え置き、値のみ TRAKON 配色に差し替える。加えて、それまでコード中に生の Tailwind パレット（`sky-500` / `rose-50` 等）で散在していたドメイン意味づけをセマンティックトークンとして定義する。

**基本（Figma node 8:3）**

| トークン | 値 | 用途 |
|---|---|---|
| `--content` | `#F7F6F2` | アプリ本体の背景 |
| `--sidebar` | `#FCFBF8` | サイドバー |
| `--background` / `--card` | `#FFFFFF` | カード・ヘッダー帯 |
| `--surface-muted` | `#F7F5F1` | 週末行など控えめな面 |
| `--surface-subtle` | `#F9F8F5` | 見出し帯 |
| `--border` | `#E6E2DB` | 標準の罫線 |
| `--grid-border` | `#E8E5DF` | カレンダー罫線（一段淡い） |
| `--input` | `#DED8CE` | 入力・ボタン輪郭 |
| `--foreground` / `--primary` | `#23231F` | 本文・主要ボタン背景 |
| `--text-secondary` | `#676862` | 補助テキスト |
| `--text-tertiary` | `#908F87` | プレースホルダ・ラベル |

**ブランド（accent 確定）**

| トークン | 値 | 用途 |
|---|---|---|
| `--brand` | **`#E7672C`** | ブランドカラー。今日マーカー、「次の工程へトス」 |
| `--brand-strong` | `#E05224` | ブランド文字色 |
| `--brand-subtle` | `#F8EFE8` | 選択中のナビ項目 |
| `--brand-badge` | `#FCE8DB` | プランバッジ背景 |

> v1.1 まで暫定だったブランドカラー `#1F6FEB` は **`#E7672C` に確定**（§4.10-9 の議論ポイントをクローズ）。

**状態・カレンダー**

| トークン | 値 | 用途 |
|---|---|---|
| `--success` / `--success-subtle` | `#2E7D4F` / `#E8F6EC` | FIX・承認済み |
| `--warning` / `--warning-subtle` | `#C88718` / `#FFF5DE` | 進行中 |
| `--danger` / `--danger-subtle` | `#B14E41` / `#FEF7F5` | 遅延・エラー |
| `--today-bg` / `--today-marker` | `#FFF8E3` / `#E7672C` | 本日行（FR-SCH-05） |
| `--weekend-bg` | `#F7F5F1` | 土日背景（FR-SCH-03） |
| `--holiday-bg` / `--holiday-foreground` | `#FEF7F5` / `#B14E41` | 祝日（FR-SCH-04） |

### 4.9.2. スケジュールカードのカラーテーマ（Figma node 54:2）

10 テーマ。文字色は全テーマ共通 `#22211F`（`--plan-foreground`）で、背景とのコントラストは 13:1 以上を確保する。

| テーマ | Surface | Accent |
|---|---|---|
| Warm Gray | `#EEEAE2` | `#665F57` |
| Rose | `#FDEFF2` | `#D95B78` |
| Coral | `#FFE6DC` | `#D94A20` |
| Amber | `#FFF5DE` | `#C88718` |
| Lime | `#F4F8E5` | `#7E9D28` |
| Green | `#EAF7EE` | `#2F9A5B` |
| Teal | `#E8F7F4` | `#248F83` |
| Cyan | `#EAF6FA` | `#2589A6` |
| Blue | `#DDEEFF` | `#1D6FD1` |
| Violet | `#F3E0F8` | `#9A3EAA` |

**配色ポリシー**：色は「状態」を表すものではなく、**ユーザーがスケジュールを視覚整理するために選ぶもの**（Figma 54:2 の明記事項）。状態は色ではなくステータス pill とボール保持者の表示で伝える。

このポリシーの帰結として、**予定の状態（進行中／確認待ち／承認済み／TOSS 済み／完了）でカードのテーマ色を差し替えない**。状態はステータス pill で伝える。例外は 2 つだけ。

- 完了：テーマ色のまま不透明度を落として退かせる。
- 期限超過：テーマ色は保ったまま**赤い枠**で警告する（ダッシュボードの扱いと揃える）。

段階移行とする。

1. 現段階：`plans.category`（6 値）から既定テーマを導出する。
2. 最終形：`plans` に色テーマ列を追加し、ユーザーが予定ごとに選択する（未設定時はカテゴリ由来の既定にフォールバック）。

### 4.9.3. タイポグラフィ

| 用途 | フォント | サイズ | weight |
|---|---|---|---|
| ワードマーク | **Sora** | 32px | 600 |
| 画面タイトル | Noto Sans JP | 22px | 700 |
| セクション・月見出し | Noto Sans JP | 20px | 700 |
| カード見出し | Noto Sans JP | 14–16px | 700 |
| 本文 | Noto Sans JP | 13–14px | 400/500 |
| 補助テキスト | Noto Sans JP | 12px | 400 |
| データ密度高（カレンダー） | Noto Sans JP | 9–11px | 400/500 |

行間は本文 1.5、高密度領域 1.45。Tailwind 既定の `text-xs`〜`text-base` に加え、Figma に出現する 9 / 10 / 11 / 13 / 22px を `text-micro` / `text-mini` / `text-tiny` / `text-body` / `text-title` として定義する。

**フォント配信**：`@fontsource-variable/sora` と `@fontsource-variable/noto-sans-jp` を **セルフホスト**する（CDN 依存なし＝ §5 の CSP を緩めずに済む）。いずれも可変フォント（wght 軸）を採用し、Regular / Medium / Bold を 1 セットの `@font-face` で賄う。Noto Sans JP は `unicode-range` で 124 分割されており、描画に必要なサブセットだけが遅延ダウンロードされる。

> v1.1 までの「システムフォント（Inter スタック）／Web フォントは Phase 1 以降」という方針は、ブランド確立を優先して撤回した。

### 4.9.4. 角丸・影・寸法

- 角丸：`rounded-sm` 6px / `rounded-md` 8px / `rounded-lg` 10px（カード・ナビ・入力の基準） / `rounded-xl` 12px / `rounded-2xl` 14px。pill は `rounded-full`。
- 影：`shadow-card` = `0 4px 12px rgb(35 35 31 / 0.06)`、`shadow-float` = `0 6px 18px rgb(35 35 31 / 0.10)`。
- ボタン高さ：36px（副次） / 40px（ヘッダー主要） / 42px（ボール操作） / 44px（フォーム標準）。左右余白は通常 18px 以上、主要操作 24px 以上、アイコンとラベルの間隔 12px（Figma node 78:18 の実装ノート）。

### 4.9.5. スペーシング

Tailwind 標準（4px グリッド）。レイアウト padding は 16〜24px、コンポーネント内は 8〜16px。

### 4.9.6. ダークモード

**実装しない。** Figma のデザインはライトテーマのみで、ダーク用の指定が存在しない。`index.html` の `color-scheme` は `light` 固定とし、v1.1 まで存在した `.dark` ブロックと `dark:` ユーティリティ（一度も有効化されていなかった）は削除した。将来的に対応する場合も、全トークンが CSS 変数化されているため差し替えで対応できる。

## 4.10. 議論ポイントの確定結果

| # | 論点 | 確定内容 | 判断理由 |
|---|---|---|---|
| 1 | React Router のモード | **Data Router（`createBrowserRouter`）+ loader/action は不採用、データ取得は TanStack Query に集約** | キャッシュ・楽観更新の責務を1箇所に統一 |
| 2 | モーダル管理 | **URL 同期方式**（`?modal=ball-detail&planId=xxx`、カスタムフック `useModal()`） | ブラウザ戻るで閉じる、ディープリンク対応、Phase 1 のメール通知直リンクの素地 |
| 3 | 縦型カレンダー描画方式 | **CSS Grid** | 二次元表現が素直、ボールチップの FROM→TO 跨ぎ表現を span で実現、A11Y 良好 |
| 4 | フォームライブラリ | **React Hook Form + zodResolver** | Zod スキーマを API と共有、useFieldArray で繰返セクションが楽 |
| 5 | 日付ライブラリ | **date-fns** | 軽量・tree-shaking 効く・日本語ロケール充実 |
| 6 | アイコンライブラリ | **Lucide React** | shadcn/ui ドキュメントとサンプルが Lucide 前提、tree-shakable |
| 7 | 祝日データ取得（FR-SCH-04） | **Phase 0 は FE 直接フェッチ + localStorage キャッシュ** | サーバ口不要・実装シンプル。Phase 1 で BE 経由に移行 |
| 8 | 楽観更新 | **Phase 0 から実装**（TOSS / 完了、`packages/shared/domain/ball-holder.ts` を共有） | PRD SC-08「TOSS中…→相手にTOSSしました→自動クローズ」体験の確保 |
| 9 | ブランドカラー（accent） | **確定 #E7672C（オレンジ）**／~~仮確定 #1F6FEB（青系）~~ | Figma「TRAKON｜Landing Page」でブランドが確定。§4.9.1 に反映済み |
| 10 | 国際化（i18n） | **`packages/shared/i18n/messages.ja.ts` に集約、ライブラリは未導入** | Phase 0 は日本語固定、文字列定数化のみで将来 EN 化への下地 |
| 11 | カンバン DnD の意味論（v1.1 / **#131 改訂**、SC-17） | **既存 Ball Action API に集約、専用 EP なし** | UC-26 と整合。**#131：状態列移動 = 状態機械の各アクション（request-review / approve / send-back / toss / toss-undo）**。~~メンバー列移動での任意 TOSS~~ は廃止（TOSS 先は後続予定に固定）。認可・監査ログが既存ガードに乗る |
| 12 | 「次の予定」選択肢の範囲（v1.1） | **同制作物内に限定**（Phase 0、プロトタイプ仕様と一致） | 異なる制作物・プロジェクトを跨ぐ後続は Phase 1+ で検討（議論ポイントとして残置） |
| 13 | カンバンのメンバー多数時の UX（v1.1） | **横スクロール許容 + Sticky 状態カラム見出し**（Phase 0） | 5〜10 名は横スクロールなしで収まる前提。Phase 1 でグルーピング・フィルタを追加検討 |
| 14 | カテゴリの導入範囲（v1.1） | **Phase 0 から必須項目、6 値固定**（FR-SCH-18） | 中立色の `other` を用意することで全予定に必ず1つ割当可能 |
| 15 | OAuth ボタン配置（v1.1、SC-01） | **「または」区切り下、メール+パスワードの後**（プロトタイプ仕様） | スクリーン構成の慣例、メイン認証手段（password）を上に置く |

---

## 4.11. PRD 整合チェック

| 該当 PRD 項 | 本章での扱い |
|---|---|
| §7 SC-01〜04, 06〜08, 10, 11 | §4.4 で全画面定義 |
| §4.4 UXR-01〜05 | 各画面の表示方針・文言指針に反映（§4.2.6, §4.4） |
| §4.2 NFR-UX-01〜03 | §4.9 デザイントークン最小化、§4.6 構造で意味を伝える |
| §4.2 NFR-A11Y-01 | §4.2.8 に方針、shadcn/ui ベース |
| §4.2 NFR-MOBILE-01 | §4.2.9 に方針（Phase 0 は SC-03 / SC-08 を最適化） |
| §4.2 NFR-PERF-01, 02 | §4.6.3 縦型カレンダー、§4.3.1 コード分割 |
| FR-SCH-01〜11 | §4.4.5 SC-06、§4.6 縦型カレンダー描画モデル |
| FR-BALL-03 | §4.4.5 Ball Holder バッジ、§4.7 楽観更新 |
| FR-BALL-12 | §4.4.7 SC-08 削除は物理削除＋FE 確認モーダル |
| §13.1 画面遷移図 | §4.3.3 に Phase 0 抜粋版で記載 |

### Phase 1+ 持ち越し（v1.1 で SC-09 / SC-17 が Phase 0 へ繰り上げ）

- SC-05 プロジェクトTOP（代表ボール表示）
- SC-09 「進行判定フィルター」タブ（平常／要確認／遅延の3カラム、FR-DASH-08）
- SC-12 アーカイブ一覧
- SC-13 コメント／ファイル共有パネル
- SC-14 通知設定
- SC-07 の予定種別3種対応（共同予定／単独予定）
- ~~SC-08 の TOSS 取消／差し戻し～~~ → **#131 で実装済み**（差し戻し send-back、TOSS 取消 toss-undo、確認依頼/承認取消）。「再 TOSS」は状態機械では toss-undo→再 approve/toss で表現
- SC-17 メンバーかんばんのフィルタ・グルーピング（メンバー多数時 UX）
- ダッシュボードのモバイル最適化（NFR-MOBILE-01 本格対応）
- 異プロジェクト間の successor 紐付け

### PRD 整合メモ（PRD 改訂提案）

- 特になし（章2 で起票した `invitations` テーブル提案は引き続き有効）

---

## 4.12. 章ステータス

| 日付 | 状態 | 備考 |
|---|---|---|
| 2026-05-09 | Draft（たたき台） | §4.10 議論ポイント10項目を未確定で起稿 |
| 2026-05-09 | **v1.0 確定** | §4.10 全10論点を AskUserQuestion で確定。モーダル管理は推奨案「Zustand ベース」から **「URL 同期方式」に変更**、他9項目は推奨案どおり。§4.2.4 / §4.4.6 SC-07 / §4.4.7 SC-08 / §4.8.1 を URL 同期方式に書き換え。 |
| 2026-05-09 | **v1.1 確定**（非会員URL前倒し） | PRD v1.3 改訂（非会員URL共有 Phase 0 化）に追従。§4.3.1 URL 構造に `/share/:token` と `/projects/:projectId/share-links` を追加、§4.3.2 ルートツリーを更新、§4.3.3 画面遷移図に SC-16 と GuestEntry / GuestSharePage を追加、§4.4.12 SC-16 非会員URL 発行・管理／§4.4.13 非会員URL 閲覧画面を新設、§4.11 Phase 1+ 持ち越しから SC-16 を除外。 |
| 2026-05-24 | **v1.1 確定**（プロトタイプ反映） | SC-01 改訂（Magic-link + OAuth、7状態統合）／SC-07 改訂（カテゴリ + 次の予定）／SC-09 改訂（階層ビュー、Phase 0 必須化）／SC-11 改訂（タブ分離）／SC-17 新規（メンバーかんばん DnD = TOSS）／§4.3 ルーティング更新（/dashboard 必須化、/login 7状態統合、members タブ切替）／§4.7.3a 自動 TOSS 楽観更新／§4.7.4 カンバン DnD 楽観更新／§4.10 論点 11〜15 追加。 |
| 2026-07-24 | **#131 反映**（確認者付き予定・進行責任者） | SC-07 予定作成フォームを FROM/TO から 3 役割（実施者/承認者/進行責任者）へ／SC-08 ボール詳細を 6 状態の状態機械（確認依頼/承認/差し戻し/TOSS＋各取消）へ／SC-17 かんばん DnD マッピングを状態機械アクションへ／非会員URL閲覧画面を確認依頼/承認/差し戻し操作可能に（**#59 閲覧専用を撤回**、TOSS は共有不可）／§4.7.3a 自動 TOSS 楽観更新を #117 廃止として撤去／Phase 1+ 持ち越しから差し戻し・TOSS 取消を「#131 実装済み」に更新。 |
| 2026-08-22 | **#140 反映**（Figma デザインシステム 第1段：基盤） | ブランドカラーを **#E7672C** に確定し §4.10-9 をクローズ／配色基調を無彩色グレーから**暖色ニュートラル**へ全面差し替え、ドメイン配色をセマンティックトークン化／スケジュールカードの **10 カラーテーマ**と「色は状態ではなくユーザーの視覚整理の道具」という配色ポリシーを §4.9.2 に新設／フォントを **Sora + Noto Sans JP のセルフホスト**に確定（システムフォント方針を撤回）／**ダークモード非対応**を明記し `.dark` 実装を削除。§4.9 を全面改訂。 |
| 2026-08-22 | **#141 反映**（Figma デザインシステム 第2段：UI 部品） | ボタンに `accent`（次の工程へトス）を追加し高さを 36/40/44 の 3 段へ整理／バッジを意味づけ（neutral / success / warning / danger / brand）× 形（角丸 / pill）× 3 サイズに再構成／入力・セレクト・ラベル・シート幅を Figma 実測へ／`dropdown-menu` / `popover` / `tooltip` を新規追加／§4.5.1 に TRAKON 固有コンポーネント（WorkflowButton / StatusPill / RoleRow / ScheduleThemeSwatch）を新設／`categoryColor.ts` を `planTheme.ts` へ移行し、生の Tailwind パレット参照を 10 テーマへ集約。 |
| 2026-08-23 | **#142 反映**（Figma デザインシステム 第3段：アプリシェル） | サイドバーを Figma node 9:2 へ（幅 224px / Sora ワードマーク / セクション操作アイコン / プロジェクト行の「⋯」メニュー / ユーザー情報フッター）。表示部分を `AppSidebar` に切り出し Storybook で検証可能にした／`PageHeader` に 2 段目の `toolbar` スロットを追加し、タイポグラフィを Figma node 9:31 へ／ワードマークを `Wordmark` コンポーネントに集約（従来は 4 箇所に直書き）／プロジェクト一覧のタブを URL 同期し、サイドバーのアーカイブ導線から直接開けるようにした／§4.2.2 のレイアウト構造の記述を実装・Figma に合わせて改訂。 |
| 2026-08-23 | **#143 反映**（Figma デザインシステム 第4段a：スケジュール描画の共通化） | `ItemSchedulePage`(1279行) からボード描画を `features/plans/schedule/` へ切り出し（388行に）／そのフォーク複製だった `ShareSchedule`(487行) を同じ `ScheduleBoard` の閲覧専用モードに載せ替え（69行に）／共有画面のボール保持者導出とカード座標が認証済み画面と揃った／列ごとに重複していた SVG 矢印 marker の id をボード 1 箇所へ集約。§4.4.5.2 を実装に合わせて改訂。 |
| 2026-08-23 | **#144 反映**（Figma デザインシステム 第4段b：スケジュール画面） | カードを Figma node 11:2 へ（左 4px テーマストライプ／タイトル 14 Bold／カテゴリ・期間・ステータス pill／下端の 3 役割）／日付軸を node 10:3 へ（幅 96px・日にちを大きく・本日マーカー・月名）。行高ズームに合わせ 3 段階で表示を落とす／列ヘッダーを node 10:5 へ（色ドット廃止・FIX/件数バッジ）／後続コネクトに「◯◯がTOSS」ラベルを追加し配色を --toss-line トークンへ／ズームコントロールを node 11:139 へ／**状態でテーマ色を差し替えない**方針を §4.9.2 に明記し実装を修正。 |
| 2026-08-23 | **#145 反映**（Figma デザインシステム 第5段：ボール詳細ドロワー） | SC-08 を Figma node 37:2 へ。ヘッダー（工程チップ・状態 pill・タイトル・期間・編集/複製/⋯）／**概要・履歴の 2 タブ**／概要は 現在のボール → 担当（職種付き）→ スケジュール → 次のTOSS → 最近の履歴／フッターは状態説明 + `WorkflowButton`（主要操作は最大 2 つ）。**取り消し系・前工程への差し戻し・削除はヘッダーの「⋯」メニューへ集約**し、フッターが操作で溢れないようにした。担当欄は `RoleRow` に detail バリアントを追加して共通化。 |
| 2026-08-23 | **#146 反映**（Figma デザインシステム 第6段：ダッシュボード） | SC-09 を階層リストから 4 列ボードへ（Figma node 57:2）。列の導出を `ballBoardColumnOf()` として `packages/shared` に追加し、`tossed` を二重計上として除外／「要対応のみ」トグル用に `member.isMe`、カード表示用に `task.progressManager` を DTO へ追加／カード配色はスケジュールと同じ 10 テーマ、列の見出し色も同パレットから選択。§4.4.10 に列と状態の対応表を追記。 |
