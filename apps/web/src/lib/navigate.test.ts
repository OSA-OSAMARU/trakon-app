import { afterEach, describe, expect, it, vi } from 'vitest';

import { externalRedirect } from './navigate';

// Stripe の Checkout / Customer Portal への遷移は jsdom で追えないため
// ここを唯一の窓口にしている。画面側はこのラッパをモックしてテストする。

const assign = vi.fn();
const original = window.location;

afterEach(() => {
  Object.defineProperty(window, 'location', { value: original, writable: true });
  assign.mockReset();
});

describe('externalRedirect', () => {
  it('外部サイトへ遷移する', () => {
    Object.defineProperty(window, 'location', {
      value: { ...original, assign },
      writable: true,
    });

    externalRedirect('https://checkout.stripe.test/cs_1');

    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/cs_1');
  });
});
