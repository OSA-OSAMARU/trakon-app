# 第8章 AI 連携（MCP サーバ）

| 項目 | 内容 |
|---|---|
| 章版 | **v1.0（新設）** |
| 日付 | 2026-11-21 |
| 上位要件 | PRD FR-API-01（API 連携、Phase 3）の**一部前倒し**／SR-AUTH-10（PKCE 必須）／SR-AUTHZ-01, 03／SR-AUDIT-01／SR-EXT-01 |
| 関連章 | 02-database §2.9.4（テーブル追加）／03-api §3.9b（エンドポイント）／04-frontend §4.9.7（SC-20, SC-21）／05-security §5.10b（認証・認可）／06-infrastructure §6.15.8（Vercel rewrites） |

---

## 8.1 目的とスコープ

**画面を開かなくても、Claude・ChatGPT・Gemini・Copilot などの AI アシスタントに自然言語で頼むだけで予定の確認・登録・変更・ボールの受け渡しができる**ようにする。

> 例：「Aプロジェクトのバナー制作に、来週月曜から水曜で『デザイン初稿』を田中さん担当で入れて」
> 「今日わたしがボールを持っている予定を教えて」
> 「LP コーディングの予定を 2 日後ろにずらして」

そのために [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) のリモートサーバを TRAKON に内蔵する。MCP は主要 AI クライアントが共通に対応している接続規格で、TRAKON 側は 1 つのサーバを用意すれば各社のクライアントからつながる。

### 8.1.1 Phase 0 スコープ（本章で実装するもの）

| 区分 | 内容 |
|---|---|
| 読み取り | 参加プロジェクト一覧／プロジェクト詳細（制作物・参加者）／予定一覧（期間・制作物・担当者で絞込）／予定詳細（履歴つき）／自分のダッシュボード |
| 書き込み | 制作物の作成／予定の作成・変更（日付・担当・制作物の移動を含む）・削除／ボール操作（確認依頼・承認・差し戻し・TOSS とその取り消し） |
| 認可 | OAuth 2.1 認可サーバを TRAKON に内蔵（動的クライアント登録 + PKCE）。同意画面 SC-20 |
| 管理 | 接続中の AI アプリの一覧と接続解除（SC-21「AI 連携」） |

### 8.1.2 スコープ外（§8.13 に持ち越し）

- プロジェクトの作成・設定変更、参加者の追加・削除、招待、共有リンク、課金操作（**画面で確認しながら行うべき操作、または組織・課金に影響する操作**のため）
- 添付ファイルの送受信
- 組織単位での AI 連携の許可制（SR-EXT-01 の完全対応）

---

## 8.2 方針決定

| # | 論点 | 決定 | 退けた選択肢と理由 |
|---|---|---|---|
| D1 | 接続方式 | **リモート MCP サーバ（Streamable HTTP）を既存の Vercel 関数に同居**させる。エンドポイントは `POST /api/mcp` | ① ローカル stdio サーバ（npm 配布）… Claude.ai・ChatGPT などの Web/モバイル版から使えない。② 別デプロイの MCP 専用サービス … 認可・業務ルールの二重管理になる |
| D2 | セッション | **ステートレス**（セッション ID を発行しない、JSON 応答のみ） | Vercel Functions はリクエストごとに別インスタンスになりうるため、セッション状態を保持できない。TRAKON のツールは 1 リクエストで完結するのでサーバ発のストリーミングは不要 |
| D3 | 認可 | **OAuth 2.1 認可サーバを Hono 内に自前実装**（RFC 8414 / 9728 / 7591 / 7636 / 8707）。アクセストークンは**不透明トークン**（DB にはハッシュのみ） | ① 個人アクセストークン（API キー）… Claude.ai・ChatGPT のカスタムコネクタは OAuth か認証なししか受け付けず、主要ユースケースを満たせない。② Supabase Auth の OAuth 2.1 Server 機能 … ベータ機能でダッシュボード設定に依存し、発行トークンが「画面ログインと同等の全権 JWT」になるためスコープ制限・連携単位の失効ができない |
| D4 | 業務ルールの置き場所 | **MCP ツールは既存 REST API（`/api/v1`）をプロセス内で呼び出す薄いアダプタ**にする（§8.8） | サービス層を直接呼ぶ案 … 参加 404 集約・凍結/課金 403・ロール判定・Zod 検証・監査ログがミドルウェアに分散しており、MCP 側に写すと二重管理になり必ずずれる。**画面からの操作と AI からの操作で結果が変わらないこと**を構造で保証する |
| D5 | 権限の範囲 | **ユーザー本人の権限そのまま**（ロール・凍結・課金状態はすべて既存判定に従う）。その上で OAuth スコープ `read` / `write` で絞れる | AI 専用ロールの新設 … 権限の根拠を `role_type` 1 つにする原則（SR-AUTHZ-03）に反する |
| D6 | ID の扱い | ツールの入出力は **ID（UUID）ベース**。名前 → ID の解決は AI に `get_project` を読ませて行わせる | 名前の曖昧一致をサーバでやる案 … 同名の参加者・制作物で誤操作が起きる。ID 指定なら取り違えが起きず、AI は一覧から正確に選べる |
| D7 | 日付 | `YYYY-MM-DD`（JST）。一覧系の応答に `today`（JST）を含め、「来週の月曜」などを AI が解決できるようにする | — |

