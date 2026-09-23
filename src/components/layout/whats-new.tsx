'use client';

/**
 * "What's new", once.
 *
 * Opens by itself the first time an account sees a new version, and never
 * again after it is closed — however it is closed. Escape, the X, the backdrop
 * and the button all count, because a panel that comes back after you have
 * dismissed it is nagging, and nothing in this application nags.
 */

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { ReleaseNotes } from '@/components/layout/release-notes';
import { dismissReleaseNotesAction } from '@/lib/server/account-actions';
import type { ChangelogEntry } from '@/lib/changelog';

export function WhatsNew({ entry }: { entry: ChangelogEntry }) {
  const [open, setOpen] = React.useState(true);

  function close() {
    if (!open) return;
    setOpen(false);
    void dismissReleaseNotesAction();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={`What's new in ${entry.version}`}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <Link href="/changelog" onClick={close} className="text-xs text-ink-dim underline-offset-2 hover:text-ink hover:underline">
            See every version
          </Link>
          <Button type="button" variant="primary" onClick={close}>Got it</Button>
        </div>
      }
    >
      <ReleaseNotes entry={entry} />
    </Dialog>
  );
}
