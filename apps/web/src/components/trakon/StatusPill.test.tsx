import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PLAN_STATUSES, planStatusLabel } from './planStatus';
import { StatusPill } from './StatusPill';

describe('StatusPill', () => {
  it('ボール状態 6 値すべてにラベルが定義されている', () => {
    render(
      <>
        {PLAN_STATUSES.map((s) => (
          <StatusPill key={s} status={s} />
        ))}
      </>,
    );
    for (const s of PLAN_STATUSES) {
      expect(screen.getByText(planStatusLabel(s))).toBeInTheDocument();
    }
  });

  it('状態を data 属性で公開する', () => {
    const { container } = render(<StatusPill status="approved" />);
    expect(container.querySelector('[data-status="approved"]')).not.toBeNull();
  });

  it('hideIcon でアイコンを省ける', () => {
    const { container: withIcon } = render(<StatusPill status="in_progress" />);
    const { container: without } = render(<StatusPill status="in_progress" hideIcon />);
    expect(withIcon.querySelector('svg')).not.toBeNull();
    expect(without.querySelector('svg')).toBeNull();
  });
});
