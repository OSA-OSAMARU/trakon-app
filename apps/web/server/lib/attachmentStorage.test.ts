import { beforeEach, describe, expect, it, vi } from 'vitest';

// Supabase Storage は差し替える。検証したいのはこちらの取り回し
// (強制ダウンロードを必ず付ける / 削除は冪等 / 不通でも一覧を落とさない) の方。
const uploadMock = vi.fn(async () => ({ error: null as { message: string } | null }));
const removeMock = vi.fn(async () => ({ error: null as { message: string } | null }));
const createSignedUrlMock = vi.fn(
  async (
    path: string,
  ): Promise<{
    data: { signedUrl: string } | null;
    error: { message: string } | null;
  }> => ({ data: { signedUrl: `https://signed.test/${path}` }, error: null }),
);

vi.mock('./supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        upload: uploadMock,
        remove: removeMock,
        createSignedUrl: createSignedUrlMock,
      }),
    },
  }),
}));

import {
  ATTACHMENT_MAX_BYTES,
  assertValidAttachment,
  buildAttachmentKey,
  extensionOf,
  removeAttachmentObjects,
  signAttachmentUrls,
  uploadAttachmentObject,
} from './attachmentStorage.js';

beforeEach(() => {
  vi.clearAllMocks();
  uploadMock.mockResolvedValue({ error: null });
  removeMock.mockResolvedValue({ error: null });
});

describe('extensionOf', () => {
  it.each([
    ['design.psd', 'psd'],
    ['photo.JPG', 'jpg'],
    ['archive.tar.gz', 'gz'],
    ['/path/to/file.pdf', 'pdf'],
  ])('%s → %s', (name, ext) => {
    expect(extensionOf(name)).toBe(ext);
  });

  it.each(['README', '.gitignore', 'trailing.'])('拡張子が無い %s は空文字', (name) => {
    expect(extensionOf(name)).toBe('');
  });
});

describe('assertValidAttachment', () => {
  it('通常のファイルは通る', () => {
    expect(() =>
      assertValidAttachment({ filename: '入稿データ.psd', size: 1024 }),
    ).not.toThrow();
  });

  it('制作現場のファイルを許可リストで弾かない', () => {
    // 添付は種類が読めず増え続けるので、許可リストにすると日常的に詰まる
    for (const name of ['a.ai', 'b.indd', 'c.sketch', 'd.fig', 'e.mov', 'f.zip', 'g.svg']) {
      expect(() => assertValidAttachment({ filename: name, size: 10 })).not.toThrow();
    }
  });

  it('クリックで走る形式は弾く', () => {
    for (const name of ['setup.exe', 'run.sh', 'macro.vbs', 'script.js', 'app.dmg']) {
      expect(() => assertValidAttachment({ filename: name, size: 10 })).toThrow(
        expect.objectContaining({ code: 'ATTACHMENT_UNSUPPORTED_TYPE' }),
      );
    }
  });

  it('大文字の拡張子でも弾く', () => {
    expect(() => assertValidAttachment({ filename: 'SETUP.EXE', size: 10 })).toThrow(
      expect.objectContaining({ code: 'ATTACHMENT_UNSUPPORTED_TYPE' }),
    );
  });

  it('空ファイルは弾く', () => {
    expect(() => assertValidAttachment({ filename: 'a.pdf', size: 0 })).toThrow(
      expect.objectContaining({ code: 'ATTACHMENT_EMPTY' }),
    );
  });

  it('上限を超えるサイズは 413', () => {
    expect(() =>
      assertValidAttachment({ filename: 'big.mov', size: ATTACHMENT_MAX_BYTES + 1 }),
    ).toThrow(expect.objectContaining({ code: 'ATTACHMENT_TOO_LARGE', status: 413 }));
  });

  it('ファイル名が空なら弾く', () => {
    expect(() => assertValidAttachment({ filename: '   ', size: 10 })).toThrow(
      expect.objectContaining({ code: 'ATTACHMENT_INVALID_NAME' }),
    );
  });
});

