import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';

import type { McpScope } from '../lib/mcpOAuth.js';
import type { ApiResult, Dispatch } from './dispatch.js';
import { createTrakonMcpServer, toToolError } from './tools.js';

/** ツール結果の JSON を気軽に掘るための型 (テスト専用) */
type Json = ReturnType<typeof JSON.parse>;

// =============================================================================
// ツールは REST を呼ぶだけの薄いアダプタなので、dispatch を差し替えて
// 「どの REST をどう呼び、結果をどう整形するか」を検証する。
// =============================================================================

const P = '11111111-1111-4111-8111-111111111111';
const I = '22222222-2222-4222-8222-222222222222';
const PL = '33333333-3333-4333-8333-333333333333';
const M = '44444444-4444-4444-8444-444444444444';

const member = (id: string, name: string) => ({
  id,
  name,
  organizationName: 'Acme',
  memberType: 'production',
});

const planDto = (over: Record<string, unknown> = {}) => ({
  id: PL,
  itemId: I,
  planType: 'toss',
  title: 'デザイン初稿',
  category: 'design',
  colorTheme: null,
  scheduledDate: '2026-06-01',
  dueDate: '2026-06-03',
  executor: member(M, '田中'),
  approver: null,
  progressManager: null,
  fromMember: null,
  toMember: null,
  successorPlanId: null,
  status: 'active',
  memo: null,
  ballHolder: member(M, '田中'),
  ballState: 'in_progress',
  latestEvent: null,
  completedAt: null,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  ...over,
});

type Route = (method: string, path: string, body?: unknown) => ApiResult<unknown> | undefined;

