import { apiRequest } from '@/lib/api';

/**
 * AI 連携 (MCP) — 設計書 08-mcp §8.10
 *  - SC-20 同意画面: /oauth/authorize
 *  - SC-21 AI 連携設定: /settings/ai
 */

export type AiScope = 'read' | 'write';

export const AI_SCOPE_LABEL: Record<AiScope, string> = {
  read: 'プロジェクト・制作物・予定・参加者の閲覧',
  write: '制作物と予定の作成・変更・削除、ボールの受け渡し',
};

/** 同意画面に引き継ぐ OAuth の認可リクエストのパラメータ */
export const AUTHORIZE_PARAM_KEYS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope',
  'resource',
] as const;
export type AuthorizeParams = Partial<Record<(typeof AUTHORIZE_PARAM_KEYS)[number], string>>;

export type AuthorizeCheck =
  | {
      status: 'consent';
      client: { id: string; name: string };
      /** 戻り先のホスト。アプリ名は自己申告なので、こちらを並べて見せる */
      redirectHost: string;
      scopes: AiScope[];
    }
  | { status: 'redirect'; redirectTo: string };

export type AiConnection = {
  id: string;
  clientName: string;
  scopes: AiScope[];
  createdAt: string;
  lastUsedAt: string | null;
};

export const aiConnectionsQueryKey = ['ai-connections'] as const;

export const aiApi = {
  checkAuthorize: (params: AuthorizeParams) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
    return apiRequest<AuthorizeCheck>(`/oauth/authorize?${qs}`);
  },
  decideAuthorize: (params: AuthorizeParams, approved: boolean) =>
    apiRequest<{ redirectTo: string }>('/oauth/authorize', {
      method: 'POST',
      body: { params, approved },
    }),
  listConnections: () => apiRequest<AiConnection[]>('/ai-connections'),
  revokeConnection: (id: string) => apiRequest<void>(`/ai-connections/${id}`, { method: 'DELETE' }),
};

/** 画面に出す MCP サーバの URL (この環境のオリジン + /api/mcp) */
export function mcpServerUrl(origin: string = window.location.origin): string {
  return `${origin}/api/mcp`;
}

/** 同意画面から AI アプリへ戻る遷移。テストで差し替えられるよう関数に切り出す */
export const navigateAway = {
  to(url: string) {
    window.location.assign(url);
  },
};