---

## 8.3 全体構成

```
 ┌──────────────┐   ① 401 + WWW-Authenticate (resource_metadata)
 │ AI クライアント │ ─────────────────────────────────────────┐
 │ Claude /      │   ② GET /.well-known/oauth-protected-resource │
 │ ChatGPT /     │   ③ GET /.well-known/oauth-authorization-server
 │ Gemini CLI /  │   ④ POST /api/oauth/register   (DCR)        │
 │ Copilot …     │   ⑤ ブラウザで /oauth/authorize (SC-20)       │   TRAKON (Vercel hnd1)
 │               │   ⑥ POST /api/oauth/token (code + PKCE)      ├─▶ Hono app
 │               │   ⑦ POST /api/mcp  Authorization: Bearer …   │     ├ /api/mcp ──┐
 └──────────────┘                                               │     │  McpServer │ ⑧ app.fetch(内部 Request)
                                                                │     │  (tools)   ▼
                                                                │     ├ /api/v1/*  ← 既存 REST（認可・検証・監査）
                                                                │     └ Prisma → Supabase Postgres
                                                                └──────────────────────────────────────
```

⑤ の同意画面は SPA のページで、利用者は**普段の TRAKON ログイン（メール / Google / Microsoft）**で本人確認する。TRAKON のパスワードが AI 側に渡ることはない。

---

## 8.4 エンドポイント一覧

| メソッド | パス | 認証 | 用途 |
|---|---|---|---|
| GET | `/.well-known/oauth-protected-resource`（`/api/mcp` サフィックス付きも同じ） | なし | RFC 9728 保護リソースメタデータ |
| GET | `/.well-known/oauth-authorization-server` | なし | RFC 8414 認可サーバメタデータ |
| POST | `/api/oauth/register` | なし | RFC 7591 動的クライアント登録（公開クライアントのみ） |
| POST | `/api/oauth/token` | なし（PKCE で保護） | `authorization_code` / `refresh_token` |
| POST | `/api/oauth/revoke` | なし | RFC 7009 トークン失効 |
| GET | `/api/v1/oauth/authorize` | Supabase JWT | 同意画面用：認可リクエストの検証とクライアント情報の取得 |
| POST | `/api/v1/oauth/authorize` | Supabase JWT | 同意画面用：許可／拒否 → リダイレクト先 URL を返す |
| GET | `/api/v1/ai-connections` | Supabase JWT | SC-21：接続中の AI アプリ一覧 |
| DELETE | `/api/v1/ai-connections/:id` | Supabase JWT | SC-21：接続解除（他人の接続は 404） |
| POST | `/api/mcp` | MCP アクセストークン | MCP（JSON-RPC）。GET / DELETE は 405 |
| — | `/oauth/authorize` | SPA | SC-20 同意画面（`authorization_endpoint`） |

- `/.well-known/*` は Vercel の rewrites で関数へ回す（06-infrastructure）。開発時は Vite proxy に `/.well-known` を追加。
- `/api/mcp`・`/api/oauth/*`・`/.well-known/*` は **CORS を全オリジン許可**（Cookie を使わず Bearer のみなので CSRF の対象にならない。ブラウザ型 MCP クライアント・Inspector のため）。
- メタデータの URL（issuer 等）は**リクエストのオリジンから組み立てる**。Preview / Production で同じコードが自分の URL を名乗る。