describe('buildAttachmentKey', () => {
  it('プロジェクト / 予定のプレフィックス付きで作る', () => {
    const key = buildAttachmentKey({
      projectId: 'p-1',
      planId: 'pl-1',
      filename: '入稿データ.psd',
    });
    expect(key).toMatch(/^p-1\/pl-1\/[0-9a-f-]+\.psd$/);
  });

  it('元のファイル名はキーに入れない', () => {
    // 日本語・記号を含むファイル名がそのままオブジェクトキーになると
    // エンコード事故の温床になる。表示名は DB 側に持つ
    const key = buildAttachmentKey({
      projectId: 'p-1',
      planId: 'pl-1',
      filename: '（最新）入稿 data #2.pdf',
    });
    expect(key).not.toContain('入稿');
    expect(key.endsWith('.pdf')).toBe(true);
  });

  it('拡張子が無ければ付けない', () => {
    const key = buildAttachmentKey({ projectId: 'p-1', planId: 'pl-1', filename: 'README' });
    expect(key).toMatch(/^p-1\/pl-1\/[0-9a-f-]+$/);
  });
});

describe('uploadAttachmentObject', () => {
  it('バケットへ置く', async () => {
    await uploadAttachmentObject({
      key: 'p/pl/x.pdf',
      bytes: new Uint8Array(3),
      mimeType: 'application/pdf',
    });
    expect(uploadMock).toHaveBeenCalledWith('p/pl/x.pdf', expect.any(Uint8Array), {
      contentType: 'application/pdf',
      upsert: false,
    });
  });

  it('失敗は 502 (外部依存) として返す', async () => {
    uploadMock.mockResolvedValueOnce({ error: { message: 'boom' } });
    await expect(
      uploadAttachmentObject({
        key: 'p/pl/x.pdf',
        bytes: new Uint8Array(3),
        mimeType: 'application/pdf',
      }),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_UPLOAD_FAILED', status: 502 });
  });
});

describe('removeAttachmentObjects', () => {
  it('まとめて消す', async () => {
    await removeAttachmentObjects(['a', 'b']);
    expect(removeMock).toHaveBeenCalledWith(['a', 'b']);
  });

  it('空なら呼ばない', async () => {
    await removeAttachmentObjects([]);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('消せなくても例外にしない (呼び出し側の削除を止めない)', async () => {
    removeMock.mockRejectedValueOnce(new Error('storage down'));
    await expect(removeAttachmentObjects(['a'])).resolves.toBeUndefined();
  });
});

describe('signAttachmentUrls', () => {
  it('必ず強制ダウンロードを付ける', async () => {
    // これが無いと SVG / HTML がブラウザ内で描画され、保存型 XSS の入口になる
    await signAttachmentUrls([{ storageKey: 'p/pl/x.svg', filename: '図.svg' }]);

    expect(createSignedUrlMock).toHaveBeenCalledWith('p/pl/x.svg', expect.any(Number), {
      download: '図.svg',
    });
  });

  it('キーごとに URL を返す', async () => {
    const map = await signAttachmentUrls([
      { storageKey: 'a', filename: '1.pdf' },
      { storageKey: 'b', filename: '2.pdf' },
    ]);
    expect(map.get('a')).toBe('https://signed.test/a');
    expect(map.get('b')).toBe('https://signed.test/b');
  });

  it('発行に失敗したものは落とすが、他は返す', async () => {
    createSignedUrlMock.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    const map = await signAttachmentUrls([
      { storageKey: 'ng', filename: '1.pdf' },
      { storageKey: 'ok', filename: '2.pdf' },
    ]);
    expect(map.has('ng')).toBe(false);
    expect(map.get('ok')).toBe('https://signed.test/ok');
  });

  it('Storage が不通でも一覧は出す (例外にしない)', async () => {
    createSignedUrlMock.mockRejectedValueOnce(new Error('storage down'));
    await expect(
      signAttachmentUrls([{ storageKey: 'a', filename: '1.pdf' }]),
    ).resolves.toBeInstanceOf(Map);
  });

  it('空なら呼ばない', async () => {
    const map = await signAttachmentUrls([]);
    expect(map.size).toBe(0);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });
});
