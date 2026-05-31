import * as React from 'react';
import { CalendarDays } from 'lucide-react';

import { Input } from './input';
import { cn } from './utils';

/**
 * 日付入力フィールド。ネイティブ `<input type="date">` に
 * カレンダーアイコンボタンを重ね、押下で `showPicker()` を呼んでピッカーを起動する。
 * RHF の register をそのまま spread できるよう ref を転送する。
 */
export const DateField = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);

    const setRefs = (el: HTMLInputElement | null) => {
      innerRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
    };

    const openPicker = () => {
      const el = innerRef.current;
      if (!el) return;
      if (typeof el.showPicker === 'function') {
        try {
          el.showPicker();
          return;
        } catch {
          /* showPicker 不可時は focus にフォールバック */
        }
      }
      el.focus();
    };

    return (
      <div className="relative">
        <Input
          ref={setRefs}
          type="date"
          className={cn('pr-9 [&::-webkit-calendar-picker-indicator]:opacity-0', className)}
          {...props}
        />
        <button
          type="button"
          onClick={openPicker}
          aria-label="カレンダーを開く"
          className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-muted-foreground hover:text-foreground"
        >
          <CalendarDays className="size-4" />
        </button>
      </div>
    );
  },
);
DateField.displayName = 'DateField';
