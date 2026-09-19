// =============================================================================
// 実行中のビルドを識別するための表示用バージョン (#195)。
//
// 値はビルド時に vite.config.ts の define で埋め込む。実行時に決まる値ではない
// ので、どの環境のどのビルドを見ているかを画面から言い当てられる。
//
// 優先順位 (vite.config.ts 側の resolveAppVersion):
//   1. VITE_APP_VERSION       — リリースタグ。Production デプロイで渡す
//   2. VERCEL_GIT_COMMIT_SHA  — Preview デプロイ。タグが無いのでコミットで示す
//   3. ローカルの git HEAD    — 開発中
//   4. 'unknown'              — git も無い環境 (CI のサンドボックスなど)
// =============================================================================

/** ビルド時に埋め込まれる生の値。`v1.1.0` / `a7dd789` / `unknown` のいずれか。 */
declare const __APP_VERSION__: string;

/** ビルド種別。Production リリース以外は開発中のビルドとして扱う。 */
declare const __APP_VERSION_IS_RELEASE__: boolean;

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown';

export const APP_VERSION_IS_RELEASE: boolean =
  typeof __APP_VERSION_IS_RELEASE__ === 'boolean' ? __APP_VERSION_IS_RELEASE__ : false;

/**
 * 画面に出す短い表記。
 *
 * リリースタグは `v1.1.0` のようにそのまま出し、タグが無いビルドは
 * コミットの短縮 SHA を `dev · a7dd789` の形にして「リリース版ではない」ことを
 * 明示する。問い合わせ時にこの文字列だけで対象ビルドを特定できるようにする。
 */
export function formatAppVersion(
  version: string = APP_VERSION,
  isRelease: boolean = APP_VERSION_IS_RELEASE,
): string {
  if (version === 'unknown') return 'dev';
  return isRelease ? version : `dev · ${version}`;
}
