import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Copy, ExternalLink, MessageSquareText, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Wordmark } from '@/components/trakon/Wordmark';

import {
  AI_GUIDES,
  EXAMPLE_PROMPTS,
  GUIDE_CHECKED_AT,
  fillUrl,
  type AiGuide,
  type GuideStep,
} from './aiGuides';
import { mcpServerUrl } from './api';

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('コピーしました');
  } catch {
    toast.error('コピーに失敗しました');
  }
}

/** コマンド・URL・設定ファイルの例。横にはみ出さないよう折り返し、右上からコピーできる */
function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative mt-2">
      <pre className="overflow-x-auto rounded-md border border-border-subtle bg-surface-subtle py-2.5 pr-12 pl-3 font-mono text-label whitespace-pre-wrap break-all">
        {code}
      </pre>
      <Button
        variant="ghost"
        size="icon-sm"
        className="absolute top-0.5 right-0.5"
        aria-label={`${label}をコピー`}
        onClick={() => copyText(code)}
      >
        <Copy className="size-4" />
      </Button>
    </div>
  );
}

function Step({ step, url, label }: { step: GuideStep; url: string; label: string }) {
  return (
    <>
      <p>{fillUrl(step.text, url)}</p>
      {step.code && <CodeBlock code={fillUrl(step.code, url)} label={label} />}
    </>
  );
}

