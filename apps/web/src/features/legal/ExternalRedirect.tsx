import { useEffect } from 'react';

import { externalRedirect } from '@/lib/navigate';

/**
 * 外部サイトへ即座に送るルート要素 (#193)。
 *
 * アプリ内に置いていた法務ページを公式サイトへ寄せた際、旧パスを行き止まりに
 * しないために使う。JavaScript が動く前提の SPA なので `<meta refresh>` ではなく
 * effect で遷移し、遷移が走らなかった場合のために手動のリンクも出しておく。
 */
export function ExternalRedirect({ href, label }: { href: string; label: string }) {
  useEffect(() => {
    externalRedirect(href);
  }, [href]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <p className="text-body text-text-secondary">
        {label}は公式サイトへ移動しました。
        <a href={href} className="text-foreground ml-1 underline underline-offset-2">
          自動で移動しない場合はこちら
        </a>
      </p>
    </main>
  );
}