---

## 8.5 認可フロー（OAuth 2.1）

### 8.5.1 動的クライアント登録（DCR）

- 受け付けるのは **公開クライアント**（`token_endpoint_auth_method = none`）のみ。クライアントシークレットは発行しない（PKCE で代替）。
- `redirect_uris` は 1〜10 件。許可するのは **`https://` と loopback の `http://localhost` / `http://127.0.0.1` / `http://[::1]`**（RFC 8252。Claude Code・Gemini CLI・VS Code などのネイティブクライアントが使う）。フラグメント付き・それ以外のスキームは拒否。
- `client_name` は最大 100 文字。未指定なら「名称未設定のアプリ」と表示する。**名前は自己申告であり信用しない**（§8.9）。

### 8.5.2 認可リクエスト（SC-20）

1. クライアントがブラウザで `/oauth/authorize?response_type=code&client_id&redirect_uri&code_challenge&code_challenge_method=S256&state&scope&resource` を開く。
2. 未ログインなら既存の `RequireAuth` が `/login?next=…` に送り、ログイン後に同意画面へ戻る（`safeNextPath` で同一オリジンのみ）。
3. SPA が `GET /api/v1/oauth/authorize` で検証。**`client_id` 不明・`redirect_uri` 未登録の場合はリダイレクトせずエラー表示**（オープンリダイレクト防止、RFC 6749 §4.1.2.1）。それ以外の不備（PKCE なし、`response_type` 不一致、未知のスコープ等）は `redirect_uri` へ `error=` 付きで返すが、**自動では遷移せず、戻り先ホストを示した「アプリに戻る」ボタンを押してもらう**（動的登録は誰でもできるため、自動遷移だと TRAKON のドメインが任意サイトへのオープンリダイレクタになる。RFC 9700 §4.11.2）。
4. 画面には「アプリ名（自己申告）」「戻り先のホスト名」「許可する内容（スコープ）」「ログイン中のアカウント」を表示する。
5. 許可 → `POST /api/v1/oauth/authorize` が認可コードを発行し、`redirect_uri?code=…&state=…&iss=…` を返す。SPA がそこへ遷移する。拒否 → `error=access_denied`。

### 8.5.3 トークン

| 種類 | 形式 | 有効期間 | 保管 |
|---|---|---|---|
| 認可コード | `trk_ac_` + 32 バイト乱数（base64url） | 10 分・1 回限り | SHA-256 のみ |
| アクセストークン | `trk_at_` + 32 バイト乱数 | **1 時間** | SHA-256 のみ |
| リフレッシュトークン | `trk_rt_` + 32 バイト乱数 | **90 日**（使うたびに延長） | SHA-256 のみ |

- 認可コードの交換では **PKCE（S256）必須**、`redirect_uri`・`client_id`・`resource` の一致を検証する。使用済みコードの再提示は拒否。
- **リフレッシュトークンはローテーション**する（使うたびに新しいペアを発行し、古いものは即無効）。同時リクエストは `UPDATE … WHERE refresh_token_hash = 旧` の件数で 1 つだけ勝たせる。
- **オーディエンス束縛（RFC 8707）**：トークンには発行時の `resource`（= その環境の `/api/mcp` の URL）を記録し、MCP エンドポイントは自分の URL と一致しないトークンを拒否する。
- 1 回の認可（同意）＝ 1 つの「接続（grant）」。SC-21 から接続単位で失効できる。退会済みユーザーのトークンは無効。

### 8.5.4 スコープ

| スコープ | 許可するツール |
|---|---|
| `read` | 読み取り系（§8.7.1） |
| `write` | 書き込み系（§8.7.2） |

- スコープ未指定のリクエストは `read write` として扱う。
- **知らないスコープは拒否せず無視する**（RFC 6749 §3.3）。ChatGPT はリフレッシュトークンを得るために `offline_access` を付けてくるため、拒否すると接続できない。無視しても権限は増えない。`read` / `write` が 1 つも残らなければ `read write` として扱う。
- 認可サーバメタデータの `scopes_supported` には `offline_access` も載せる（リフレッシュトークンを出すことの表明。TRAKON は要求の有無によらず常に出す）。
- **スコープに含まれないツールは `tools/list` に出さない**（AI に「使えない道具」を見せない）。

