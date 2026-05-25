import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class ApiException extends Error {
  constructor(
    public readonly code: string,
    public readonly status: ContentfulStatusCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiException';
  }
}
