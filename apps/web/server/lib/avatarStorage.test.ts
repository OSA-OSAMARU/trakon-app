import { beforeEach, describe, expect, it, vi } from 'vitest';

// Supabase Storage は差し替える。検証したいのはこちらの取り回し
// (まとめて署名する / 失敗しても画面を落とさない / 削除は冪等) の方。
const uploadMock = vi.fn(async () => ({ error: null as { message: string } | null }));
const removeMock = vi.fn(async () => ({ error: null as { message: string } | null }));
const createSignedUrlsMock = vi.fn(
  async (
    paths: string[],
  ): Promise<{
    data: Array<{ path: string | null; signedUrl: string | null }> | null;
    error: { message: string } | null;
  }> => ({
    data: paths.map((p) => ({ path: p, signedUrl: `https://signed.test/${p}` })),
    error: null,
  }),
);

vi.mock('./supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        upload: uploadMock,
        remove: removeMock,
        createSignedUrls: createSignedUrlsMock,
      }),
    },
  }),
}));

import {
  assertValidAvatar,
  buildAvatarPath,
  removeAvatarObject,
  signAvatarUrl,
  signAvatarUrls,
  uploadAvatarObject,
  AVATAR_MAX_BYTES,
} from './avatarStorage.js';

beforeEach(() => {
  vi.clearAllMocks();
  uploadMock.mockResolvedValue({ error: null });
  removeMock.mockResolvedValue({ error: null });
});

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

describe('uploadAvatarObject', () => {
  it('upsert せずに contentType 付きでアップロードする', async () => {
    await uploadAvatarObject({
      path: 'u1/a.png',
      bytes: bytes(PNG_MAGIC),
      mimeType: 'image/png',
    });
    expect(uploadMock).toHaveBeenCalledWith('u1/a.png', expect.any(Uint8Array), {
      contentType: 'image/png',
      // キーは毎回変わるので上書きは起こらない。上書きを許すと差し替え中の
      // 取り違えが起きうるので明示的に false にしている
      upsert: false,
    });
  });

  it('Storage が失敗したら 502 で返す (外部依存の失敗と分かるように)', async () => {
    uploadMock.mockResolvedValue({ error: { message: 'boom' } });
    await expect(
      uploadAvatarObject({ path: 'u1/a.png', bytes: bytes(PNG_MAGIC), mimeType: 'image/png' }),
    ).rejects.toMatchObject({ code: 'AVATAR_UPLOAD_FAILED', status: 502 });
  });
});

describe('removeAvatarObject', () => {
  it('null なら何もしない', async () => {
    await removeAvatarObject(null);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('削除に失敗しても throw しない (本処理を止めない)', async () => {
    removeMock.mockRejectedValue(new Error('network'));
    await expect(removeAvatarObject('u1/a.png')).resolves.toBeUndefined();
  });
});

describe('signAvatarUrls', () => {
  it('重複と null を除いて 1 回だけ呼ぶ (N+1 を避ける)', async () => {
    const map = await signAvatarUrls(['u1/a.png', 'u1/a.png', 'u2/b.png']);
    expect(createSignedUrlsMock).toHaveBeenCalledTimes(1);
    expect(createSignedUrlsMock.mock.calls[0]![0]).toEqual(['u1/a.png', 'u2/b.png']);
    expect(map.get('u1/a.png')).toBe('https://signed.test/u1/a.png');
  });

  it('対象が無ければ Storage を呼ばない', async () => {
    const map = await signAvatarUrls([]);
    expect(createSignedUrlsMock).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });

  it('Storage がエラーを返しても空を返す (画面は頭文字アバターへ落ちる)', async () => {
    createSignedUrlsMock.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    await expect(signAvatarUrls(['u1/a.png'])).resolves.toEqual(new Map());
  });

  it('Storage が throw しても空を返す', async () => {
    createSignedUrlsMock.mockRejectedValueOnce(new Error('unreachable'));
    await expect(signAvatarUrls(['u1/a.png'])).resolves.toEqual(new Map());
  });

  it('署名できなかった行は結果に含めない', async () => {
    createSignedUrlsMock.mockResolvedValueOnce({
      data: [{ path: 'u1/a.png', signedUrl: null }],
      error: null,
    });
    await expect(signAvatarUrls(['u1/a.png'])).resolves.toEqual(new Map());
  });
});

describe('signAvatarUrl', () => {
  it('null はそのまま null', async () => {
    await expect(signAvatarUrl(null)).resolves.toBeNull();
    expect(createSignedUrlsMock).not.toHaveBeenCalled();
  });

  it('1 件を署名して返す', async () => {
    await expect(signAvatarUrl('u1/a.png')).resolves.toBe('https://signed.test/u1/a.png');
  });
});
