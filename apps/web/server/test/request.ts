import { app } from '../app.js';

export type ApiResponse<T = unknown> = {
  status: number;
  body: T;
};

/**
 * Hono アプリへ直接リクエストする統合テスト用ヘルパー。
 * token を渡すと Authorization: Bearer を付与し、body は JSON 化する。
 */
export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  const res = await app.request(path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  const body = (text ? JSON.parse(text) : undefined) as T;
  return { status: res.status, body };
}
