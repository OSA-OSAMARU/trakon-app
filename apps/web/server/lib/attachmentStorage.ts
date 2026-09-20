import { uuidv7 } from 'uuidv7';

import { ApiException } from './errors.js';
import { getSupabaseAdmin } from './supabaseAdmin.js';

/**
 * 予定への添付ファイルの保存 (#65 / PRD §8.2)。
 *
 * Supabase Storage の **非公開バケット** `attachments` に置き、配信は
 * 署名付き URL + 短時間有効期限で行う (直リンク禁止)。`avatarStorage.ts` と同じ形。
 *
 * オブジェクトキーは `{projectId}/{planId}/{uuidv7}{ext}`。
 * プロジェクト単位でプレフィックスを分けることで、プロジェクト削除時の
 * 一括削除がプレフィックス指定で済む。
 */

export const ATTACHMENT_BUCKET = 'attachments';

/**
 * 1 ファイルの上限。
 *
 * 制作物の入稿データ (PSD・AI・動画の一部) を想定して 20MB。
 * Vercel のサーバーレス関数はリクエストボディ 4.5MB の制限があるため、
 * **将来的には署名付きアップロード URL へ切り替える必要がある** (下の注記を参照)。
 */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

/** 1 つの予定に付けられる件数の上限。際限なく積むと一覧が読めなくなる。 */
export const ATTACHMENT_MAX_PER_PLAN = 20;

/** 署名付き URL の有効期限 (秒)。短命にして URL の使い回しを防ぐ。 */
const SIGNED_URL_TTL_SEC = 60 * 10;

/**
 * 受け付けない拡張子。
 *
 * **許可リストではなく拒否リスト**にしている。添付は「制作の現場で行き交うファイル」で、
 * .psd / .ai / .indd / .sketch / .fig など種類が読めないうえ、増え続ける。
 * 許可リストにすると「送れないファイルがある」という形で日常的に詰まる。
 *
 * 代わりに **配信時に必ず `Content-Disposition: attachment` を付けて**、
 * ブラウザ内で実行・描画されないようにしている (下の signAttachmentUrl)。
 * SVG や HTML による保存型 XSS はこの強制ダウンロードで塞がる。
 * ここで弾いているのは「クリックしただけで走る」タイプだけ。
 */
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'jar',
  'app', 'dmg', 'pkg', 'deb', 'rpm',
  'sh', 'bash', 'zsh', 'ps1', 'vbs', 'js', 'mjs', 'cjs', 'wsf', 'hta',
]);

/** ファイル名から小文字の拡張子を取り出す。無ければ空文字。 */
export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return '';
  return base.slice(idx + 1).toLowerCase();
}

/**
 * アップロードされたファイルを検証する。
 * 実行されうる拡張子・サイズ・空ファイルの 3 つを見る。
 */
export function assertValidAttachment(input: { filename: string; size: number }): void {
  if (!input.filename.trim()) {
    throw new ApiException('ATTACHMENT_INVALID_NAME', 422, 'ファイル名がありません。');
  }
  if (input.size <= 0) {
    throw new ApiException('ATTACHMENT_EMPTY', 422, 'ファイルが空です。');
  }
  if (input.size > ATTACHMENT_MAX_BYTES) {
    throw new ApiException(
      'ATTACHMENT_TOO_LARGE',
      413,
      `ファイルは ${ATTACHMENT_MAX_BYTES / 1024 / 1024}MB 以下にしてください。`,
      { maxBytes: ATTACHMENT_MAX_BYTES, size: input.size },
    );
  }
  if (BLOCKED_EXTENSIONS.has(extensionOf(input.filename))) {
    throw new ApiException(
      'ATTACHMENT_UNSUPPORTED_TYPE',
      422,
      '実行ファイルは添付できません。',
      { filename: input.filename },
    );
  }
}

/** オブジェクトキーを組み立てる。元のファイル名は DB 側に持つ。 */
export function buildAttachmentKey(input: {
  projectId: string;
  planId: string;
  filename: string;
}): string {
  const ext = extensionOf(input.filename);
  return `${input.projectId}/${input.planId}/${uuidv7()}${ext ? `.${ext}` : ''}`;
}

export async function uploadAttachmentObject(input: {
  key: string;
  bytes: Uint8Array;
  mimeType: string;
}): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .storage.from(ATTACHMENT_BUCKET)
    .upload(input.key, input.bytes, { contentType: input.mimeType, upsert: false });
  if (error) {
    throw new ApiException('ATTACHMENT_UPLOAD_FAILED', 502, '', { message: error.message });
  }
}

/**
 * 削除時に実体も消す。既に無い場合も成功扱い (冪等)。
 *
 * 消せなくても DB 側の削除は止めない。孤児オブジェクトはバケットの
 * ライフサイクルで回収する方が、ユーザー操作を失敗させるより実害が小さい。
 */
export async function removeAttachmentObjects(keys: string[]): Promise<void> {
  const targets = keys.filter(Boolean);
  if (targets.length === 0) return;
  await getSupabaseAdmin()
    .storage.from(ATTACHMENT_BUCKET)
    .remove(targets)
    .catch(() => undefined);
}

/**
 * ダウンロード用の署名付き URL を発行する。
 *
 * **必ず `download` を付ける。** これが付くと Supabase は
 * `Content-Disposition: attachment` を返し、ブラウザは中身を描画せず保存する。
 * SVG や HTML を添付されても実行されないのはこの指定のおかげで、
 * 拡張子の拒否リストだけに頼らない二重の守りになっている。
 */
export async function signAttachmentUrls(
  items: { storageKey: string; filename: string }[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (items.length === 0) return result;

  const admin = getSupabaseAdmin();
  await Promise.all(
    items.map(async (item) => {
      try {
        const { data, error } = await admin.storage
          .from(ATTACHMENT_BUCKET)
          .createSignedUrl(item.storageKey, SIGNED_URL_TTL_SEC, { download: item.filename });
        if (!error && data?.signedUrl) result.set(item.storageKey, data.signedUrl);
      } catch {
        // Storage が不通でも一覧は出す (URL は null になりダウンロードだけ落ちる)
      }
    }),
  );
  return result;
}