function GuideSection({ guide, url }: { guide: AiGuide; url: string }) {
  return (
    <Card id={guide.id} className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="text-heading-section">{guide.name}</CardTitle>
        <CardDescription>{guide.availability}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-body">
        <ol className="space-y-3">
          {guide.steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span
                aria-hidden
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-label font-bold"
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <Step step={step} url={url} label={`${guide.name}の手順 ${i + 1}`} />
              </div>
            </li>
          ))}
        </ol>

        {guide.alternative && (
          <div className="text-text-secondary">
            <Step step={guide.alternative} url={url} label={`${guide.name}の設定例`} />
          </div>
        )}

        <div className="rounded-md bg-surface-subtle px-3 py-2.5">
          <p className="font-medium">使い方</p>
          <p className="text-text-secondary">{guide.usage}</p>
        </div>

        {guide.notes && (
          <ul className="list-disc space-y-1 pl-5 text-text-secondary">
            {guide.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}

        <a
          href={guide.docs.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-label underline underline-offset-2"
        >
          {guide.docs.label}（公式・英語）
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </CardContent>
    </Card>
  );
}

const TROUBLESHOOTING: { q: string; a: string }[] = [
  {
    q: 'TRAKON のログイン画面が開いた',
    a: 'いつもの方法で TRAKON にログインすると、許可の画面に進みます。TRAKON のパスワードが AI サービスに渡ることはありません。',
  },
  {
    q: '「この接続は続けられません」と表示された',
    a: 'AI サービスに入力した URL が正しいか（/api/mcp まで含むか）を確認し、AI サービス側で接続をやり直してください。',
  },
  {
    q: '予定を作れない・「見つからない」と言われる',
    a: 'AI からできる操作は、そのプロジェクトでのあなたの権限と同じです。閲覧者の権限では予定を作れません。また、参加していないプロジェクトは見えません。',
  },
  {
    q: '「プロジェクト期間外」と言われる',
    a: '予定はプロジェクトの期間内にしか入れられません。日付を見直すか、プロジェクトの期間を画面から変更してください。',
  },
  {
    q: '「閲覧のみ」と言われて変更できない',
    a: 'ご契約のプランの状態によって、プロジェクトが閲覧のみになっていることがあります。TRAKON の「プラン・お支払い」をご確認ください。',
  },
  {
    q: 'しばらくして使えなくなった',
    a: '接続を解除したか、長い間（90 日）使わなかった可能性があります。AI サービス側でもう一度接続してください。',
  },
];

/**
 * SC-22 AI 連携の設定方法 (`/help/ai`) — 設計書 08-mcp §8.10 / §8.11
 *
 * **ログイン不要の公開ページ。** AI サービス側の設定は、ChatGPT のワークスペース管理者や
 * Claude の組織オーナーなど、TRAKON のアカウントを持っていない人が行うこともあるため。
 * 表示している情報 (MCP サーバの URL と手順) は秘密ではない。
 */
export function AiSetupGuidePage() {
  const url = mcpServerUrl();
  const { hash } = useLocation();

  // `/help/ai#chatgpt` のようなリンクで開いたとき、その節まで移動する
  useEffect(() => {
    if (!hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border-subtle">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" aria-label="TRAKON トップへ">
            <Wordmark size="sm" />
          </Link>
          <Button asChild variant="secondary" size="sm">
            <Link to="/settings/ai">接続中のアプリを管理</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
        <div className="space-y-2">
          <h1 className="text-heading-page font-bold">AI 連携の設定方法</h1>
          <p className="text-body text-text-secondary">
            Claude や ChatGPT などの AI アシスタントに TRAKON
            をつなぐと、話しかけるだけで予定の確認・登録・変更や、ボールの受け渡しができるようになります。
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-heading-section">設定の流れ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-body">
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                AI サービスの設定で、次の URL を「カスタムコネクタ」「MCP サーバ」として追加します。
              </li>
              <li>TRAKON の画面が開いたら、接続先とできることを確認して「許可する」を押します。</li>
              <li>AI サービスのチャットで TRAKON をオンにして話しかけます。</li>
            </ol>
            <div>
              <p className="font-medium">接続先 URL</p>
              <div className="mt-1 flex items-start gap-2">
                <code className="min-w-0 flex-1 rounded-md break-all border border-border-subtle bg-surface-subtle px-3 py-2 font-mono">
                  {url}
                </code>
                <Button
                  variant="secondary"
                  onClick={() => copyText(url)}
                  aria-label="接続先 URL をコピー"
                >
                  <Copy className="size-4" />
                  コピー
                </Button>
              </div>
            </div>
            <nav aria-label="AI サービス別の手順">
              <p className="font-medium">サービス別の手順</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {AI_GUIDES.map((g) => (
                  <li key={g.id}>
                    <a
                      href={`#${g.id}`}
                      className="inline-block rounded-full border border-border px-3 py-1 text-label hover:bg-surface-subtle"
                    >
                      {g.name}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </CardContent>
        </Card>

        {AI_GUIDES.map((g) => (
          <GuideSection key={g.id} guide={g} url={url} />
        ))}

        <p className="text-label text-text-tertiary">
          手順は {GUIDE_CHECKED_AT}
          時点の各社の公式ドキュメントにもとづいています。各サービスの画面の名称は更新で変わることがあるため、ボタン名は英語表示のまま記載しています。最新の手順は各公式ドキュメントをご確認ください。
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-heading-section">
              <MessageSquareText className="size-5" aria-hidden />
              こんなふうに話しかけられます
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-body">
              {EXAMPLE_PROMPTS.map((p) => (
                <li key={p} className="rounded-md bg-surface-subtle px-3 py-2">
                  {p}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-heading-section">
              <ShieldCheck className="size-5" aria-hidden />
              安全にお使いいただくために
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1.5 pl-5 text-body">
              <li>
                AI
                からできる操作は、あなたが参加しているプロジェクトと、そこでのあなたの権限の範囲に限られます。
              </li>
              <li>
                予定や参加者の名前などの情報が、接続先の AI
                サービスに送られます。メールアドレスは送りません。
              </li>
              <li>AI 経由の操作も、画面からの操作と同じくあなたの名前で履歴に残ります。</li>
              <li>
                接続はいつでも
                <Link to="/settings/ai" className="underline underline-offset-2">
                  「AI 連携」設定
                </Link>
                から解除できます。
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-heading-section">うまくいかないとき</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4 text-body">
              {TROUBLESHOOTING.map((t) => (
                <div key={t.q}>
                  <dt className="font-medium">{t.q}</dt>
                  <dd className="text-text-secondary">{t.a}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
