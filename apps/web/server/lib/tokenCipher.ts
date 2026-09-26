import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { getServerEnv } from './env.js';

/**
 * 共有リンクの生トークンを「あとから取り出せる形」で保管するための暗号化 (#255)。
 * 設計書 docs/design/05-security.md §5.10
 *
 * 招待トークンと同じく、共有トークンは元々 SHA-256 ハッシュだけを保存し、生の値は
 * 発行時の 1 回しか表示できなかった。しかし運用上「発行済みリンクの URL を
 * 後から確認してクライアントへ再送したい」という要求 (#255) があり、
 * ハッシュからは復元できないため方針を改めた。
 *
 * 平文で持たない理由:
 *   DB のダンプが漏れた時点で、全プロジェクトの共有 URL がそのまま使える状態になる。
 *   鍵をアプリの環境変数に置けば、DB 単体の漏洩では復号できない。
 *
 * 検証経路は変えない:
 *   トークンの照合は引き続き `token_hash` の完全一致で行う。暗号文は**表示専用**で、
 *   認証の判断材料には一切使わない (復号に失敗しても共有リンク自体は生きている)。
 *
 * **招待トークン (invitations) はこの仕組みを使わない。** 招待はメールで届くもので
 * あり、後から URL を再表示する要件がない。取り出せる形で持つ意味がない。
 */

const ALGORITHM = 'aes-256-gcm';
/** 暗号文のバージョン接頭辞。将来鍵や方式を変えるときの識別子にする */
const VERSION = 'v1';
/** AAD。別用途の暗号文を取り違えて復号できないよう用途を結びつける */
const AAD = Buffer.from('trakon:share_link_token');
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * 環境変数の鍵を 32 byte のバッファにする。未設定なら null。
 *
 * 未設定を許すのは、ローカル開発と既存テストを鍵の用意なしで動かすため。
 * 本番では env の検証 (`lib/env.ts`) で必須にしている。
 */
function getKey(): Buffer | null {
  const raw = getServerEnv().SHARE_TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `[trakon] SHARE_TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`,
    );
  }
  return key;
}

/** 鍵が設定されているか。設定画面で「URL を再表示できるか」の判断に使う。 */
export function isShareTokenCipherAvailable(): boolean {
  return getKey() !== null;
}

/**
 * 生トークンを暗号化する。鍵が未設定なら null を返す
 * (発行そのものは成功させ、URL の再表示だけを諦める)。
 */
export function encryptShareToken(rawToken: string): string | null {
  const key = getKey();
  if (!key) return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(rawToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join(':');
}

/**
 * 暗号文から生トークンを復元する。復号できない場合は null
 * (鍵が未設定 / 鍵が入れ替わった / #255 以前に発行された行 / 改竄)。
 *
 * **例外を投げない。** 1 件の復号失敗で一覧全体が 500 になるのは割に合わない。
 * 呼び出し側は null を「URL を表示できない」として扱う。
 */
export function decryptShareToken(cipherText: string | null | undefined): string | null {
  if (!cipherText) return null;
  const key = getKey();
  if (!key) return null;
  const parts = cipherText.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const iv = Buffer.from(parts[1]!, 'base64url');
    const ciphertext = Buffer.from(parts[2]!, 'base64url');
    const tag = Buffer.from(parts[3]!, 'base64url');
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
