import { uuidv7 } from 'uuidv7';

import { ApiException } from './errors.js';
import { getSupabaseAdmin } from './supabaseAdmin.js';

/**
 * プロフィール画像の保存 (#157)。
 *
 * Supabase Storage の **非公開バケット** `avatars` に置き、表示は短命の署名付き URL で行う。
 * 公開バケットにすると顔写真が URL を知る誰にでも恒久的に読める状態になり、
 * 設計書 §5.9 の最小収集方針 (SR-PRIVACY-01) から外れすぎる。
 * PRD §8 の attachments 方針「署名付きURL + 短時間有効期限、直リンク禁止」とも揃える。
 *
 * オブジェクトキーは `{userId}/{uuidv7}.{ext}`。ユーザーごとにプレフィックスを分けることで、
 * 退会時の一括削除がプレフィックス指定で済む。
 */

export const AVATAR_BUCKET = 'avatars';

/** アップロード上限。issue #157 の指定どおり 10MB。 */
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;

/** 受け付ける MIME。トリミング後の出力は webp/jpeg を想定するが png も許す。 */
const ALLOWED = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;

export type AvatarMimeType = keyof typeof ALLOWED;

/** 署名付き URL の有効期限 (秒)。短命にして URL の使い回しを防ぐ。 */
const SIGNED_URL_TTL_SEC = 60 * 60;

/**
 * マジックバイトで実際の画像形式を判定する。
 *
 * Content-Type は呼び出し側が自由に名乗れるので、宣言だけを信じない。
 * 判定できないものは弾く (実行可能ファイルに image/png と名乗らせないため)。
 */
function sniffMimeType(bytes: Uint8Array): AvatarMimeType | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  // WebP: 'RIFF' .... 'WEBP'
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * アップロードされたファイルを検証する。
 * サイズ・宣言 MIME・**中身のマジックバイト**の 3 つを見る。
 */
export function assertValidAvatar(input: {
  size: number;
  declaredType: string;
  bytes: Uint8Array;
}): AvatarMimeType {
  if (input.size <= 0) {
    throw new ApiException('AVATAR_EMPTY', 422, '画像ファイルが空です。');
  }
  if (input.size > AVATAR_MAX_BYTES) {
    throw new ApiException(
      'AVATAR_TOO_LARGE',
      413,
      `画像は ${AVATAR_MAX_BYTES / 1024 / 1024}MB 以下にしてください。`,
      { maxBytes: AVATAR_MAX_BYTES, size: input.size },
    );
  }
  const sniffed = sniffMimeType(input.bytes);
  if (!sniffed) {
    throw new ApiException(
      'AVATAR_UNSUPPORTED_TYPE',
      422,
      'PNG または JPEG の画像を選んでください。',
    );
  }
  // 宣言と中身が食い違うものも弾く (取り違え・偽装の両方を防ぐ)
  const declared = input.declaredType.split(';')[0]?.trim().toLowerCase();
  if (declared && declared in ALLOWED && declared !== sniffed) {
    throw new ApiException(
      'AVATAR_UNSUPPORTED_TYPE',
      422,
      '画像の形式と拡張子が一致しません。',
      { declared, actual: sniffed },
    );
  }
  return sniffed;
}

export function buildAvatarPath(userId: string, mimeType: AvatarMimeType): string {
  return `${userId}/${uuidv7()}.${ALLOWED[mimeType]}`;
}

/** バケットへアップロードする。失敗は 502 (外部依存) として返す。 */
export async function uploadAvatarObject(input: {
  path: string;
  bytes: Uint8Array;
  mimeType: AvatarMimeType;
}): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .storage.from(AVATAR_BUCKET)
    .upload(input.path, input.bytes, { contentType: input.mimeType, upsert: false });
  if (error) {
    throw new ApiException('AVATAR_UPLOAD_FAILED', 502, '', { message: error.message });
  }
}

/** 差し替え・削除・退会で使う。既に無い場合も成功扱いにする (冪等)。 */
export async function removeAvatarObject(path: string | null | undefined): Promise<void> {
  if (!path) return;
  // 消せなくても本処理 (DB 更新) は止めない。孤児オブジェクトはバケット側の
  // ライフサイクルで回収する方が、ユーザー操作を失敗させるより実害が小さい。
  await getSupabaseAdmin()
    .storage.from(AVATAR_BUCKET)
    .remove([path])
    .catch(() => undefined);
}

/**
 * 表示用の署名付き URL をまとめて発行する。
 *
 * 参加者一覧のように N 人分をレンダリングする経路があるので、**1 レスポンスにつき
 * 1 回の呼び出し**で済むよう配列で受ける。発行に失敗したものは null にして
 * 頭文字アバターへフォールバックさせる (画面全体を落とさない)。
 */
export async function signAvatarUrls(paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  try {
    const { data, error } = await getSupabaseAdmin()
      .storage.from(AVATAR_BUCKET)
      .createSignedUrls(unique, SIGNED_URL_TTL_SEC);
    if (error || !data) return result;
    for (const row of data) {
      if (row.signedUrl && row.path) result.set(row.path, row.signedUrl);
    }
  } catch {
    // Storage が未設定・不通でも画面は出す (頭文字アバターにフォールバックする)
  }
  return result;
}

/** 1 件だけ署名する薄いラッパ (自分のプロフィール用)。 */
export async function signAvatarUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const map = await signAvatarUrls([path]);
  return map.get(path) ?? null;
}