async function setup(opts: { scopes?: McpScope[]; route: Route; itemId?: string | null }) {
  const dispatch = vi.fn(async (method: string, path: string, body?: unknown) => {
    const r = opts.route(method, path, body);
    if (!r) throw new Error(`unexpected ${method} ${path}`);
    return r;
  });
  const server = createTrakonMcpServer({
    dispatch: dispatch as unknown as Dispatch,
    scopes: opts.scopes ?? ['read', 'write'],
    resolvePlanItemId: async () => (opts.itemId === undefined ? I : opts.itemId),
    now: () => new Date('2026-06-01T00:00:00Z'),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as {
      isError?: boolean;
      structuredContent?: Json;
      content: { type: string; text: string }[];
    };
  return { client, dispatch, call };
}

const okRes = (data: unknown, extra: Record<string, unknown> = {}): ApiResult<unknown> => ({
  ok: true,
  status: 200,
  data,
  ...extra,
});
const ng = (
  status: number,
  code: string,
  message = 'x',
  details?: unknown,
): ApiResult<unknown> => ({
  ok: false,
  status,
  code,
  message,
  details,
});

describe('tools/list', () => {
  it('スコープに応じてツールを出し分け、サーバの使い方を案内する', async () => {
    const both = await setup({ route: () => undefined });
    const names = (await both.client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual([
      'list_projects',
      'get_project',
      'list_plans',
      'get_plan',
      'get_my_dashboard',
      'create_item',
      'create_plan',
      'update_plan',
      'delete_plan',
      'ball_action',
    ]);
    expect(both.client.getInstructions()).toContain('ID は推測しないでください');

    const readOnly = await setup({ scopes: ['read'], route: () => undefined });
    expect(
      (await readOnly.client.listTools()).tools.every((t) => t.annotations?.readOnlyHint),
    ).toBe(true);
    const writeOnly = await setup({ scopes: ['write'], route: () => undefined });
    const del = (await writeOnly.client.listTools()).tools.find((t) => t.name === 'delete_plan');
    expect(del?.annotations?.destructiveHint).toBe(true);
  });
});

describe('読み取りツール', () => {
  it('list_projects: today と要約を返す', async () => {
    const { call, dispatch } = await setup({
      route: (_m, path) =>
        path.startsWith('/projects')
          ? okRes([
              {
                id: P,
                name: 'A',
                clientName: 'X社',
                startDate: '2026-01-01',
                endDate: '2026-12-31',
                role: 'admin',
                progressManager: null,
                overdueCount: 2,
                createdBy: 'u',
              },
            ])
          : undefined,
    });
    const r = await call('list_projects', { archived: true });
    expect(dispatch).toHaveBeenCalledWith('GET', '/projects?limit=200&archived=true');
    expect(r.structuredContent).toEqual({
      today: '2026-06-01',
      projects: [
        {
          id: P,
          name: 'A',
          clientName: 'X社',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          myRole: 'admin',
          progressManager: null,
          overdueCount: 2,
        },
      ],
    });
    expect(JSON.parse(r.content[0]!.text)).toEqual(r.structuredContent);
  });

  it('list_projects: 失敗はツールエラー', async () => {
    const { call } = await setup({ route: () => ng(500, 'INTERNAL_SERVER_ERROR') });
    expect((await call('list_projects')).isError).toBe(true);
  });

  it('get_project: 制作物と参加者 (メール・アバターを除く) を返す', async () => {
    const { call } = await setup({
      route: (_m, path) => {
        if (path === `/projects/${P}`)
          return okRes({
            id: P,
            name: 'A',
            clientName: null,
            startDate: '2026-01-01',
            endDate: '2026-12-31',
            status: 'active',
            role: 'editor',
            progressManager: { id: M, name: '田中' },
          });
        if (path.endsWith('/items')) return okRes([{ id: I, name: 'バナー', sortOrder: 0 }]);
        if (path.endsWith('/members'))
          return okRes([
            {
              ...member(M, '田中'),
              email: 'tanaka@example.test',
              avatarUrl: 'https://signed',
              jobTitle: 'designer',
              roleType: 'admin',
            },
          ]);
        return undefined;
      },
    });
    const r = await call('get_project', { projectId: P });
    expect(r.structuredContent).toMatchObject({
      project: { id: P, myRole: 'editor', defaultProgressManager: { id: M, name: '田中' } },
      items: [{ id: I, name: 'バナー' }],
      members: [{ id: M, name: '田中', role: 'admin', jobTitle: 'designer' }],
    });
    expect(r.content[0]!.text).not.toContain('tanaka@example.test');
    expect(r.content[0]!.text).not.toContain('https://signed');
  });

  it.each(['', '/items', '/members'])('get_project: %s の失敗をそのまま返す', async (failing) => {
    const { call } = await setup({
      route: (_m, path) =>
        path === `/projects/${P}${failing}` ? ng(404, 'NOT_FOUND') : okRes(failing ? {} : []),
    });
    const r = await call('get_project', { projectId: P });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('NOT_FOUND');
  });

  it('list_plans: 期間を渡し、制作物・参加者で絞り込む', async () => {
    const other = '55555555-5555-4555-8555-555555555555';
    const { call, dispatch } = await setup({
      route: () =>
        okRes([
          planDto(),
          planDto({ id: 'p2', itemId: other }),
          planDto({ id: 'p3', executor: null, ballHolder: member(other, '佐藤') }),
        ]),
    });
    const r = await call('list_plans', {
      projectId: P,
      from: '2026-06-01',
      itemId: I,
      memberId: M,
    });
    expect(dispatch).toHaveBeenCalledWith('GET', `/projects/${P}/plans?from=2026-06-01`);
    expect(r.structuredContent!.count).toBe(1);
    expect(r.structuredContent!.plans[0]).toEqual({
      id: PL,
      itemId: I,
      title: 'デザイン初稿',
      category: 'design',
      scheduledDate: '2026-06-01',
      dueDate: '2026-06-03',
      executor: { id: M, name: '田中' },
      approver: null,
      progressManager: null,
      ballHolder: { id: M, name: '田中' },
      ballState: 'in_progress',
      status: 'active',
      successorPlanId: null,
      memo: null,
    });

    await call('list_plans', { projectId: P });
    expect(dispatch).toHaveBeenLastCalledWith('GET', `/projects/${P}/plans`);
  });

  it('list_plans: 失敗はツールエラー', async () => {
    const { call } = await setup({ route: () => ng(404, 'NOT_FOUND') });
    expect((await call('list_plans', { projectId: P })).isError).toBe(true);
  });

  it('get_plan: itemId を解決して詳細と履歴を返す', async () => {
    const { call, dispatch } = await setup({
      route: () =>
        okRes({
          plan: planDto(),
          events: [
            {
              id: 'e',
              eventType: 'review_requested',
              source: 'human',
              actor: member(M, '田中'),
              occurredAt: '2026-06-01T01:00:00.000Z',
              note: 'お願いします',
            },
          ],
        }),
    });
    const r = await call('get_plan', { projectId: P, planId: PL });
    expect(dispatch).toHaveBeenCalledWith('GET', `/projects/${P}/items/${I}/plans/${PL}`);
    expect(r.structuredContent!.events).toEqual([
      {
        eventType: 'review_requested',
        actor: { id: M, name: '田中' },
        occurredAt: '2026-06-01T01:00:00.000Z',
        note: 'お願いします',
      },
    ]);
  });

  it('get_plan: 予定が見つからなければ REST を呼ばずに NOT_FOUND', async () => {
    const { call, dispatch } = await setup({ route: () => undefined, itemId: null });
    const r = await call('get_plan', { projectId: P, planId: PL });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('NOT_FOUND');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('get_plan: REST の失敗はツールエラー', async () => {
    const { call } = await setup({ route: () => ng(404, 'NOT_FOUND') });
    expect((await call('get_plan', { projectId: P, planId: PL })).isError).toBe(true);
  });

  it('get_my_dashboard: 自分の予定があるプロジェクトだけ返す', async () => {
    const task = { planId: PL, title: 't', isOverdue: false };
    const { call } = await setup({
      route: () =>
        okRes({
          today: '2026-06-01',
          summary: { todayTaskCount: 1, overdueCount: 0 },
          projects: [
            {
              id: P,
              name: 'A',
              memberSections: [
                { member: { isMe: true }, tasks: [task] },
                { member: { isMe: false }, tasks: [{ planId: 'other' }] },
              ],
            },
            { id: 'q', name: 'B', memberSections: [{ member: { isMe: false }, tasks: [{}] }] },
          ],
        }),
    });
    const r = await call('get_my_dashboard');
    expect(r.structuredContent).toEqual({
      today: '2026-06-01',
      summary: { todayTaskCount: 1, overdueCount: 0 },
      projects: [{ id: P, name: 'A', myTasks: [task] }],
    });
  });

  it('get_my_dashboard: 失敗はツールエラー', async () => {
    const { call } = await setup({ route: () => ng(404, 'PROFILE_NOT_COMPLETED') });
    expect((await call('get_my_dashboard')).isError).toBe(true);
  });
});

describe('書き込みツール', () => {
  it('create_item', async () => {
    const { call, dispatch } = await setup({ route: () => okRes({ id: I, name: 'LP' }) });
    const r = await call('create_item', { projectId: P, name: 'LP' });
    expect(dispatch).toHaveBeenCalledWith('POST', `/projects/${P}/items`, { name: 'LP' });
    expect(r.structuredContent).toEqual({ item: { id: I, name: 'LP' } });
  });

  it('create_plan: 未指定の項目は送らない', async () => {
    const { call, dispatch } = await setup({ route: () => okRes(planDto()) });
    const r = await call('create_plan', {
      projectId: P,
      itemId: I,
      title: 'デザイン初稿',
      category: 'design',
      scheduledDate: '2026-06-01',
      executorMemberId: M,
    });
    expect(dispatch).toHaveBeenCalledWith('POST', `/projects/${P}/items/${I}/plans`, {
      title: 'デザイン初稿',
      category: 'design',
      scheduledDate: '2026-06-01',
      executorMemberId: M,
    });
    expect(r.structuredContent!.plan.id).toBe(PL);
  });

  it('create_plan: 入力が不正なら REST を呼ばない', async () => {
    const { call, dispatch } = await setup({ route: () => okRes(planDto()) });
    const r = await call('create_plan', {
      projectId: P,
      itemId: I,
      title: 'x',
      category: 'unknown',
      scheduledDate: '6/1',
    });
    expect(r.isError).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('update_plan: null は解除として送る', async () => {
    const { call, dispatch } = await setup({ route: () => okRes(planDto()) });
    await call('update_plan', { projectId: P, planId: PL, dueDate: null, title: '改題' });
    expect(dispatch).toHaveBeenCalledWith('PATCH', `/projects/${P}/items/${I}/plans/${PL}`, {
      dueDate: null,
      title: '改題',
    });
  });

  it('update_plan: 変更項目が無ければエラー', async () => {
    const { call, dispatch } = await setup({ route: () => okRes(planDto()) });
    const r = await call('update_plan', { projectId: P, planId: PL });
    expect(r.isError).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('delete_plan', async () => {
    const { call, dispatch } = await setup({
      route: () => ({ ok: true, status: 204, data: undefined }),
    });
    const r = await call('delete_plan', { projectId: P, planId: PL });
    expect(dispatch).toHaveBeenCalledWith('DELETE', `/projects/${P}/items/${I}/plans/${PL}`);
    expect(r.structuredContent).toEqual({ deleted: true, planId: PL });
  });

  it('ball_action: 操作ごとのエンドポイントへ note を添えて送り、警告も返す', async () => {
    const { call, dispatch } = await setup({
      route: () =>
        okRes(
          { plan: planDto({ ballState: 'review_pending' }), predecessor: planDto({ id: 'pre' }) },
          { warnings: ['MAIL_FAILED'] },
        ),
    });
    const r = await call('ball_action', {
      projectId: P,
      planId: PL,
      action: 'send_back_to_predecessor',
      note: '仕様変更',
    });
    expect(dispatch).toHaveBeenCalledWith(
      'POST',
      `/projects/${P}/items/${I}/plans/${PL}/send-back-to-predecessor`,
      { note: '仕様変更' },
    );
    expect(r.structuredContent).toMatchObject({
      action: 'send_back_to_predecessor',
      plan: { ballState: 'review_pending' },
      predecessor: { id: 'pre' },
      warnings: ['MAIL_FAILED'],
    });

    await call('ball_action', { projectId: P, planId: PL, action: 'approve' });
    expect(dispatch).toHaveBeenLastCalledWith(
      'POST',
      `/projects/${P}/items/${I}/plans/${PL}/approve`,
      {},
    );
  });

  it.each(['update_plan', 'delete_plan', 'ball_action'])(
    '%s: 予定が見つからなければ NOT_FOUND',
    async (name) => {
      const { call, dispatch } = await setup({ route: () => undefined, itemId: null });
      const r = await call(name, { projectId: P, planId: PL, title: 'x', action: 'toss' });
      expect(r.isError).toBe(true);
      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['create_item', { projectId: P, name: 'x' }],
    [
      'create_plan',
      { projectId: P, itemId: I, title: 'x', category: 'design', scheduledDate: '2026-06-01' },
    ],
    ['update_plan', { projectId: P, planId: PL, title: 'x' }],
    ['delete_plan', { projectId: P, planId: PL }],
    ['ball_action', { projectId: P, planId: PL, action: 'toss' }],
  ])('%s: REST の失敗はツールエラー', async (name, args) => {
    const { call } = await setup({
      route: () => ng(403, 'SUBSCRIPTION_READ_ONLY', '閲覧のみです'),
    });
    const r = await call(name, args);
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe('SUBSCRIPTION_READ_ONLY: 閲覧のみです');
  });
});

describe('toToolError', () => {
  it('Zod の項目エラーを読める形で添える', () => {
    const r = toToolError({
      ok: false,
      status: 422,
      code: 'UNPROCESSABLE_ENTITY',
      message: 'Validation failed.',
      details: { fieldErrors: { dueDate: ['dueDate must be on or after scheduledDate.'] } },
    });
    expect(r.content[0]).toEqual({
      type: 'text',
      text: 'UNPROCESSABLE_ENTITY: Validation failed.\n- dueDate: dueDate must be on or after scheduledDate.',
    });
  });
  it('項目エラーが空なら添えない', () => {
    const r = toToolError({
      ok: false,
      status: 400,
      code: 'X',
      message: 'm',
      details: { fieldErrors: {} },
    });
    expect(r.content[0]).toEqual({ type: 'text', text: 'X: m' });
  });
});
