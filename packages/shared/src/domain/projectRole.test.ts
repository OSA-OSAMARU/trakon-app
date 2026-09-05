import { describe, expect, it } from 'vitest';

import {
  allowedProjectActions,
  canPerformBallAction,
  canProjectRole,
  isProjectRole,
  PROJECT_ACTIONS,
  PROJECT_ROLE_MATRIX,
  PROJECT_ROLES,
  type ProjectAction,
  type ProjectRole,
} from './projectRole.js';

describe('PROJECT_ROLE_MATRIX', () => {
  it('全ての操作に対して許可ロールが宣言されている', () => {
    for (const action of PROJECT_ACTIONS) {
      expect(PROJECT_ROLE_MATRIX[action]).toBeDefined();
    }
    expect(Object.keys(PROJECT_ROLE_MATRIX).sort()).toEqual([...PROJECT_ACTIONS].sort());
  });

  it('許可ロールは PROJECT_ROLES のいずれかのみ', () => {
    for (const roles of Object.values(PROJECT_ROLE_MATRIX)) {
      for (const role of roles) {
        expect(PROJECT_ROLES).toContain(role);
      }
    }
  });

  // 権限メモ (2026-08-26) をそのまま表にしたもの。
  // ここが仕様の受け入れ条件であり、実装を変えるならこの表を先に更新する。
  const expected: Record<ProjectAction, ProjectRole[]> = {
    'project.view': ['admin', 'editor', 'viewer'],
    'project.update': ['admin'],
    'project.archive': ['admin'],
    'item.create': ['admin'],
    'item.update': ['admin'],
    'item.delete': ['admin'],
    'plan.create': ['admin', 'editor'],
    'plan.update': ['admin', 'editor'],
    'plan.delete': ['admin', 'editor'],
    'plan.complete': ['admin', 'editor', 'viewer'],
    'plan.toss': ['admin'],
    'member.create': ['admin'],
    'member.update': ['admin'],
    'member.remove': ['admin'],
    'member.invite': ['admin'],
    'share_link.view': ['admin', 'editor', 'viewer'],
    'share_link.create': ['admin'],
    'share_link.revoke': ['admin'],
    'comment.create': ['admin', 'editor', 'viewer'],
  };

  it.each(PROJECT_ACTIONS)('%s の許可ロールが権限メモと一致する', (action) => {
    for (const role of PROJECT_ROLES) {
      expect(canProjectRole(role, action)).toBe(expected[action].includes(role));
    }
  });
});

describe('canProjectRole — 重要な境界', () => {
  it('TOSS は管理者のみが実行できる', () => {
    expect(canProjectRole('admin', 'plan.toss')).toBe(true);
    expect(canProjectRole('editor', 'plan.toss')).toBe(false);
    expect(canProjectRole('viewer', 'plan.toss')).toBe(false);
  });

  it('閲覧者は予定を作成・編集・削除できない', () => {
    for (const action of ['plan.create', 'plan.update', 'plan.delete'] as const) {
      expect(canProjectRole('viewer', action)).toBe(false);
      expect(canProjectRole('editor', action)).toBe(true);
    }
  });

  it('編集者は制作物を操作できない', () => {
    for (const action of ['item.create', 'item.update', 'item.delete'] as const) {
      expect(canProjectRole('editor', action)).toBe(false);
      expect(canProjectRole('admin', action)).toBe(true);
    }
  });

  it('完了フローは全ロールが実行できる (ボール保持者条件は別途)', () => {
    for (const role of PROJECT_ROLES) {
      expect(canProjectRole(role, 'plan.complete')).toBe(true);
    }
  });

  it('参加者管理・共有リンク発行は管理者のみ', () => {
    for (const action of [
      'member.create',
      'member.update',
      'member.remove',
      'member.invite',
      'share_link.create',
      'share_link.revoke',
    ] as const) {
      expect(canProjectRole('admin', action)).toBe(true);
      expect(canProjectRole('editor', action)).toBe(false);
      expect(canProjectRole('viewer', action)).toBe(false);
    }
  });
});

describe('canPerformBallAction — 2 段判定', () => {
  it('管理者はボール保持者でなくても完了フローを実行できる (上位権限)', () => {
    expect(canPerformBallAction({ role: 'admin', action: 'plan.complete', isHolder: false })).toBe(
      true,
    );
  });

  it('管理者はボール保持者でなくても TOSS できる', () => {
    expect(canPerformBallAction({ role: 'admin', action: 'plan.toss', isHolder: false })).toBe(true);
  });

  it('編集者・閲覧者は自分がボール保持者のときだけ完了フローを実行できる', () => {
    for (const role of ['editor', 'viewer'] as const) {
      expect(canPerformBallAction({ role, action: 'plan.complete', isHolder: true })).toBe(true);
      expect(canPerformBallAction({ role, action: 'plan.complete', isHolder: false })).toBe(false);
    }
  });

  it('編集者・閲覧者はボール保持者であっても TOSS できない', () => {
    for (const role of ['editor', 'viewer'] as const) {
      expect(canPerformBallAction({ role, action: 'plan.toss', isHolder: true })).toBe(false);
    }
  });
});

describe('allowedProjectActions', () => {
  it('管理者は全ての操作が許可される', () => {
    expect(allowedProjectActions('admin')).toEqual([...PROJECT_ACTIONS]);
  });

  it('閲覧者は閲覧・完了フロー・コメントのみ', () => {
    expect(allowedProjectActions('viewer')).toEqual([
      'project.view',
      'plan.complete',
      'share_link.view',
      'comment.create',
    ]);
  });
});

describe('isProjectRole', () => {
  it.each(PROJECT_ROLES)('%s を受け入れる', (role) => {
    expect(isProjectRole(role)).toBe(true);
  });

  it.each(['director', 'member', 'production', 'client', ''])('%s を拒否する', (value) => {
    expect(isProjectRole(value)).toBe(false);
  });
});
