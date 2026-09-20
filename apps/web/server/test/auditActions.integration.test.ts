import { prisma } from '@trakon/db';
import { describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '@trakon/shared';

// =============================================================================
// 許可値 (packages/shared) ↔ 実 DB の CHECK 制約 ck_al_action の突き合わせ
//
// 定数を足してもマイグレーションを書き忘れれば INSERT は落ちる。逆も同じ。
// ずれたまま気付けないと、本番で「業務処理ごと巻き戻って 500」になる (#209)。
// =============================================================================

async function constraintValues(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ def: string }[]>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'ck_al_action'`,
  );
  const def = rows[0]?.def;
  if (!def) throw new Error('ck_al_action が見つからない (マイグレーション未適用?)');
  return [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

describe('ck_al_action', () => {
  it('AUDIT_ACTIONS と完全に一致する', async () => {
    expect([...(await constraintValues())].sort()).toEqual([...AUDIT_ACTIONS].sort());
  });

  it('許可値はすべて実際に INSERT できる', async () => {
    // 制約定義の文字列比較だけでは、型や別の制約に阻まれる値を見逃す
    for (const action of AUDIT_ACTIONS) {
      await prisma.auditLog.create({
        data: { action, resourceType: 'test', result: 'success' },
      });
    }
    expect(await prisma.auditLog.count()).toBe(AUDIT_ACTIONS.length);
  });
});
