import type { AuthenticatedUser } from '../middleware/auth.js';
import { registerInternalRequest } from './internalPrincipal.js';

/**
 * MCP ツールから既存 REST API (`/api/v1`) をプロセス内で呼ぶ (設計書 08-mcp §8.8)。
 *
 * 業務ルール (参加 404 集約・凍結/課金・ロール判定・Zod 検証・監査ログ) を MCP 側に
 * 写さず、画面からの操作と同じ経路を必ず通すためのもの。
 */

export type ApiSuccess<T> = {
  ok: true;
  status: number;
  data: T;
  meta?: unknown;
  warnings?: unknown;
};
export type ApiFailure = {
  ok: false;
  status: number;
  code: string;
  message: string;
  details?: unknown;
};
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export type Dispatch = <T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  /** `/api/v1` からの相対パス。例: `/projects/xxx/plans?from=2026-01-01` */
  path: string,
  body?: unknown,
) => Promise<ApiResult<T>>;

export function createDispatcher(input: {
  fetch: (req: Request) => Response | Promise<Response>;
  /** MCP リクエストと同じオリジン。通知メールのリンクが正しいドメインを指すようにする */
  origin: string;
  user: AuthenticatedUser;
}): Dispatch {
  return async <T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> => {
    const req = registerInternalRequest(
      new Request(`${input.origin}/api/v1${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
      input.user,
    );
    const res = await input.fetch(req);

    if (res.status === 204) return { ok: true, status: 204, data: undefined as T };

    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      // JSON 以外 (想定外)。下の失敗扱いに落とす
    }

    if (!res.ok) {
      const err = (json.error ?? {}) as { code?: string; message?: string; details?: unknown };
      return {
        ok: false,
        status: res.status,
        code: err.code ?? `HTTP_${res.status}`,
        message: err.message ?? `Request failed with status ${res.status}.`,
        details: err.details,
      };
    }
    return {
      ok: true,
      status: res.status,
      data: json.data as T,
      ...(json.meta !== undefined ? { meta: json.meta } : {}),
      ...(json.warnings !== undefined ? { warnings: json.warnings } : {}),
    };
  };
}
