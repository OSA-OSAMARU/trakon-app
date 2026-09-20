import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { Button } from './button';

/**
 * ref が DOM まで届くことの回帰テスト (#230)。
 *
 * React 18 では素の関数コンポーネントに渡された ref はどこにも行かない。
 * `<DropdownMenuTrigger asChild><Button>` は Slot 経由でトリガーの DOM に ref を
 * 繋ぐ必要があり、切れていると Popper のアンカーが決まらず、開いたメニューが
 * `visibility: hidden` のままになる ＝ 「⋯ を押しても何も起きない」。
 *
 * jsdom はレイアウトを持たないため、メニュー項目の有無を見るテストでは
 * この壊れ方を捕まえられない。ここでは ref そのものを直接確かめる。
 * Radix 経由の経路は test/setup.ts の警告ガード (React の
 * 「Function components cannot be given refs」でテストを落とす) が受け持つ。
 */
describe('Button', () => {
  it('ref が実際の button 要素に届く', () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>送信</Button>);

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.textContent).toBe('送信');
  });

  it('asChild でも ref は子要素の DOM に届く', () => {
    const ref = createRef<HTMLAnchorElement>();
    render(
      <Button asChild>
        <a ref={ref} href="/dashboard">
          ダッシュボード
        </a>
      </Button>,
    );

    expect(ref.current).toBeInstanceOf(HTMLAnchorElement);
  });

});
