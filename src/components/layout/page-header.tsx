import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Standard page heading: a small eyebrow, a large title, an optional sentence
 * of framing and a slot for actions.
 */
export function PageHeader({
  eyebrow, title, description, actions, className,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="label mb-1.5">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
