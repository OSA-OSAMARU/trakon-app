import { describe, expect, it } from 'vitest';

import { ApiException } from './errors.js';

describe('ApiException', () => {
  it('preserves code, status, message, details', () => {
    const err = new ApiException('SAME_EMAIL_DIFFERENT_PROVIDER', 409, 'conflict', {
      primaryAuthMethod: 'google',
    });
    expect(err.code).toBe('SAME_EMAIL_DIFFERENT_PROVIDER');
    expect(err.status).toBe(409);
    expect(err.message).toBe('conflict');
    expect(err.details).toEqual({ primaryAuthMethod: 'google' });
    expect(err.name).toBe('ApiException');
  });
});
