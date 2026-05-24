import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { ApiError } from '@trakon/shared';

export const notFoundHandler: NotFoundHandler = (c: Context) =>
  c.json<ApiError>(
    {
      error: {
        code: 'NOT_FOUND',
        message: `Route not found: ${c.req.method} ${c.req.path}`,
      },
    },
    404,
  );

export const errorMiddleware: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json<ApiError>(
      {
        error: {
          code: codeFromStatus(err.status),
          message: err.message,
        },
      },
      err.status,
    );
  }

  console.error('[trakon] unhandled error', err);
  return c.json<ApiError>(
    {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred.',
      },
    },
    500,
  );
};

function codeFromStatus(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    default:
      return status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST';
  }
}