---

## 8.6 データモデル

マイグレーション `20261121000001_add_mcp_oauth`。既存の `oauth_identities`（Google / Microsoft ログイン）と混同しないよう、すべて `mcp_` 接頭辞にする。

### `mcp_clients` — 動的登録されたクライアント

| 列 | 型 | 説明 |
|---|---|---|
| id | uuid PK | **これが `client_id`** |
| client_name | text NOT NULL | 自己申告の名称（≤100） |
| redirect_uris | text[] NOT NULL | 登録済み戻り先 |
| created_at | timestamptz | |

### `mcp_authorization_codes` — 認可コード

| 列 | 型 | 説明 |
|---|---|---|
| id | uuid PK | |
| code_hash | text UNIQUE | SHA-256 |
| client_id | uuid FK → mcp_clients | ON DELETE CASCADE |
| user_id | uuid FK → users | ON DELETE CASCADE |
| redirect_uri / code_challenge / scope / resource | text | 交換時に照合 |
| expires_at / consumed_at / created_at | timestamptz | |

### `mcp_grants` — 接続（同意 1 回につき 1 行）

| 列 | 型 | 説明 |
|---|---|---|
| id | uuid PK | SC-21 の行 |
| client_id | uuid FK → mcp_clients | ON DELETE CASCADE |
| user_id | uuid FK → users | ON DELETE CASCADE |
| scope / resource | text | |
| access_token_hash | text UNIQUE | 現在有効なアクセストークン |
| access_token_expires_at | timestamptz | |
| refresh_token_hash | text UNIQUE | 現在有効なリフレッシュトークン |
| refresh_token_expires_at | timestamptz | |
| last_used_at | timestamptz NULL | MCP 呼び出し時に更新（5 分以内の再更新は省略） |
| revoked_at | timestamptz NULL | 失効（SC-21 / revoke エンドポイント） |
| created_at | timestamptz | |

`audit_logs.action` に `mcp_connected`（同意してトークンを発行）・`mcp_revoked`（接続解除）を追加する。

---

## 8.7 MCP ツール仕様

共通事項：

- 入力は Zod で定義し、`tools/list` には JSON Schema として出る。説明文は**日本語**で、AI が正しく使えるよう前提（ID の取り方・日付の書式・JST）を書く。
- 出力は `structuredContent`（JSON）と、同じ内容のテキスト（JSON 文字列）を返す。
- REST が 4xx を返したら **`isError: true` のツール結果**として `コード: メッセージ` を返す（AI が理由を読んで言い直せるようにする。例：`PLAN_OUT_OF_PROJECT_PERIOD`、`NOT_FOUND`、`SUBSCRIPTION_READ_ONLY`）。
- 予定の出力は AI のコンテキストを節約するため要約形（id・制作物・タイトル・カテゴリ・日付・3 役割の id と名前・ボール保持者・状態・後続・メモ）にする。

### 8.7.1 読み取り（scope: `read`、`readOnlyHint: true`）

| ツール | 入力 | 呼ぶ REST | 出力 |
|---|---|---|---|
| `list_projects` | `archived?` | `GET /projects?limit=200` | `today`、プロジェクト一覧（id・名前・クライアント名・期間・自分のロール） |
| `get_project` | `projectId` | `GET /projects/:id`・`/items`・`/members` | プロジェクト概要、制作物（id・名前）、参加者（id・名前・区分・ロール・**`isMe`**）。`isMe` は接続した本人の参加者行で、同名の参加者がいても「自分の担当で」を取り違えないために返す |
| `list_plans` | `projectId`, `from?`, `to?`, `itemId?`, `memberId?` | `GET /projects/:id/plans` | `today`、予定一覧（`memberId` はいずれかの役割またはボール保持者に一致） |
| `get_plan` | `projectId`, `planId` | `GET …/items/:itemId/plans/:planId` | 予定 + ボールの履歴 |
| `get_my_dashboard` | — | `GET /users/me/dashboard` | 今日の自分のボール（本人がボールを持つ予定だけ）。件数 `myTaskCount` / `myOverdueCount` も**本人の分だけ数え直す**（REST の `summary` は参加プロジェクト全員の合計で、そのまま渡すと AI が「あなたには N 件」と誤読するため） |

