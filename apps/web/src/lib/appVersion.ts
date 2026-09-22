// =============================================================================
// 実行中のビルドを識別するための表示用バージョン (#195 / #248)。
//
// 値はビルド時に vite.config.ts の define で埋め込む。実行時に決まる値ではない
// ので、どの環境のどのビルドを見ているかを画面から言い当てられる。
//
// **表記はどの環境でも semver に揃える。**
//   - Production … リリースタグそのもの        → `v1.2.3`
//   - それ以外   … package.json の version に
//                  ビルド元コミットを付けたもの → `v1.2.3-dev+517e233`
//
// リリース版かどうかは **バージョン文字列自体が持つ** (`-dev+` が付くかどうか)。
// 別のフラグを併走させると、文字列とフラグが食い違う余地を作ることになる。
//
// semver の正は apps/web/package.json の version で、リリースタグとの一致は
// release-deploy.yml が公開時に検証する (ずれていたらデプロイを止める)。
// =============================================================================

/** ビルド時に埋め込まれる生の値。`1.2.3` / `1.2.3-dev+517e233` / `unknown` のいずれか。 */
declare const __APP_VERSION__: string;

export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown';

/**
 * 画面に出す短い表記。
 *
 * リリースタグに揃えて `v` を付ける (`v1.2.3`)。タグの無いビルドは
 * `v1.2.3-dev+517e233` の形になり、semver のまま「リリース版ではないこと」と
 * 「どのコミットか」の両方が読める。問い合わせ時にこの文字列だけで対象ビルドを
 * 特定できる。
 *
 * define が効かない環境 (Storybook / Vitest) だけは番号を名乗れないので `dev` と
 * だけ出す。デプロイされたアプリでは起きない。
 */
export function formatAppVersion(version: string = APP_VERSION): string {
  if (!version || version === 'unknown') return 'dev';
  return version.startsWith('v') ? version : `v${version}`;
}

/**
 * ビルド識別子を組み立てる (#248)。**ビルド時に vite.config.ts から呼ばれる。**
 *
 * node の API に触れない純粋関数にしてあるのは、ここがバージョン表記の中身を
 * 決めている唯一の場所で、環境ごとの分岐を実際に試せるようにしておきたいため
 * (vite.config.ts の中に置くとテストから触れない)。
 *
 * - リリースタグがあればそれが正。`v` は表示側で付け直すのでここでは落とす
 * - 無ければ package.json の version に、ビルド元コミットを semver の
 *   **ビルドメタデータ (`+`)** として付ける
 *
 * コミットをプレリリース識別子 (`-`) ではなくビルドメタデータ側に置くのは、
 * 数字だけの短縮 SHA (先頭ゼロあり) がプレリリース識別子では semver 違反に
 * なるため。ビルドメタデータなら先頭ゼロが許される。
 */
export function buildVersionString(input: {
  releaseTag?: string;
  packageVersion: string;
  commitSha?: string;
}): string {
  const tag = input.releaseTag?.trim();
  if (tag) return tag.replace(/^v/, '');

  const sha = input.commitSha?.trim();
  return sha ? `${input.packageVersion}-dev+${sha}` : `${input.packageVersion}-dev`;
}
