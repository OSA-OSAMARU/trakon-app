import { describe, expect, it } from 'vitest';

import { buildVersionString, formatAppVersion } from './appVersion';

describe('formatAppVersion', () => {
  it('リリースビルドはタグと同じ semver を出す', () => {
    expect(formatAppVersion('1.2.3')).toBe('v1.2.3');
  });

  it('タグの無いビルドは semver のままコミットまで出す', () => {
    expect(formatAppVersion('1.2.3-dev+517e233')).toBe('v1.2.3-dev+517e233');
  });

  it('既に v が付いていれば二重に付けない', () => {
    expect(formatAppVersion('v1.2.3')).toBe('v1.2.3');
  });

  it('識別子を取れなかったビルドは dev とだけ出す', () => {
    expect(formatAppVersion('unknown')).toBe('dev');
  });

  it('define が無い環境 (Storybook / Vitest) でも例外にならない', () => {
    expect(formatAppVersion()).toBe('dev');
  });
});

// =============================================================================
// ビルド時の組み立て規則 (vite.config.ts が呼ぶ)。
// 画面のバージョン表記はここで決まるので、環境ごとの分岐を固定する。
// =============================================================================
describe('buildVersionString', () => {
  it('リリースタグがあればそれが正 (v は落として素の semver にする)', () => {
    expect(
      buildVersionString({ releaseTag: 'v1.2.3', packageVersion: '9.9.9', commitSha: 'abc1234' }),
    ).toBe('1.2.3');
  });

  it('v の付かないタグでもそのまま使える', () => {
    expect(buildVersionString({ releaseTag: '1.2.3', packageVersion: '9.9.9' })).toBe('1.2.3');
  });

  it('タグが無ければ package.json の version にコミットを付ける', () => {
    expect(buildVersionString({ packageVersion: '1.2.3', commitSha: '517e233' })).toBe(
      '1.2.3-dev+517e233',
    );
  });

  it('コミットも取れなければ version だけで dev と分かる形にする', () => {
    expect(buildVersionString({ packageVersion: '1.2.3' })).toBe('1.2.3-dev');
  });

  it('空文字のタグ・コミットは「無い」として扱う (CI が空の env を渡すため)', () => {
    expect(
      buildVersionString({ releaseTag: '  ', packageVersion: '1.2.3', commitSha: '' }),
    ).toBe('1.2.3-dev');
  });

  // 数字だけの短縮 SHA はプレリリース識別子に置くと semver 違反 (先頭ゼロ不可) に
  // なる。ビルドメタデータ側に置いているので、そのまま通ることを固定する。
  it('数字だけの短縮 SHA でも semver として妥当な形になる', () => {
    const v = buildVersionString({ packageVersion: '1.2.3', commitSha: '0123456' });
    expect(v).toBe('1.2.3-dev+0123456');
    expect(v).toMatch(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
    );
  });
});
