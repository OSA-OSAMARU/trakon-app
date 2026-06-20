import { describe, expect, it } from 'vitest';
import type { Context } from 'hono';

import { resolveRequestOrigin } from './requestOrigin.js';

/** header マップだけを持つ最小 Context スタブ。 */
function ctx(headers: Record<string, string>): Context {
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()],
    },
  } as unknown as Context;
}

describe('resolveRequestOrigin', () => {
  it('Origin ヘッダを最優先で使う (発行元と同一ドメイン)', () => {
    expect(
      resolveRequestOrigin(
        ctx({ origin: 'https://trakon-app-i0ta680i9-trakon-projects.vercel.app' }),
      ),
    ).toBe('https://trakon-app-i0ta680i9-trakon-projects.vercel.app');
  });

  it('Origin の末尾スラッシュを除去する', () => {
    expect(resolveRequestOrigin(ctx({ origin: 'https://example.com/' }))).toBe(
      'https://example.com',
    );
  });

  it('Origin が無ければ x-forwarded-proto + x-forwarded-host で組む', () => {
    expect(
      resolveRequestOrigin(
        ctx({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'preview.vercel.app' }),
      ),
    ).toBe('https://preview.vercel.app');
  });

  it('カンマ区切りの forwarded ヘッダは先頭値を使う', () => {
    expect(
      resolveRequestOrigin(
        ctx({ 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'a.example.com, b' }),
      ),
    ).toBe('https://a.example.com');
  });

  it('forwarded-host のみなら scheme は https を仮定', () => {
    expect(resolveRequestOrigin(ctx({ 'x-forwarded-host': 'preview.vercel.app' }))).toBe(
      'https://preview.vercel.app',
    );
  });

  it('Host ヘッダにフォールバックする', () => {
    expect(resolveRequestOrigin(ctx({ host: 'localhost:5173' }))).toBe('https://localhost:5173');
  });

  it('Host + x-forwarded-proto なら proto を尊重する', () => {
    expect(
      resolveRequestOrigin(ctx({ host: 'localhost:5173', 'x-forwarded-proto': 'http' })),
    ).toBe('http://localhost:5173');
  });
});
