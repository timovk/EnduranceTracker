'use client';

/**
 * The password prompt.
 *
 * One field and one button. A password that does not match says so and the
 * field stays exactly where it was — no lockout, no counter, no countdown.
 * There is no attacker on a machine you are already sitting at, and a delay
 * would only ever be paid by the person it belongs to.
 */

import * as React from 'react';
import Link from 'next/link';
import { Button, Field, Input } from '@/components/ui/controls';
import { signInAction } from '@/lib/server/account-actions';
import type { ActionResult } from '@/lib/server/actions';

export function SignInForm({ accountId }: { accountId: string }) {
  const [result, setResult] = React.useState<ActionResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      // A successful sign-in redirects; anything returned is a refusal.
      setResult(await signInAction(formData));
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <input type="hidden" name="accountId" value={accountId} />

      <Field label="Password" error={result?.errors?.password ?? null}>
        <Input name="password" type="password" autoFocus autoComplete="current-password" />
      </Field>

      {result?.ok === false && !result.errors?.password && result.message ? (
        <p className="rounded-md border border-hairline-strong bg-panel-2 px-3 py-2 text-sm text-ink-muted">
          {result.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/accounts" className="text-xs text-ink-dim transition-colors hover:text-ink-muted">
          Choose a different account
        </Link>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Opening…' : 'Open career'}
        </Button>
      </div>
    </form>
  );
}
