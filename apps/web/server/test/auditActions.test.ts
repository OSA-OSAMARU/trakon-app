import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '@trakon/shared';

// =============================================================================
// 監査ログ action の綴り検査 (server/** のソースを走査する)
//
// audit_logs.action は Prisma 上ただの string なので、許可値に無い値を書いても
// **コンパイルでは落ちない**。落ちるのは実 DB の CHECK 制約 ck_al_action で、
// しかも同一トランザクションの業務処理ごと巻き戻って 500 になる。
// #209 の POST /billing/sync は実際にこれで落ちた
// ('subscription_reconciled' を許可値へ追加し忘れていた)。
//
// そこでソース中の action リテラルが許可値に含まれることをここで固定する。
// 許可値 ↔ 実 DB の突き合わせは auditActions.integration.test.ts 側が持つ。
// =============================================================================

const SERVER_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ACTION_LITERAL = /action: '([a-z_]+)'/g;

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return collectSourceFiles(full);
    if (!full.endsWith('.ts') || full.endsWith('.test.ts')) return [];
    return [full];
  });
}

function collectActionLiterals(): { action: string; file: string }[] {
  return collectSourceFiles(SERVER_ROOT).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(ACTION_LITERAL)].map((m) => ({
      action: m[1]!,
      file: file.slice(SERVER_ROOT.length),
    }));
  });
}

describe('監査ログ action のリテラル', () => {
  it('server/** が書く action はすべて許可値に含まれる', () => {
    const unknown = collectActionLiterals().filter(
      ({ action }) => !(AUDIT_ACTIONS as readonly string[]).includes(action),
    );

    // 失敗時に「どのファイルのどの値か」が出るようにする
    expect(unknown).toEqual([]);
  });

  it('走査が空振りしていない (正規表現が壊れたら気付けるようにする)', () => {
    // 検査そのものが無言で無効化される事故を防ぐ
    expect(collectActionLiterals().length).toBeGreaterThan(20);
  });
});
