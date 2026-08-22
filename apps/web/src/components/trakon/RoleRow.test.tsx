import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PLAN_ROLES, planRoleLabel } from './planRole';
import { RoleRow } from './RoleRow';

describe('RoleRow', () => {
  it('3 役割すべてにラベルが定義されている', () => {
    render(
      <>
        {PLAN_ROLES.map((r) => (
          <RoleRow key={r} role={r} name="杉野 遥" />
        ))}
      </>,
    );
    for (const r of PLAN_ROLES) {
      expect(screen.getByText(planRoleLabel(r))).toBeInTheDocument();
    }
  });

  it('氏名の頭文字をアバターに出す', () => {
    render(<RoleRow role="executor" name="石原 美咲" />);
    expect(screen.getByText('石')).toBeInTheDocument();
    expect(screen.getByText('石原 美咲')).toBeInTheDocument();
  });

  it('アバター色は人ではなく役割に紐づく', () => {
    const { container } = render(<RoleRow role="approver" name="石原 美咲" />);
    expect(container.querySelector('.bg-role-approver')).not.toBeNull();
  });

  it('caption は指定したときだけ出る', () => {
    const { rerender } = render(<RoleRow role="manager" name="横山 直樹" />);
    expect(screen.queryByText('ディレクター')).toBeNull();
    rerender(<RoleRow role="manager" name="横山 直樹" caption="ディレクター" />);
    expect(screen.getByText('ディレクター')).toBeInTheDocument();
  });
});
