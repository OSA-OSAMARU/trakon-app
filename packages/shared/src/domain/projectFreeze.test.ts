import { describe, expect, it } from 'vitest';

import {
  isProjectFrozen,
  selectFrozenProjectIds,
  type FreezableProject,
} from './projectFreeze.js';

function project(
  id: string,
  createdAt: string,
  over: Partial<FreezableProject> = {},
): FreezableProject {
  return { id, createdAt, archivedAt: null, retainedAt: null, ...over };
}

describe('selectFrozenProjectIds', () => {
  it('上限内なら何も凍結しない', () => {
    const r = selectFrozenProjectIds(
      [project('a', '2026-01-01T00:00:00Z'), project('b', '2026-01-02T00:00:00Z')],
      2,
    );
    expect(r.activeIds).toEqual(['a', 'b']);
    expect(r.frozenIds).toEqual([]);
  });

  it('未指定なら作成が古い順に維持し、新しいものを凍結する', () => {
    const r = selectFrozenProjectIds(
      [
        project('c', '2026-03-01T00:00:00Z'),
        project('a', '2026-01-01T00:00:00Z'),
        project('b', '2026-02-01T00:00:00Z'),
      ],
      2,
    );
    expect(r.activeIds).toEqual(['a', 'b']);
    expect(r.frozenIds).toEqual(['c']);
  });

  it('維持指定されたものが最優先で残る', () => {
    const r = selectFrozenProjectIds(
      [
        project('a', '2026-01-01T00:00:00Z'),
        project('b', '2026-02-01T00:00:00Z'),
        project('c', '2026-03-01T00:00:00Z', { retainedAt: '2026-08-01T00:00:00Z' }),
      ],
      1,
    );
    expect(r.activeIds).toEqual(['c']);
    expect(r.frozenIds).toEqual(['a', 'b']);
  });

  it('維持指定が複数あるときは指定が新しい順', () => {
    const r = selectFrozenProjectIds(
      [
        project('a', '2026-01-01T00:00:00Z', { retainedAt: '2026-08-01T00:00:00Z' }),
        project('b', '2026-02-01T00:00:00Z', { retainedAt: '2026-08-02T00:00:00Z' }),
      ],
      1,
    );
    expect(r.activeIds).toEqual(['b']);
    expect(r.frozenIds).toEqual(['a']);
  });

  it('アーカイブ済みは判定対象外 (＝枠を空ける正規の動線)', () => {
    const r = selectFrozenProjectIds(
      [
        project('archived', '2026-01-01T00:00:00Z', { archivedAt: '2026-06-01T00:00:00Z' }),
        project('a', '2026-02-01T00:00:00Z'),
        project('b', '2026-03-01T00:00:00Z'),
      ],
      2,
    );
    expect(r.archivedIds).toEqual(['archived']);
    expect(r.activeIds).toEqual(['a', 'b']);
    expect(r.frozenIds).toEqual([]);
  });

  it('上限が無制限なら全件が有効', () => {
    const r = selectFrozenProjectIds(
      [project('a', '2026-01-01T00:00:00Z'), project('b', '2026-02-01T00:00:00Z')],
      null,
    );
    expect(r.frozenIds).toEqual([]);
    expect(r.activeIds).toEqual(['a', 'b']);
  });

  it('上限 0 なら全件凍結', () => {
    const r = selectFrozenProjectIds([project('a', '2026-01-01T00:00:00Z')], 0);
    expect(r.activeIds).toEqual([]);
    expect(r.frozenIds).toEqual(['a']);
  });

  it('作成日時が同一なら ID の昇順で決定的に決まる', () => {
    const r = selectFrozenProjectIds(
      [project('b', '2026-01-01T00:00:00Z'), project('a', '2026-01-01T00:00:00Z')],
      1,
    );
    expect(r.activeIds).toEqual(['a']);
    expect(r.frozenIds).toEqual(['b']);
  });

  it('入力配列を破壊しない', () => {
    const projects = [project('b', '2026-02-01T00:00:00Z'), project('a', '2026-01-01T00:00:00Z')];
    selectFrozenProjectIds(projects, 1);
    expect(projects.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('Date オブジェクトでも判定できる', () => {
    const r = selectFrozenProjectIds(
      [
        { id: 'a', createdAt: new Date('2026-01-01'), archivedAt: null, retainedAt: null },
        { id: 'b', createdAt: new Date('2026-02-01'), archivedAt: null, retainedAt: null },
      ],
      1,
    );
    expect(r.activeIds).toEqual(['a']);
  });
});

describe('isProjectFrozen', () => {
  const projects = [
    project('a', '2026-01-01T00:00:00Z'),
    project('b', '2026-02-01T00:00:00Z'),
    project('c', '2026-03-01T00:00:00Z'),
  ];

  it('上限を超えたプロジェクトを凍結と判定する', () => {
    expect(isProjectFrozen('c', projects, 2)).toBe(true);
    expect(isProjectFrozen('a', projects, 2)).toBe(false);
  });

  it('上限が無制限なら凍結しない', () => {
    expect(isProjectFrozen('c', projects, null)).toBe(false);
  });
});
