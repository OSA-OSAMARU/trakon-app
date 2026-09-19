import { describe, expect, it } from 'vitest';

import { formatAppVersion } from './appVersion';

describe('formatAppVersion', () => {
  it('リリースビルドはタグをそのまま出す', () => {
    expect(formatAppVersion('v1.1.0', true)).toBe('v1.1.0');
  });

  it('リリース以外はコミットを dev 付きで出す', () => {
    expect(formatAppVersion('a7dd789', false)).toBe('dev · a7dd789');
  });

  it('識別子を取れなかったビルドは dev とだけ出す', () => {
    expect(formatAppVersion('unknown', false)).toBe('dev');
  });

  it('define が無い環境 (Storybook / Vitest) でも例外にならない', () => {
    expect(formatAppVersion()).toBe('dev');
  });
});
