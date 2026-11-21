import { createHash, randomBytes } from 'node:crypto';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';

import { prisma } from '@trakon/db';

import { app } from '../../app.js';
import { api } from '../../test/request.js';
import {
  addProjectMemberWithRole,
  createItem,
  createOutsider,
  setupProjectWithDirector,
} from '../../test/factories.js';

/** ツール結果の JSON を気軽に掘るための型 (テスト専用) */
type Json = ReturnType<typeof JSON.parse>;

// =============================================================================
// AI 連携 (MCP) の通し試験 (設計書 08-mcp §8.12)
//   動的クライアント登録 → 同意 → トークン交換 → tools/list → tools/call
//   → リフレッシュのローテーション → 接続解除、までを実 DB で通す。
// =============================================================================

const REDIRECT_URI = 'http://127.0.0.1:33418/callback';
const ORIGIN = 'http://localhost';

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function registerClient(): Promise<string> {
  const res = await app.request('/api/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Test AI', redirect_uris: [REDIRECT_URI] }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { client_id: string };
  return body.client_id;
}

/** 同意画面 (SC-20) で許可し、トークンまで交換する */
async function connect(jwt: string, scope = 'read write') {
  const clientId = await registerClient();
  const { verifier, challenge } = pkcePair();
  const params = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
    scope,
    resource: `${ORIGIN}/api/mcp`,
  };

  const check = await api<{
    data: { status: string; client: { name: string }; redirectHost: string };
  }>(`/api/v1/oauth/authorize?${new URLSearchParams(params)}`, { token: jwt });
  expect(check.status).toBe(200);
  expect(check.body.data).toMatchObject({
    status: 'consent',
    client: { name: 'Test AI' },
    redirectHost: '127.0.0.1:33418',
  });

  const decided = await api<{ data: { redirectTo: string } }>('/api/v1/oauth/authorize', {
    method: 'POST',
    token: jwt,
    body: { params, approved: true },
  });
  expect(decided.status).toBe(200);
  const redirect = new URL(decided.body.data.redirectTo);
  expect(redirect.searchParams.get('state')).toBe('xyz');
  expect(redirect.searchParams.get('iss')).toBe(ORIGIN);
  const code = redirect.searchParams.get('code')!;

  const tokenRes = await app.request('/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      resource: `${ORIGIN}/api/mcp`,
    }).toString(),
  });
  expect(tokenRes.status).toBe(200);
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    scope: string;
  };
  return { clientId, code, verifier, ...tokens };
}

