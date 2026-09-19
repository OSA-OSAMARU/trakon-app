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

const USER_A = '018f1a2b-3c4d-7e8f-9012-3456789abcde';

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
      members: [{ userId: USER_A, memberType: 'partner' }],
    });
    expect(parsed.members[0]!.memberType).toBe('partner');
  });

  it('参加者は組織メンバーの userId で指定する (#202)', () => {
    // 氏名・メール・所属・職種は users 側が正なので、ここでは受け取らない
    const parsed = createProjectBodySchema.parse({
      ...base,
      members: [{ userId: USER_A, memberType: 'production', roleType: 'viewer' }],
    });
    expect(parsed.members[0]).toEqual({
      userId: USER_A,
      memberType: 'production',
      roleType: 'viewer',
    });

    // 権限は省略できる (組織の既定ロールをサーバーが使う)
    expect(
      createProjectBodySchema.safeParse({
        ...base,
        members: [{ userId: USER_A, memberType: 'production' }],
      }).success,
    ).toBe(true);

    // userId が UUID でなければ弾く
    expect(
      createProjectBodySchema.safeParse({
        ...base,
        members: [{ userId: 'not-a-uuid', memberType: 'production' }],
      }).success,
    ).toBe(false);
  });

  it('同じ参加者を 2 回指定できない', () => {
    expect(
      createProjectBodySchema.safeParse({
        ...base,
        members: [
          { userId: USER_A, memberType: 'production' },
          { userId: USER_A, memberType: 'client' },
        ],
      }).success,
    ).toBe(false);
  });

  it('更新ではクライアント名を null で明示的にクリアできる', () => {
    expect(updateProjectBodySchema.parse({ clientName: null }).clientName).toBeNull();
  });
});
