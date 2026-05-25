import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';

type TrakonProvider = 'google' | 'azure';

/**
 * Google / Microsoft の OAuth ログインボタン。
 * Supabase SDK の signInWithOAuth が PKCE / state を内部処理し、
 * /auth/callback にリダイレクトしてくる (AuthCallbackPage が sync を呼ぶ)。
 */
export function OAuthButtons() {
  const [busy, setBusy] = useState<TrakonProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (provider: TrakonProvider) => {
    setBusy(provider);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
      },
    });
    if (err) {
      setError('OAuth プロバイダへの遷移に失敗しました。時間をおいて再度お試しください。');
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <Divider />
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={busy !== null}
        onClick={() => start('google')}
      >
        <GoogleMark />
        Google で続ける
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={busy !== null}
        onClick={() => start('azure')}
      >
        <MicrosoftMark />
        Microsoft で続ける
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      または
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 11v3.6h5.04c-.22 1.16-1.45 3.4-5.04 3.4-3.04 0-5.51-2.52-5.51-5.6S8.96 6.8 12 6.8c1.73 0 2.89.74 3.55 1.37L18.2 5.6C16.55 4.06 14.47 3.2 12 3.2 7.13 3.2 3.2 7.13 3.2 12s3.93 8.8 8.8 8.8c5.08 0 8.45-3.57 8.45-8.59 0-.57-.06-1.01-.14-1.45H12z"
      />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  );
}
