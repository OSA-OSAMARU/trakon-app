/**
 * 認証後の戻り先 (`?next=`) の取り扱い (#231)。
 *
 * 招待リンク (`/invitations/:token`) を踏んだ未ログインの人をログイン画面へ送り、
 * 認証が終わったら**招待の続きに戻す**ために使う。以前は `next` を付けてはいたが
 * どこも読んでおらず、ログイン後は必ず `/dashboard` に着地して招待が迷子になっていた。
 *
 * 値は URL から来る = 利用者が書き換えられるので、そのまま遷移してはいけない。
 * 同一オリジンのパスだけを通し、それ以外は捨てる (オープンリダイレクト防止)。
 */

/** 認証後に戻る既定の場所 */
export const DEFAULT_AFTER_AUTH_PATH = '/dashboard';

/**
 * `next` として安全に遷移できるパスなら返す。そうでなければ null。
 *
 * 通すのは `/path` 形式のみ。`//evil.example` や `https://…` は他サイトへ出てしまうため弾く。
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  // `%2F%2Fevil` のような符号化済みの値も展開してから判定する
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // 不正なエスケープはそのまま判定に回す (下の条件で弾かれる)
  }
  if (!decoded.startsWith('/')) return null;
  // `//host` と `/\host` はブラウザが別オリジンとして解釈する
  if (decoded.startsWith('//') || decoded.startsWith('/\\')) return null;
  // 制御文字が混ざったものは扱わない
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return null;
  return decoded;
}

/** `next` を解決する。安全でなければダッシュボードへ。 */
export function resolveAfterAuthPath(value: string | null | undefined): string {
  return safeNextPath(value) ?? DEFAULT_AFTER_AUTH_PATH;
}

/** `next` を引き継いだ URL を組み立てる (未指定なら付けない)。 */
export function withNextParam(basePath: string, next: string | null | undefined): string {
  const safe = safeNextPath(next);
  if (!safe) return basePath;
  const separator = basePath.includes('?') ? '&' : '?';
  return `${basePath}${separator}next=${encodeURIComponent(safe)}`;
}
