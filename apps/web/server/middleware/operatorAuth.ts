import type { MiddlewareHandler } from 'hono';

import { getServerEnv } from '../lib/env.js';
import { ApiException } from '../lib/errors.js';

/**
 * 運営メンバーか判定する (#204)。
 *
 * 許可リストは環境変数 `TRAKON_OPERATOR_EMAILS`（カンマ区切り）で持つ。
 * DB の列にしないのは、運営権限は**デプロイ側で管理したい**ものであり、
 * アプリのデータ操作から昇格できる経路を作りたくないため。
 * 未設定なら誰も該当しない（安全側に倒す）。
 *
 * 突き合わせるのは **JWT の検証済みメールアドレス**で、`users` テーブルの値ではない。
 * DB 側の行が書き換えられても運営権限には影響しないようにしている。
 */
export function isOperatorEmail(email: string | undefined): boolean {
  if (!email) return false;
  const raw = getServerEnv().TRAKON_OPERATOR_EMAILS;
  if (!raw) return false;
  const allowed = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

/**
 * 運営専用エンドポイントのガード。
 *
 * 権限不足は **404 に集約**する（設計書 §3.2）。「運営画面が存在すること」自体を
 * 一般ユーザーに気取らせないため、403 ではなく「そんなものは無い」と返す。
 */
export function requireOperator(): MiddlewareHandler {
  return async (c, next) => {
    if (!isOperatorEmail(c.get('authUser')?.email)) {
      throw new ApiException('NOT_FOUND', 404, 'Not found.');
    }
    await next();
  };
}
