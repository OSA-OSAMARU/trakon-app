import { describe, expect, it } from 'vitest';

import { resolveAfterAuthPath, safeNextPath, withNextParam } from './nextPath';

describe('safeNextPath', () => {
  it('同一オリジンのパスは通す', () => {
    expect(safeNextPath('/invitations/abc')).toBe('/invitations/abc');
    expect(safeNextPath('/projects?tab=1')).toBe('/projects?tab=1');
  });

  it('符号化された値も展開して返す', () => {
    expect(safeNextPath(encodeURIComponent('/invitations/abc'))).toBe('/invitations/abc');
  });

  it('他サイトへ出る値は捨てる', () => {
    expect(safeNextPath('https://evil.example')).toBeNull();
    expect(safeNextPath('//evil.example')).toBeNull();
    expect(safeNextPath('/\\evil.example')).toBeNull();
    expect(safeNextPath(encodeURIComponent('//evil.example'))).toBeNull();
    expect(safeNextPath('javascript:alert(1)')).toBeNull();
  });

  it('空・未指定は null', () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath('')).toBeNull();
  });
});

describe('resolveAfterAuthPath', () => {
  it('安全でない値はダッシュボードに落とす', () => {
    expect(resolveAfterAuthPath('//evil.example')).toBe('/dashboard');
    expect(resolveAfterAuthPath(null)).toBe('/dashboard');
    expect(resolveAfterAuthPath('/invitations/abc')).toBe('/invitations/abc');
  });
});

describe('withNextParam', () => {
  it('next を引き継ぐ', () => {
    expect(withNextParam('/login', '/invitations/abc')).toBe('/login?next=%2Finvitations%2Fabc');
    expect(withNextParam('/login?screen=signup', '/invitations/abc')).toBe(
      '/login?screen=signup&next=%2Finvitations%2Fabc',
    );
  });

  it('安全でない next は付けない', () => {
    expect(withNextParam('/login', '//evil.example')).toBe('/login');
    expect(withNextParam('/login', null)).toBe('/login');
  });
});
