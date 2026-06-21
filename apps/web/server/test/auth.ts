import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type KeyLike,
} from 'jose';

// =============================================================================
// 統合テスト用の JWT 検証シーム
// -----------------------------------------------------------------------------
// 本番の requireAuth() は Supabase のリモート JWKS (createRemoteJWKSet) に対して
// jwtVerify する。統合テストでは createRemoteJWKSet を本ファイルの「ローカル鍵セット」へ
// 差し替える (integration.setup.ts の vi.mock を参照) ことで、jwtVerify・issuer・
// audience の検証ロジックは本物のまま、任意ユーザーの JWT を発行できるようにする。
// =============================================================================

const KID = 'trakon-test-key';

let privateKey: KeyLike | undefined;
let jwksResolver: ReturnType<typeof createLocalJWKSet> | undefined;

/** テスト用 RSA 鍵ペアを 1 度だけ生成する。beforeAll で呼ぶ。 */
export async function initTestAuth(): Promise<void> {
  if (privateKey) return;
  const { publicKey, privateKey: pk } = await generateKeyPair('RS256', {
    extractable: true,
  });
  privateKey = pk;
  const jwk = await exportJWK(publicKey);
  jwksResolver = createLocalJWKSet({
    keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }],
  });
}

/** createRemoteJWKSet の差し替え先。ローカル公開鍵で署名検証する resolver を返す。 */
export function testJwksResolver(): ReturnType<typeof createLocalJWKSet> {
  if (!jwksResolver) {
    throw new Error('initTestAuth() must be called before verifying tokens.');
  }
  return jwksResolver;
}

/** 指定ユーザーで有効な Supabase 風 JWT を発行する。 */
export async function signTestJwt(opts: {
  authUserId: string;
  email: string;
  provider?: string;
}): Promise<string> {
  if (!privateKey) {
    throw new Error('initTestAuth() must be called before signing tokens.');
  }
  const issuer = `${process.env.SUPABASE_URL}/auth/v1`;
  const audience = process.env.SUPABASE_JWT_AUD ?? 'authenticated';
  return new SignJWT({
    email: opts.email,
    app_metadata: { provider: opts.provider ?? 'password' },
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setSubject(opts.authUserId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
}
