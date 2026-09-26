import { randomBytes } from 'node:crypto';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  decryptShareToken as DecryptType,
  encryptShareToken as EncryptType,
  isShareTokenCipherAvailable as AvailableType,
} from './tokenCipher.js';

const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');

let key: string | undefined = KEY;
vi.mock('./env.js', () => ({
  getServerEnv: () => ({ SHARE_TOKEN_ENCRYPTION_KEY: key }),
}));

let encryptShareToken: typeof EncryptType;
let decryptShareToken: typeof DecryptType;
let isShareTokenCipherAvailable: typeof AvailableType;

beforeAll(async () => {
  ({ encryptShareToken, decryptShareToken, isShareTokenCipherAvailable } = await import(
    './tokenCipher.js'
  ));
});

afterEach(() => {
  key = KEY;
});

describe('encryptShareToken / decryptShareToken', () => {
  it('暗号化して復号すると元のトークンに戻る', () => {
    const raw = 'abcDEF-123_xyz';
    const cipher = encryptShareToken(raw);
    expect(cipher).not.toBeNull();
    expect(cipher).not.toContain(raw);
    expect(decryptShareToken(cipher)).toBe(raw);
  });

  it('同じトークンでも毎回違う暗号文になる (IV がランダム)', () => {
    expect(encryptShareToken('same-token')).not.toBe(encryptShareToken('same-token'));
  });

  it('暗号文はバージョン接頭辞を持つ (将来の鍵・方式変更の識別用)', () => {
    expect(encryptShareToken('tok')!.startsWith('v1:')).toBe(true);
  });

  it('鍵が未設定なら暗号化は null を返す (発行そのものは止めない)', () => {
    key = undefined;
    expect(isShareTokenCipherAvailable()).toBe(false);
    expect(encryptShareToken('tok')).toBeNull();
  });

  it('鍵が未設定なら復号も null を返す', () => {
    const cipher = encryptShareToken('tok')!;
    key = undefined;
    expect(decryptShareToken(cipher)).toBeNull();
  });

  it('別の鍵では復号できず、例外ではなく null になる', () => {
    const cipher = encryptShareToken('tok')!;
    key = OTHER_KEY;
    expect(decryptShareToken(cipher)).toBeNull();
  });

  it('暗号文が改竄されていれば null になる (GCM の認証タグで弾く)', () => {
    const [v, iv, , tag] = encryptShareToken('tok')!.split(':');
    const tampered = [v, iv, Buffer.from('evil').toString('base64url'), tag].join(':');
    expect(decryptShareToken(tampered)).toBeNull();
  });

  it('null / 空文字 / 形式違い / 未知バージョンは null になる', () => {
    expect(decryptShareToken(null)).toBeNull();
    expect(decryptShareToken('')).toBeNull();
    // #255 以前に発行された行は暗号文を持たない
    expect(decryptShareToken('not-a-cipher')).toBeNull();
    expect(decryptShareToken('v2:a:b:c')).toBeNull();
  });

  it('鍵の長さが 32 byte でなければ設定ミスとして例外を投げる', () => {
    key = randomBytes(16).toString('base64');
    expect(() => isShareTokenCipherAvailable()).toThrow(/32 bytes/);
  });
});
