import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WORKFLOW_ACTIONS, workflowActionLabel } from './workflow';
import { WorkflowButton } from './WorkflowButton';

describe('WorkflowButton', () => {
  it('4 つのアクションすべてに Figma 準拠のラベルが出る', () => {
    render(
      <>
        {WORKFLOW_ACTIONS.map((a) => (
          <WorkflowButton key={a} action={a} />
        ))}
      </>,
    );
    expect(screen.getByRole('button', { name: 'ボールを渡す' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ボールを戻す' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '承認' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '次の工程へトス' })).toBeInTheDocument();
  });

  it('「次の工程へトス」だけがブランド色になる', () => {
    render(<WorkflowButton action="next-toss" />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-brand');
    // 濃色ボタンの文字色が tailwind-merge に食われていないこと (utils.ts のバグ回帰防止)
    render(<WorkflowButton action="approve" />);
    expect(screen.getByRole('button', { name: '承認' }).className).toContain(
      'text-primary-foreground',
    );
  });

  it('children でラベルを上書きできる', async () => {
    const onClick = vi.fn();
    render(
      <WorkflowButton action="approve" onClick={onClick}>
        承認を取り消す
      </WorkflowButton>,
    );
    const btn = screen.getByRole('button', { name: '承認を取り消す' });
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('workflowActionLabel は既定ラベルを返す', () => {
    expect(workflowActionLabel('comment-return')).toBe('ボールを戻す');
  });
});
