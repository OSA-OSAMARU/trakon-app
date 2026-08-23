import { describe, expect, it } from 'vitest';

import {
  createProjectBodySchema,
  listProjectsQuerySchema,
  updateProjectBodySchema,
} from './projects.js';

describe('createProjectBodySchema', () => {
  const base = {
    name: 'Test',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    items: [{ name: 'Top' }],
    members: [],
  };

  it('accepts a minimal valid body', () => {
    const r = createProjectBodySchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it('rejects when endDate is before startDate', () => {
    const r = createProjectBodySchema.safeParse({
      ...base,
      startDate: '2026-12-31',
      endDate: '2026-01-01',
    });
    expect(r.success).toBe(false);
  });

  it('rejects when items is empty', () => {
    const r = createProjectBodySchema.safeParse({ ...base, items: [] });
    expect(r.success).toBe(false);
  });

  it('rejects duplicate member emails (case-insensitive)', () => {
    const r = createProjectBodySchema.safeParse({
      ...base,
      members: [
        { name: 'A', email: 'a@example.com', organizationName: '', memberType: 'production' },
        { name: 'B', email: 'A@example.com', organizationName: '', memberType: 'client' },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('rejects invalid date format', () => {
    const r = createProjectBodySchema.safeParse({ ...base, startDate: '2026/01/01' });
    expect(r.success).toBe(false);
  });
});

describe('updateProjectBodySchema', () => {
  it('accepts a single field update', () => {
    expect(updateProjectBodySchema.safeParse({ name: 'New' }).success).toBe(true);
  });

  it('rejects endDate before startDate when both provided', () => {
    const r = updateProjectBodySchema.safeParse({
      startDate: '2026-12-31',
      endDate: '2026-01-01',
    });
    expect(r.success).toBe(false);
  });
});

describe('listProjectsQuerySchema', () => {
  it("parses archived='true' as boolean true", () => {
    const r = listProjectsQuerySchema.parse({ archived: 'true' });
    expect(r.archived).toBe(true);
  });

  it("parses archived='false' as boolean false", () => {
    const r = listProjectsQuerySchema.parse({ archived: 'false' });
    expect(r.archived).toBe(false);
  });

  it('leaves archived undefined when omitted', () => {
    const r = listProjectsQuerySchema.parse({});
    expect(r.archived).toBeUndefined();
  });

  it('rejects an invalid archived value', () => {
    expect(listProjectsQuerySchema.safeParse({ archived: 'yes' }).success).toBe(false);
  });

  it('applies default limit/offset', () => {
    const r = listProjectsQuerySchema.parse({});
    expect(r.limit).toBe(50);
    expect(r.offset).toBe(0);
  });
});

describe('#147 で追加した項目', () => {
  const base = {
    name: 'P',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    items: [{ name: 'I' }],
  };

  it('クライアント名は任意で、空文字は未設定に正規化される', () => {
    expect(createProjectBodySchema.parse(base).clientName).toBeUndefined();
    expect(createProjectBodySchema.parse({ ...base, clientName: '  ' }).clientName).toBeUndefined();
    expect(
      createProjectBodySchema.parse({ ...base, clientName: ' 株式会社灯和食品 ' }).clientName,
    ).toBe('株式会社灯和食品');
  });

  it('区分に外部パートナーを受け付ける', () => {
    const parsed = createProjectBodySchema.parse({
      ...base,
      members: [{ name: '外部 太郎', memberType: 'partner' }],
    });
    expect(parsed.members[0]!.memberType).toBe('partner');
  });

  it('職種はマスタの値のみ受け付け、空文字は未設定に正規化される', () => {
    const ok = createProjectBodySchema.parse({
      ...base,
      members: [{ name: 'A', memberType: 'production', jobTitle: 'frontend_engineer' }],
    });
    expect(ok.members[0]!.jobTitle).toBe('frontend_engineer');

    const blank = createProjectBodySchema.parse({
      ...base,
      members: [{ name: 'A', memberType: 'production', jobTitle: '' }],
    });
    expect(blank.members[0]!.jobTitle).toBeUndefined();

    expect(
      createProjectBodySchema.safeParse({
        ...base,
        members: [{ name: 'A', memberType: 'production', jobTitle: 'unknown_role' }],
      }).success,
    ).toBe(false);
  });

  it('更新ではクライアント名を null で明示的にクリアできる', () => {
    expect(updateProjectBodySchema.parse({ clientName: null }).clientName).toBeNull();
  });
});
