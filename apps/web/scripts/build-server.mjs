// =============================================================================
// Vercel Serverless Function (Hono API) のバンドルビルド
// -----------------------------------------------------------------------------
// なぜ必要か:
//   ワークスペースパッケージ (@trakon/db / @trakon/shared) は package.json の
//   exports が生の TypeScript (./src/index.ts) を指している。Vercel の本番 Node
//   ランタイムは .ts を実行できないため、コンパイル済みの server/*.js がこれらを
//   import すると `ERR_MODULE_NOT_FOUND` で関数全体がクラッシュする。
//
//   そこで Hono アプリを esbuild で 1 つの JS にバンドルし、@trakon/* を
//   インライン化する。出力は .js なので @vercel/node は型チェックを行わず
//   (= デプロイログの型エラーも消える)、pnpm の symlink 構造にも左右されない。
//
//   @prisma/client を含む node_modules の依存は external のままにし、Vercel の
//   nft (node-file-trace) にトレースさせる (Prisma のクエリエンジン .node を含む)。
// =============================================================================
import { build } from 'esbuild';

/**
 * bare import のうち @trakon/* だけをバンドルし、それ以外 (hono / @supabase/* /
 * @sentry/* / @prisma/client / node:* など) は external にする。
 */
const externalizeNodeModules = {
  name: 'externalize-node-modules',
  setup(b) {
    // 先頭が '.' '/' でない = bare specifier。ただし @trakon/* はインライン化する。
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@trakon/')) return null; // バンドル対象
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: ['server/vercel.ts'],
  outfile: 'server-bundle/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  logLevel: 'info',
  plugins: [externalizeNodeModules],
  // ESM 出力にバンドルされる CJS 依存が require / __dirname を参照するための shim。
  banner: {
    js: [
      "import { createRequire as __cr } from 'module';",
      "import { fileURLToPath as __ftu } from 'url';",
      "import { dirname as __dn } from 'path';",
      'const require = __cr(import.meta.url);',
      'const __filename = __ftu(import.meta.url);',
      'const __dirname = __dn(__filename);',
    ].join('\n'),
  },
});