### 8.7.2 書き込み（scope: `write`）

| ツール | 入力 | 呼ぶ REST | 注意 |
|---|---|---|---|
| `create_item` | `projectId`, `name` | `POST /projects/:id/items` | 編集者以上 |
| `create_plan` | `projectId`, `itemId`, `title`, `category`, `scheduledDate`, `dueDate?`, `executorMemberId?`, `approverMemberId?`, `progressManagerMemberId?`, `memo?`, `colorTheme?`, `successorPlanId?` | `POST …/items/:itemId/plans` | プロジェクト期間外は `PLAN_OUT_OF_PROJECT_PERIOD` |
| `update_plan` | `projectId`, `planId`, 変更する項目のみ（`null` で解除）。`successorPlanId` で後続予定の紐付け・解除 | `PATCH …/plans/:planId`、後続は `PATCH …/plans/:planId/successor` | `itemId` 指定で別制作物へ移動（後続のつながりは外れる）。**移動と後続の同時指定はツール側で拒否**（REST は移動時に後続を黙って捨てるため） |
| `delete_plan` | `projectId`, `planId` | `DELETE …/plans/:planId` | `destructiveHint: true`。論理削除で、ボールの履歴は残る（#205） |
| `ball_action` | `projectId`, `planId`, `action`, `note?` | `POST …/plans/:planId/{action}` | `action` = `request_review` / `request_review_undo` / `approve` / `approve_undo` / `send_back` / `send_back_to_predecessor` / `toss` / `toss_undo`。TOSS は管理者のみ（既存仕様）。通知メールも画面操作と同じく送られる |

**後続予定（`successorPlanId`）**：先行予定が承認されたあと、進行責任者の TOSS でボールが渡る先（#131）。規則は REST がそのまま持つ — 同じ制作物の予定のみ（`SUCCESSOR_OUT_OF_SCOPE`）、1 つの予定を後続にできる先行予定は 1 つだけ（`SUCCESSOR_ALREADY_USED`）、自分自身は不可。AI が「ワイヤー → デザイン → コーディング」のような流れを組めるよう、サーバの案内文にもこの規則を書く。

**後続は専用エンドポイント（`/successor`）で付け替える**。一般の更新（`PATCH …/plans/:planId`）は「実施中」の予定にしか効かない（`PLAN_NOT_ACTIVE`）が、後続は**承認済み＝TOSS 待ちの予定にこそ必要**になるため、画面の「つなぐ」操作と同じ経路を使う。ほかの項目と一緒に頼まれたときは「一般の更新 → 後続」の順に 2 回呼び、後続だけ失敗したら「ほかの項目は反映済み」と添えて返す。

`planId` だけで操作できるよう、MCP 側で `planId` → `itemId` を解決してから REST を呼ぶ（**解決は `projectId` 配下に限定**。参加していなければ REST の 404 集約がそのまま効くので、存在の有無は漏れない）。

---

## 8.8 内部ディスパッチと認可

```
POST /api/mcp
  └ requireMcpToken()          … Bearer を mcp_grants で照合（ハッシュ・期限・失効・resource・退会）
       └ McpServer (リクエストごとに生成・破棄)
            └ tool handler
                 └ dispatch(new Request('/api/v1/…'))  ─▶ app.fetch()
                        └ requireAuth()  … 内部 Request なら JWT 検証の代わりに MCP の本人情報を採用
                        └ attachCurrentUserId() → requireProjectMember() → requireProjectWritable() → requireProjectAction() → service
```

- **内部 Request の識別**：MCP 側で生成した `Request` オブジェクトを `WeakMap<Request, AuthenticatedUser>` に登録し、`requireAuth()` は `c.req.raw` がそこに登録されているときだけ JWT 検証を省いて本人情報を採用する。**外部から届く Request は別オブジェクトなので、ヘッダをどう細工してもこの経路には入れない。**
- 以降のミドルウェア・サービス・監査ログはすべて画面からの操作と同一。監査ログの `actor_user_id` は接続したユーザー本人になる（「誰の操作か」は AI 経由でも変わらない）。
- 内部 Request の URL は MCP リクエストと同じオリジンで組み立てる（通知メールのリンクが正しいドメインを指すため）。

