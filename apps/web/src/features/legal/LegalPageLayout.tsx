import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

// =============================================================================
// 法務ページ (利用規約 / プライバシーポリシー / 特定商取引法に基づく表記) 共通レイアウト。
// 未ログインでも閲覧できる公開ページ。App.tsx で RequireAuth の外側にルート登録する。
// =============================================================================

export function LegalPageLayout({
  title,
  meta,
  children,
}: {
  title: string;
  /** 会社名・施行日などのサブタイトル行。特商法ページなど不要な場合は省略。 */
  meta?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} – TRAKON`;
    return () => {
      document.title = prev;
    };
  }, [title]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link to="/login" className="text-lg font-extrabold tracking-[0.2em]">
            TRAKON
          </Link>
          <Link
            to="/login"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <span aria-hidden>←</span> ログインに戻る
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {meta && <p className="mt-2 text-sm text-muted-foreground">{meta}</p>}
        <div className="mt-8">{children}</div>
        <LegalFooter />
      </main>
    </div>
  );
}

function LegalFooter() {
  return (
    <footer className="mt-12 border-t border-border pt-6">
      <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
        <Link to="/terms" className="underline-offset-4 hover:text-foreground hover:underline">
          利用規約
        </Link>
        <Link to="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">
          プライバシーポリシー
        </Link>
        <Link to="/commerce" className="underline-offset-4 hover:text-foreground hover:underline">
          特定商取引法に基づく表記
        </Link>
      </nav>
      <p className="mt-4 text-xs text-muted-foreground">© 2026 株式会社おさまるカンパニー</p>
    </footer>
  );
}

// -----------------------------------------------------------------------------
// 本文用プリミティブ
// -----------------------------------------------------------------------------

/** 条見出し (第N条) + 本文のまとまり。 */
export function LegalArticle({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="mb-3 text-base font-semibold text-foreground">{title}</h2>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

/** 段落 / 番号付き条項 (テキスト側に「1．」等の番号を含める)。 */
export function LegalP({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-foreground/85">{children}</p>;
}

/** 中黒箇条書き。 */
export function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-foreground/85">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

/** ラベル + 内容の定義リスト (特商法表記・問い合わせ窓口など)。 */
export function LegalDefList({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {rows.map((r) => (
        <div
          key={r.label}
          className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4"
        >
          <dt className="text-sm font-medium text-foreground">{r.label}</dt>
          <dd className="text-sm leading-relaxed text-foreground/85">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
