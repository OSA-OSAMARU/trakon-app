import type * as React from 'react';

import { cn } from '@/components/ui/utils';

import { PLAN_ROLE_SPEC, type PlanRole } from './planRole';

type RoleRowProps = React.ComponentProps<'div'> & {
  role: PlanRole;
  name: string;
  /** 職種・所属などの補足。サイドモーダルでのみ表示する */
  caption?: string;
};

/**
 * 予定の役割行 (Figma node 25:2)。
 * 「ラベル + 役割色のアバター + 氏名」で並べる。定義は ./planRole.ts を参照。
 */
export function RoleRow({ role, name, caption, className, ...props }: RoleRowProps) {
  const spec = PLAN_ROLE_SPEC[role];
  const initial = name.trim().charAt(0);

  return (
    <div
      data-slot="role-row"
      data-role={role}
      className={cn('flex items-center gap-1.5', className)}
      {...props}
    >
      <span className="text-text-secondary w-14 shrink-0 text-micro font-medium">{spec.label}</span>
      <span
        aria-hidden
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full text-micro font-bold text-white',
          spec.avatar,
        )}
      >
        {initial}
      </span>
      <span className="min-w-0 truncate text-mini font-medium">{name}</span>
      {caption ? (
        <span className="text-text-tertiary min-w-0 truncate text-micro">{caption}</span>
      ) : null}
    </div>
  );
}