---

## 8.9 セキュリティ

| 脅威 | 対策 |
|---|---|
| トークン漏えい | DB はハッシュのみ。アクセストークン 1 時間。リフレッシュはローテーション。SC-21 から即時失効 |
| 認可コード横取り | PKCE S256 必須、コード 10 分・1 回限り、`redirect_uri` 完全一致 |
| オープンリダイレクト | 未登録 `redirect_uri` には絶対にリダイレクトしない。登録時に https / loopback 以外を拒否。リクエスト不備のエラー応答も自動遷移させず、利用者のクリックを挟む |
| なりすましアプリ（DCR は誰でも登録できる） | 同意画面に**戻り先ホスト名を明示**し、アプリ名は「自己申告」と表示。許可しない限りトークンは出ない |
| 別環境向けトークンの流用 | `resource` によるオーディエンス束縛（§8.5.3） |
| 権限昇格 | ツールは REST を経由するだけで、ロール・凍結・課金判定を一切バイパスしない（D4/D5）。スコープ外のツールは提示もしない |
| 情報の外部送信 | 同意画面で「予定・参加者名などが接続先の AI サービスに送られる」ことを明示（SR-PRIVACY-01）。メールアドレスは予定 DTO に含めない（既存方針） |
| AI の誤操作 | 削除ツールに `destructiveHint`。主要クライアントは書き込み系ツールの実行前に利用者の確認を挟む。操作は監査ログと ball_events に残り、ボール操作は取り消しツールで戻せる |
| DCR の乱用 | 入力長・件数の上限。未使用クライアントの定期削除は §8.13 |

---

## 8.10 画面

| ID | パス | 内容 |
|---|---|---|
| SC-20 | `/oauth/authorize` | 同意画面。サイドバーなしの中央カード。アプリ名・戻り先ホスト・許可内容・ログイン中アカウント・「許可する／拒否する」 |
| SC-21 | `/settings/ai` | AI 連携。MCP サーバ URL（コピー）、SC-22 の各節へのリンク、接続中アプリ一覧（アプリ名・接続日・最終利用・権限）と「接続を解除」 |
| SC-22 | `/help/ai` | **AI 連携の設定方法（ログイン不要の公開ページ）**。設定の流れ・接続先 URL・サービス別の手順（コマンドや設定例はコピー可、`#claude` などのアンカーで直接開ける）・話しかけ方の例・安全について・うまくいかないとき |

サイドバーのアカウントメニューに「AI 連携」（SC-21）を追加する。SC-22 は SC-21 と、同意画面 SC-20 のエラー表示からリンクする。

**SC-22 を公開ページにする理由**：AI サービス側の設定は、ChatGPT のワークスペース管理者や Claude の組織オーナーなど、TRAKON のアカウントを持たない人が行うことがある。載せる情報（MCP サーバ URL と手順）は秘密ではない。

---

## 8.11 クライアント別の接続手順（利用者向け）

利用者向けの手順は SC-22（`/help/ai`）に載せ、**内容の正は `apps/web/src/features/aiConnections/aiGuides.ts`** とする（画面とずれないよう、本書には要点だけを置く）。各社の公式ドキュメントで 2026 年 11 月に確認した。

