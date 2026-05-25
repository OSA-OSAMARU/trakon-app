import type { ApiEnvelope, ApiError } from '@trakon/shared';

import { supabase } from './supabase';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(await authHeader()),
  };
  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  // 204 No Content
  if (res.status === 204) return undefined as T;

  const json = (await res.json()) as ApiEnvelope<T> | ApiError;

  if (!res.ok) {
    const error = (json as ApiError).error;
    throw new ApiClientError(
      error?.code ?? 'UNKNOWN_ERROR',
      res.status,
      error?.message ?? `Request failed: ${res.status}`,
      error?.details,
    );
  }

  return (json as ApiEnvelope<T>).data;
}
