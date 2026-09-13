import { describe, expect, it } from 'vitest';

import { assertValidAvatar, buildAvatarPath, AVATAR_MAX_BYTES } from './avatarStorage.js';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const WEBP_MAGIC = [
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
];

function bytes(magic: number[], padTo = 64): Uint8Array {
  const a = new Uint8Array(Math.max(padTo, magic.length));
  a.set(magic);
  return a;
}

describe('assertValidAvatar', () => {
  it('PNG / JPEG / WebP をマジックバイトで判定する', () => {
    expect(
      assertValidAvatar({ size: 64, declaredType: 'image/png', bytes: bytes(PNG_MAGIC) }),
    ).toBe('image/png');
    expect(
      assertValidAvatar({ size: 64, declaredType: 'image/jpeg', bytes: bytes(JPEG_MAGIC) }),
    ).toBe('image/jpeg');
    expect(
      assertValidAvatar({ size: 64, declaredType: 'image/webp', bytes: bytes(WEBP_MAGIC) }),
    ).toBe('image/webp');
  });

  it('charset 付きの Content-Type も受け付ける', () => {
    expect(
      assertValidAvatar({
        size: 64,
        declaredType: 'image/png; charset=binary',
        bytes: bytes(PNG_MAGIC),
      }),
    ).toBe('image/png');
  });

  it('空ファイルは 422', () => {
    expect(() =>
      assertValidAvatar({ size: 0, declaredType: 'image/png', bytes: new Uint8Array() }),
    ).toThrowError(expect.objectContaining({ code: 'AVATAR_EMPTY', status: 422 }));
  });

  it('10MB 超は 413', () => {
    expect(() =>
      assertValidAvatar({
        size: AVATAR_MAX_BYTES + 1,
        declaredType: 'image/png',
        bytes: bytes(PNG_MAGIC),
      }),
    ).toThrowError(expect.objectContaining({ code: 'AVATAR_TOO_LARGE', status: 413 }));
  });

  it('10MB ちょうどは通す', () => {
    expect(
      assertValidAvatar({
        size: AVATAR_MAX_BYTES,
        declaredType: 'image/png',
        bytes: bytes(PNG_MAGIC),
      }),
    ).toBe('image/png');
  });

  it('画像でない中身は、image/png と名乗っていても 422', () => {
    // ELF ヘッダ (実行ファイル)
    const elf = bytes([0x7f, 0x45, 0x4c, 0x46]);
    expect(() =>
      assertValidAvatar({ size: elf.byteLength, declaredType: 'image/png', bytes: elf }),
    ).toThrowError(expect.objectContaining({ code: 'AVATAR_UNSUPPORTED_TYPE', status: 422 }));
  });

  it('宣言 MIME と中身が食い違う場合も 422', () => {
    expect(() =>
      assertValidAvatar({ size: 64, declaredType: 'image/png', bytes: bytes(JPEG_MAGIC) }),
    ).toThrowError(expect.objectContaining({ code: 'AVATAR_UNSUPPORTED_TYPE', status: 422 }));
  });

  it('GIF など対象外の画像は 422', () => {
    const gif = bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(() =>
      assertValidAvatar({ size: gif.byteLength, declaredType: 'image/gif', bytes: gif }),
    ).toThrowError(expect.objectContaining({ code: 'AVATAR_UNSUPPORTED_TYPE', status: 422 }));
  });
});

describe('buildAvatarPath', () => {
  it('ユーザーごとのプレフィックス + uuid + 拡張子になる', () => {
    const path = buildAvatarPath('11111111-1111-7111-8111-111111111111', 'image/jpeg');
    expect(path).toMatch(/^11111111-1111-7111-8111-111111111111\/[0-9a-f-]{36}\.jpg$/);
  });

  it('毎回異なるキーになる (キャッシュの取り違えを避ける)', () => {
    const a = buildAvatarPath('u1', 'image/png');
    const b = buildAvatarPath('u1', 'image/png');
    expect(a).not.toBe(b);
  });
});