let rpcId = 0;
async function mcp(accessToken: string, method: string, params: Record<string, unknown> = {}) {
  const res = await app.request('/api/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Json) : null };
}

async function callTool(accessToken: string, name: string, args: Record<string, unknown>) {
  const res = await mcp(accessToken, 'tools/call', { name, arguments: args });
  expect(res.status).toBe(200);
  return res.body!.result as {
    isError?: boolean;
    structuredContent?: Json;
    content: { type: string; text: string }[];
  };
}

describe('MCP (AI 連携) end-to-end', () => {
  it('discovery: 未認証の /api/mcp は WWW-Authenticate でメタデータを案内する', async () => {
    const res = await app.request('/api/mcp', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`,
    );

    const prm = await app.request('/.well-known/oauth-protected-resource/api/mcp');
    expect(await prm.json()).toMatchObject({
      resource: `${ORIGIN}/api/mcp`,
      authorization_servers: [ORIGIN],
    });
    const as = await app.request('/.well-known/oauth-authorization-server');
    expect(await as.json()).toMatchObject({
      issuer: ORIGIN,
      registration_endpoint: `${ORIGIN}/api/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    });
  });

  it('同意 → トークン → 予定の作成・一覧 → リフレッシュ → 接続解除', async () => {
    const { user, project, member, token: jwt } = await setupProjectWithDirector();
    const item = await createItem({ projectId: project.id, name: 'バナー' });
    const tokens = await connect(jwt);
    expect(tokens.scope).toBe('read write');

    // 監査ログに接続が残る
    const connected = await prisma.auditLog.findFirst({ where: { action: 'mcp_connected' } });
    expect(connected?.actorUserId).toBe(user.id);

    // 認可コードは 1 回限り
    const replay = await app.request('/api/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: tokens.code,
        code_verifier: tokens.verifier,
        client_id: tokens.clientId,
        redirect_uri: REDIRECT_URI,
      }).toString(),
    });
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' });

    // tools/list
    const list = await mcp(tokens.access_token, 'tools/list');
    expect(list.status).toBe(200);
    const names = (list.body!.result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['list_projects', 'get_project', 'create_plan', 'ball_action']),
    );

    // list_projects → get_project
    const projects = await callTool(tokens.access_token, 'list_projects', {});
    expect(projects.structuredContent!.projects).toEqual([
      expect.objectContaining({ id: project.id, myRole: 'admin' }),
    ]);
    const detail = await callTool(tokens.access_token, 'get_project', { projectId: project.id });
    expect(detail.structuredContent!.items).toEqual([{ id: item.id, name: 'バナー' }]);
    expect(detail.structuredContent!.members[0]).toMatchObject({ id: member.id, isMe: true });
    expect(detail.structuredContent!.members[0]).not.toHaveProperty('email');

    // create_plan は REST を通るので、DB に入り監査対象のルールも同じ
    const created = await callTool(tokens.access_token, 'create_plan', {
      projectId: project.id,
      itemId: item.id,
      title: 'デザイン初稿',
      category: 'design',
      scheduledDate: '2026-06-01',
      dueDate: '2026-06-03',
      executorMemberId: member.id,
    });
    expect(created.isError).toBeFalsy();
    const planId = created.structuredContent!.plan.id as string;
    const row = await prisma.plan.findUnique({ where: { id: planId } });
    expect(row).toMatchObject({ title: 'デザイン初稿', executorMemberId: member.id });

    // 期間外は REST のエラーがそのままツールエラーとして返る
    const outOfPeriod = await callTool(tokens.access_token, 'create_plan', {
      projectId: project.id,
      itemId: item.id,
      title: '期間外',
      category: 'design',
      scheduledDate: '2027-06-01',
    });
    expect(outOfPeriod.isError).toBe(true);

    // update_plan は planId だけで操作できる (itemId は MCP 側で解決)
    const updated = await callTool(tokens.access_token, 'update_plan', {
      projectId: project.id,
      planId,
      scheduledDate: '2026-06-02',
      dueDate: '2026-06-05',
    });
    expect(updated.structuredContent!.plan).toMatchObject({
      scheduledDate: '2026-06-02',
      dueDate: '2026-06-05',
    });

    const plans = await callTool(tokens.access_token, 'list_plans', {
      projectId: project.id,
      memberId: member.id,
    });
    expect(plans.structuredContent!.count).toBe(1);

    // ボール操作: 承認者を付けて確認依頼 → 承認者にボールが移り、履歴にメッセージが残る
    const reviewer = await addProjectMemberWithRole({ projectId: project.id, roleType: 'editor' });
    await callTool(tokens.access_token, 'update_plan', {
      projectId: project.id,
      planId,
      approverMemberId: reviewer.member.id,
    });
    const requested = await callTool(tokens.access_token, 'ball_action', {
      projectId: project.id,
      planId,
      action: 'request_review',
      note: '初稿です。ご確認ください',
    });
    expect(requested.isError).toBeFalsy();
    expect(requested.structuredContent!.plan).toMatchObject({
      ballState: 'review_pending',
      ballHolder: { id: reviewer.member.id },
    });
    const history = await callTool(tokens.access_token, 'get_plan', {
      projectId: project.id,
      planId,
    });
    expect(history.structuredContent!.events[0]).toMatchObject({
      eventType: 'review_requested',
      note: '初稿です。ご確認ください',
    });

    // リフレッシュ: 新しいペアが出て、古いアクセストークン・リフレッシュトークンは無効
    const refreshRes = await app.request('/api/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: tokens.clientId,
      }).toString(),
    });
    expect(refreshRes.status).toBe(200);
    const refreshed = (await refreshRes.json()) as { access_token: string; refresh_token: string };
    expect((await mcp(tokens.access_token, 'tools/list')).status).toBe(401);
    expect((await mcp(refreshed.access_token, 'tools/list')).status).toBe(200);
    const reuse = await app.request('/api/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: tokens.clientId,
      }).toString(),
    });
    expect(reuse.status).toBe(400);

    // SC-21: 一覧 → 接続解除 → 以後 401
    const conns = await api<{ data: { id: string; clientName: string }[] }>(
      '/api/v1/ai-connections',
      { token: jwt },
    );
    expect(conns.body.data).toEqual([expect.objectContaining({ clientName: 'Test AI' })]);
    const del = await api(`/api/v1/ai-connections/${conns.body.data[0]!.id}`, {
      method: 'DELETE',
      token: jwt,
    });
    expect(del.status).toBe(204);
    expect((await mcp(refreshed.access_token, 'tools/list')).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'mcp_revoked' } })).toBe(1);
  });

  it('公式 SDK のクライアントで初期化からツール呼び出しまでできる', async () => {
    const { project, token: jwt } = await setupProjectWithDirector();
    const tokens = await connect(jwt);
    const client = new Client({ name: 'sdk-client', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${ORIGIN}/api/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
        fetch: async (url, init) => app.fetch(new Request(url, init)),
      }),
    );
    expect(client.getServerVersion()).toMatchObject({ name: 'trakon' });
    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    expect((result.structuredContent as Json).projects[0].id).toBe(project.id);
    await client.close();
  });

  it('read スコープだけなら書き込みツールを提示しない', async () => {
    const { token: jwt } = await setupProjectWithDirector();
    const tokens = await connect(jwt, 'read');
    const list = await mcp(tokens.access_token, 'tools/list');
    const names = (list.body!.result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toContain('list_plans');
    expect(names).not.toContain('create_plan');
  });

  it('権限は画面と同じ: 閲覧者は予定を作れず、非参加者には 404 になる', async () => {
    const { project } = await setupProjectWithDirector();
    const item = await createItem({ projectId: project.id });

    const viewer = await addProjectMemberWithRole({ projectId: project.id, roleType: 'viewer' });
    const viewerTokens = await connect(viewer.token);
    const denied = await callTool(viewerTokens.access_token, 'create_plan', {
      projectId: project.id,
      itemId: item.id,
      title: 'x',
      category: 'design',
      scheduledDate: '2026-06-01',
    });
    expect(denied.isError).toBe(true);
    expect(denied.content[0]!.text).toContain('NOT_FOUND');
    expect(await prisma.plan.count()).toBe(0);

    const outsider = await createOutsider();
    const outsiderTokens = await connect(outsider.token);
    const hidden = await callTool(outsiderTokens.access_token, 'get_project', {
      projectId: project.id,
    });
    expect(hidden.isError).toBe(true);
    expect(hidden.content[0]!.text).toContain('NOT_FOUND');
  });

  it('外部からの Request は内部経路に入れない (偽の Bearer は JWT として検証される)', async () => {
    const { project } = await setupProjectWithDirector();
    const res = await api(`/api/v1/projects/${project.id}`, { token: 'trk_at_forged' });
    expect(res.status).toBe(401);
  });
});
