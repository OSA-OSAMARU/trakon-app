import type * as React from 'react';

import { cn } from '@/components/ui/utils';

import { PLAN_ROLE_SPEC, type PlanRole } from './planRole';

type RoleRowProps = React.ComponentProps<'div'> & {
  role: PlanRole;
  name: string;
  /** 職種・所属などの補足。detail でのみ表示する */
  caption?: string;
  /**
   * 行の右端に置く補足要素。detail でのみ表示する。
   * 担当欄で「この人はプロジェクト上どの権限か」を併記するのに使う (#198)。
   */
  trailing?: React.ReactNode;
  /**
   * compact … スケジュールカード内 (Figma node 25:2)。濃い役割色の 20px アバター。
   * detail  … サイドモーダルの担当欄 (Figma node 38:12)。淡いタイルの 32px アバター。
   */
  variant?: 'compact' | 'detail';
};

/**
 * 予定の役割行。「ラベル + 役割色のアバター + 氏名」で並べる。定義は ./planRole.ts を参照。
 *
 * compact はスケジュールカード (BallChip) の中だけで使うため、text-micro / text-mini の
 * 高密度例外を許す (globals.css のタイポグラフィ節を参照)。detail は通常のスケールに従う。
 */
export function RoleRow({
  role,
  name,
  caption,
  trailing,
  variant = 'compact',
  className,
  ...props
}: RoleRowProps) {
  const spec = PLAN_ROLE_SPEC[role];
  const initial = name.trim().charAt(0);
  const detail = variant === 'detail';

  return (
    <div
      data-slot="role-row"
      data-role={role}
      className={cn('flex items-center', detail ? 'gap-3' : 'gap-1.5', className)}
      {...props}
    >
      <span
        className={cn(
          'text-text-secondary shrink-0 font-medium',
          detail ? 'w-21 text-label' : 'w-14 text-micro',
        )}
      >
        {spec.label}
      </span>
      <span
        aria-hidden
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full font-bold',
          detail
            ? cn('size-8 text-body text-foreground', spec.avatarSubtle)
            : cn('size-5 text-micro text-white', spec.avatar),
        )}
      >
        {initial}
      </span>
      <span className="flex min-w-0 flex-col">
        {/* detail は行の高さをアバター (32px) に揃えたいので行間を詰める (Figma node 38:12) */}
        <span
          className={cn('truncate font-medium', detail ? 'text-body leading-tight' : 'text-mini')}
        >
          {name}
        </span>
        {detail && caption ? (
          <span className="text-text-secondary truncate text-label leading-tight">{caption}</span>
        ) : null}
      </span>
      {!detail && caption ? (
        <span className="text-text-tertiary min-w-0 truncate text-micro">{caption}</span>
      ) : null}
      {detail && trailing ? <span className="ml-auto shrink-0 pl-2">{trailing}</span> : null}
    </div>
  );
}
