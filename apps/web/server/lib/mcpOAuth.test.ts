import { createHash } from 'node:crypto';

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  appendQuery,
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  buildWwwAuthenticate,
  formatScope,
  generateOpaqueToken,
  hashOpaqueToken,
  isAllowedRedirectUri,
  isValidCodeChallenge,
  matchesRegisteredRedirectUri,
  parseScope,
  resolveSelfOrigin,
  verifyPkceS256,
} from './mcpOAuth.js';

describe('generateOpaqueToken', () => {
  it('種類ごとの接頭辞を付け、hash は生値の SHA-256', () => {
    const t = generateOpaqueToken('at');
    expect(t.raw).toMatch(/^trk_at_[A-Za-z0-9_-]{43}$/);
    expect(t.hash).toBe(hashOpaqueToken(t.raw));
    expect(t.hash).toBe(createHash('sha256').update(t.raw).digest('hex'));
    expect(generateOpaqueToken('at').raw).not.toBe(t.raw);
  });
});

describe('verifyPkceS256', () => {
  const verifier = 'a'.repeat(43);
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  it('正しい verifier を通す', () => {
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
  });
  it('違う verifier・形式不正の verifier を拒否する', () => {
    expect(verifyPkceS256('b'.repeat(43), challenge)).toBe(false);
    expect(verifyPkceS256('short', challenge)).toBe(false);
    expect(verifyPkceS256(`${'a'.repeat(42)}!`, challenge)).toBe(false);
  });
  it('長さの違う challenge でも例外にならない', () => {
    expect(verifyPkceS256(verifier, 'abc')).toBe(false);
  });
});

describe('isValidCodeChallenge', () => {
  it('base64url 43 文字のみ', () => {
    expect(isValidCodeChallenge('A'.repeat(43))).toBe(true);
    expect(isValidCodeChallenge('A'.repeat(42))).toBe(false);
    expect(isValidCodeChallenge(`${'A'.repeat(42)}=`)).toBe(false);
  });
});

describe('isAllowedRedirectUri', () => {
  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'http://localhost:6274/oauth/callback',
    'http://127.0.0.1:33418/',
    'http://[::1]:8080/cb',
  ])('許可: %s', (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(true);
  });
  it.each([
    'http://example.com/cb',
    'https://example.com/cb#frag',
    'https://user:pass@example.com/cb',
    'javascript:alert(1)',
    'myapp://callback',
    'not a url',
  ])('拒否: %s', (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false);
  });
});

describe('matchesRegisteredRedirectUri', () => {
  it('完全一致を通す', () => {
    expect(matchesRegisteredRedirectUri('https://a.example/cb', ['https://a.example/cb'])).toBe(
      true,
    );
  });
  it('https はパス違いを拒否する', () => {
    expect(matchesRegisteredRedirectUri('https://a.example/cb2', ['https://a.example/cb'])).toBe(
      false,
    );
  });
  it('loopback はポートだけ違っても通す (RFC 8252 §7.3)', () => {
    expect(
      matchesRegisteredRedirectUri('http://127.0.0.1:5555/callback', [
        'http://127.0.0.1:33418/callback',
      ]),
    ).toBe(true);
  });
  it('loopback でもホスト・パスが違えば拒否する', () => {
    const registered = ['http://127.0.0.1:33418/callback'];
    expect(matchesRegisteredRedirectUri('http://localhost:5555/callback', registered)).toBe(false);
    expect(matchesRegisteredRedirectUri('http://127.0.0.1:5555/other', registered)).toBe(false);
    expect(matchesRegisteredRedirectUri('not a url', registered)).toBe(false);
    expect(matchesRegisteredRedirectUri('http://127.0.0.1:5555/callback', ['broken'])).toBe(false);
  });
});

describe('parseScope / formatScope', () => {
  it('未指定は全スコープ', () => {
    expect(parseScope(undefined)).toEqual(['read', 'write']);
    expect(parseScope('  ')).toEqual(['read', 'write']);
  });
  it('並び順を正規化し重複を除く', () => {
    expect(parseScope('write read write')).toEqual(['read', 'write']);
    expect(formatScope(['read', 'write'])).toBe('read write');
  });
  it('知らないスコープは無視する (offline_access・openid などで接続を止めない)', () => {
    expect(parseScope('read offline_access')).toEqual(['read']);
    expect(parseScope('openid offline_access')).toEqual(['read', 'write']);
    expect(parseScope('read admin')).toEqual(['read']);
  });
});

describe('resolveSelfOrigin', () => {
  const app = new Hono().get('/', (c) => c.text(resolveSelfOrigin(c)));

  it('x-forwarded-host を優先し、Origin ヘッダは見ない', async () => {
    const res = await app.request('http://internal:3001/', {
      headers: {
        'x-forwarded-host': 'trakon.example, proxy',
        'x-forwarded-proto': 'https',
        origin: 'https://evil.example',
      },
    });
    expect(await res.text()).toBe('https://trakon.example');
  });
  it('proto が無ければ https を仮定', async () => {
    const res = await app.request('http://internal:3001/', {
      headers: { 'x-forwarded-host': 'trakon.example' },
    });
    expect(await res.text()).toBe('https://trakon.example');
  });
  it('プロキシが無ければ URL のオリジン', async () => {
    const res = await app.request('http://localhost:3001/');
    expect(await res.text()).toBe('http://localhost:3001');
  });
});

describe('metadata', () => {
  it('保護リソースメタデータ', () => {
    expect(buildProtectedResourceMetadata('https://t.example')).toMatchObject({
      resource: 'https://t.example/api/mcp',
      authorization_servers: ['https://t.example'],
      scopes_supported: ['read', 'write'],
    });
  });
  it('認可サーバメタデータ', () => {
    expect(buildAuthorizationServerMetadata('https://t.example').scopes_supported).toEqual([
      'read',
      'write',
      'offline_access',
    ]);
    expect(buildAuthorizationServerMetadata('https://t.example')).toMatchObject({
      issuer: 'https://t.example',
      authorization_endpoint: 'https://t.example/oauth/authorize',
      token_endpoint: 'https://t.example/api/oauth/token',
      registration_endpoint: 'https://t.example/api/oauth/register',
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });
  it('WWW-Authenticate', () => {
    expect(buildWwwAuthenticate('https://t.example')).toBe(
      'Bearer resource_metadata="https://t.example/.well-known/oauth-protected-resource/api/mcp"',
    );
    expect(buildWwwAuthenticate('https://t.example', 'invalid_token')).toContain(
      'error="invalid_token"',
    );
  });
});

describe('appendQuery', () => {
  it('既存クエリを残し、undefined は付けない', () => {
    const url = appendQuery('https://a.example/cb?x=1', { code: 'c', state: undefined });
    expect(url).toBe('https://a.example/cb?x=1&code=c');
  });
});