| クライアント | 対象プラン・前提 | 手順の要点 | OAuth の選択 |
|---|---|---|---|
| Claude（claude.ai・デスクトップ） | Free（1 つまで）/ Pro / Max / Team / Enterprise | `Customize` → `Connectors` → `+ Add` → `Add custom connector`。Team / Enterprise はオーナーが `Organization settings` → `Connectors` で追加し、各メンバーが `Connect` | `Register automatically`（DCR） |
| Claude Code | — | `claude mcp add --transport http trakon <URL>` → `/mcp` | 自動（DCR） |
| ChatGPT | Business / Enterprise / Edu の Web 版（Pro は閲覧系のみ、モバイル不可）。Business は管理者・オーナーが追加 | `chatgpt.com/plugins` → `+` → `Add custom MCP server` → 認証 `OAuth` → `Create as a plugin` → インストール。チャットでは `@` で選ぶ | OAuth（`offline_access` を付けてくる → §8.5.4） |
| Gemini CLI | — | `settings.json` の `mcpServers` に `{"trakon": {"httpUrl": "<URL>"}}` → `/mcp auth trakon` | 自動（DCR） |
| GitHub Copilot（VS Code） | 組織ポリシーで制限される場合あり | `MCP: Add Server` → `HTTP` → `Global` / `Copilot Global` → `Authenticate`。ファイルなら `~/.copilot/mcp-config.json` の `mcpServers` | 自動（DCR） |
| Microsoft Copilot Studio | Power Platform のデータポリシー対象 | `Tools` → `Add a tool` → `New tool` → `Model Context Protocol` | `OAuth 2.0` → `Dynamic discovery` |

- 画面の名称は各社の更新で変わりやすい。**ボタン名は英語表示のラベルをそのまま書く**（日本語表示の訳語は確認できないため）。
- Claude の `Use Claude's published identity` と、ChatGPT が対応する CIMD（Client ID Metadata Documents）には TRAKON はまだ対応していない（§8.13）。手順では DCR を使う選択肢を案内する。
- **実際の各サービスからの接続は、本番環境（外部から到達できる環境）でしか確認できない**。リリース後に確認し、手順と食い違えば `aiGuides.ts` を直す。

---|---|
| Claude（claude.ai / デスクトップ / モバイル） | 設定 → コネクタ → カスタムコネクタを追加 → URL を貼る → 「連携」で TRAKON の同意画面が開く |
| Claude Code | `claude mcp add --transport http trakon <URL>` → `/mcp` で認証 |
| ChatGPT | 設定 → アプリとコネクタ（開発者モード）→ 作成 → URL を貼り、認証に OAuth を選ぶ |
| Gemini CLI | `~/.gemini/settings.json` の `mcpServers` に `{"trakon": {"httpUrl": "<URL>"}}` → `/mcp auth trakon` |
| GitHub Copilot（VS Code） | `.vscode/mcp.json` に `{"servers": {"trakon": {"type": "http", "url": "<URL>"}}}` → 起動時に認証 |
| Microsoft Copilot Studio | ツール追加 → MCP → URL を指定し、認証に OAuth 2.0（動的検出）を選ぶ |

各社の画面名称は変わりやすいため、SC-21 の文言は「URL を貼り付けて OAuth で接続」を主にし、個別手順は補足に留める。

---

## 8.12 テストと運用

- **単体**：トークン・PKCE・redirect_uri 検証、OAuth エンドポイント（Prisma をモック）、MCP ツール（ディスパッチをモックして REST 呼び出しとエラー変換を検証）、`requireAuth()` の内部 Request 判定。
- **結合（実 DB）**：DCR → 同意 → トークン交換 → `tools/list` → `create_plan` → リフレッシュのローテーション → 失効、までを 1 本で通す。
- **手動確認**：MCP Inspector（`npx @modelcontextprotocol/inspector`）で Preview 環境に接続。
- **デプロイ**：マイグレーションは追加のみ（既存行への影響なし）。新しい環境変数は不要。

---

## 8.13 今後（Phase 外）

| 項目 | 内容 |
|---|---|
| 組織による許可制（SR-EXT-01） | 組織オーナー／管理者が AI 連携を ON/OFF できる設定。OFF にすると組織配下プロジェクトへのツール呼び出しを 403 にし、既存接続も無効化。`organization_settings`（Phase 2）と併せて実装 |
| 監査の経路区別 | 監査ログ・ball_events に「AI 連携経由（クライアント名）」を残す |
| レート制限 | 接続単位のリクエスト上限（AI の暴走ループ対策）。Phase 1 のレート制限基盤と併せて |
| CIMD | Client ID Metadata Documents（MCP 仕様 2025-11-25 で推奨）への対応。DCR の乱用対策にもなる |
| 未使用クライアントの掃除 | 接続が 1 件も無いまま 30 日経った `mcp_clients` を削除する定期ジョブ |
| ツール追加 | プロジェクト作成、参加者の追加、予定の一括登録（テンプレート展開） |
