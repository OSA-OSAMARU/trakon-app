# TRAKON メールテンプレート集

TRAKON が送るメールの **件名・本文** を一元管理する。トーンは PRD UXR-05「煽らず濁さず逃げない」に従い、落ち着いた・明確・正直な言葉づかいにする。

- **招待メール**はコードで送信（`apps/web/server/lib/mailer.ts`）。本ファイルは設計の正本ではなく、トーン統一のための参照。
- **認証メール**（サインアップ確認 / Magic Link / パスワード再設定 / メール変更）は **Supabase Dashboard → Authentication → Email Templates** に貼り付ける。設定手順は [operations.md §2.4.2](operations.md#242-supabase-custom-smtp認証メールを-resend-経由にする)。

> Supabase テンプレートの変数（Go template）：`{{ .ConfirmationURL }}`（アクションリンク）、`{{ .Token }}`（6 桁 OTP）、`{{ .SiteURL }}`、`{{ .Email }}`。
> 共通デザイン：最大幅 560px / 本文色 `#0f172a` / ボタン背景 `#030213`・角丸 8px。招待メール（`mailer.ts`）と揃える。

---

## 共通の送信者（from）

Supabase → Authentication → Emails → SMTP Settings → Sender に設定（認証メール共通）：

```
表示名: TRAKON
メール: noreply@trakon.example.com   ← 実ドメインに置換
```

招待メール（アプリ独自）は Vercel Env `RESEND_FROM_EMAIL` で設定：

```
RESEND_FROM_EMAIL=TRAKON <noreply@trakon.example.com>
```

> ドメインは Resend で **SPF / DKIM 検証済み**であること（未検証だと迷惑メール判定・送信失敗）。

---

## 1. サインアップ確認（Confirm signup）

**件名:**

```
TRAKON へのご登録を完了してください
```

**本文（HTML）:**

```html
<!doctype html>
<html lang="ja">
  <body style="font-family:-apple-system,'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;color:#0f172a;line-height:1.7;background:#f8fafc;margin:0;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
      <p style="font-size:13px;letter-spacing:.08em;color:#64748b;margin:0 0 16px">TRAKON</p>
      <h1 style="font-size:18px;margin:0 0 16px">ご登録ありがとうございます</h1>
      <p style="margin:0 0 24px;color:#475569;font-size:14px">下のボタンからメールアドレスを確認し、登録を完了してください。</p>
      <p style="margin:0 0 24px">
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 20px;background:#030213;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">メールアドレスを確認する</a>
      </p>
      <p style="font-size:12px;color:#94a3b8;margin:0 0 8px">ボタンが開けない場合は、次の URL をブラウザに貼り付けてください:<br/>{{ .ConfirmationURL }}</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
      <p style="font-size:12px;color:#94a3b8;margin:0">お心当たりがない場合は、このメールを破棄していただいて問題ありません。<br/>— TRAKON</p>
    </div>
  </body>
</html>
```

---

## 2. ログインリンク（Magic Link）

**件名:**

```
TRAKON へのログインリンク
```

**本文（HTML）:**

```html
<!doctype html>
<html lang="ja">
  <body style="font-family:-apple-system,'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;color:#0f172a;line-height:1.7;background:#f8fafc;margin:0;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
      <p style="font-size:13px;letter-spacing:.08em;color:#64748b;margin:0 0 16px">TRAKON</p>
      <h1 style="font-size:18px;margin:0 0 16px">ログインリンクをお送りします</h1>
      <p style="margin:0 0 24px;color:#475569;font-size:14px">下のボタンから TRAKON にログインできます。このリンクは一定時間で無効になります。</p>
      <p style="margin:0 0 24px">
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 20px;background:#030213;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">ログインする</a>
      </p>
      <p style="font-size:12px;color:#94a3b8;margin:0 0 8px">ボタンが開けない場合は、次の URL をブラウザに貼り付けてください:<br/>{{ .ConfirmationURL }}</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
      <p style="font-size:12px;color:#94a3b8;margin:0">心当たりがない場合は、このメールを破棄してください。第三者があなたのメールアドレスを入力した可能性があります。<br/>— TRAKON</p>
    </div>
  </body>
</html>
```

---

## 3. パスワード再設定（Reset Password）

**件名:**

```
TRAKON のパスワード再設定
```

**本文（HTML）:**

```html
<!doctype html>
<html lang="ja">
  <body style="font-family:-apple-system,'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;color:#0f172a;line-height:1.7;background:#f8fafc;margin:0;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
      <p style="font-size:13px;letter-spacing:.08em;color:#64748b;margin:0 0 16px">TRAKON</p>
      <h1 style="font-size:18px;margin:0 0 16px">パスワードを再設定します</h1>
      <p style="margin:0 0 24px;color:#475569;font-size:14px">下のボタンから新しいパスワードを設定してください。このリンクは一定時間で無効になります。</p>
      <p style="margin:0 0 24px">
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 20px;background:#030213;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">パスワードを再設定する</a>
      </p>
      <p style="font-size:12px;color:#94a3b8;margin:0 0 8px">ボタンが開けない場合は、次の URL をブラウザに貼り付けてください:<br/>{{ .ConfirmationURL }}</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
      <p style="font-size:12px;color:#94a3b8;margin:0">再設定をご依頼していない場合は、このメールを破棄してください。パスワードは変更されません。<br/>— TRAKON</p>
    </div>
  </body>
</html>
```

---

## 4. メールアドレス変更の確認（Change Email Address）

`config.toml` で `double_confirm_changes = true` のため、新旧アドレス両方に確認メールが届く。

**件名:**

```
TRAKON のメールアドレス変更の確認
```

**本文（HTML）:**

```html
<!doctype html>
<html lang="ja">
  <body style="font-family:-apple-system,'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;color:#0f172a;line-height:1.7;background:#f8fafc;margin:0;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
      <p style="font-size:13px;letter-spacing:.08em;color:#64748b;margin:0 0 16px">TRAKON</p>
      <h1 style="font-size:18px;margin:0 0 16px">メールアドレスの変更を確認します</h1>
      <p style="margin:0 0 24px;color:#475569;font-size:14px">下のボタンからメールアドレスの変更を確定してください。</p>
      <p style="margin:0 0 24px">
        <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 20px;background:#030213;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">変更を確定する</a>
      </p>
      <p style="font-size:12px;color:#94a3b8;margin:0 0 8px">ボタンが開けない場合は、次の URL をブラウザに貼り付けてください:<br/>{{ .ConfirmationURL }}</p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0"/>
      <p style="font-size:12px;color:#94a3b8;margin:0">お心当たりがない場合は、このメールを破棄し、アカウントのパスワード変更をご検討ください。<br/>— TRAKON</p>
    </div>
  </body>
</html>
```

---

## 招待メール（参考 / 実体はコード）

実体は `apps/web/server/lib/mailer.ts`。件名・本文を変更する場合はコードを編集する。

- 件名: `「{プロジェクト名}」への参加のご案内 | TRAKON`
- 差出人: `RESEND_FROM_EMAIL`
