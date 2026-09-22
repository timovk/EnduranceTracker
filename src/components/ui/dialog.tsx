'use client';

/**
 * A minimal modal built on the native <dialog> element, so focus trapping,
 * Escape handling and the top layer come from the platform rather than from a
 * dependency.
 */

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Dialog({
  open, onClose, title, children, footer, size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => {
        // Clicking the backdrop (the dialog element itself) closes it.
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'panel-raised m-auto w-[calc(100vw-2rem)] p-0 text-ink backdrop:bg-void/75 backdrop:backdrop-blur-sm',
        'animate-[rise_0.24s_var(--ease-out-quint)_both]',
        widths[size],
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-ink-dim transition-colors hover:bg-panel-3 hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
      {footer ? <div className="border-t border-hairline px-4 py-3">{footer}</div> : null}
    </dialog>
  );
}
