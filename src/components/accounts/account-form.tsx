'use client';

/**
 * Creating an account.
 *
 * The same form serves the first run and every account after it; only the
 * button says something different. Choosing an accent re-accents the form as
 * you go, so the colour is chosen by looking at it rather than by imagining
 * it.
 */

import * as React from 'react';
import { AccentPicker, AvatarPicker } from '@/components/accounts/identity-picker';
import { DEFAULT_ACCENT_KEY, DEFAULT_AVATAR_KEY, accentStyle } from '@/components/accounts/identity';
import { PASSWORD_HINT } from '@/components/accounts/copy';
import { Button, Field, Input } from '@/components/ui/controls';
import { createAccountAction } from '@/lib/server/account-actions';
import type { ActionResult } from '@/lib/server/actions';

export function AccountForm({
  submitLabel, maxNameLength,
}: { submitLabel: string; maxNameLength: number }) {
  const [avatar, setAvatar] = React.useState(DEFAULT_AVATAR_KEY);
  const [accent, setAccent] = React.useState(DEFAULT_ACCENT_KEY);
  const [result, setResult] = React.useState<ActionResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      // Creating an account signs in and redirects, so reaching here at all
      // means it did not happen.
      setResult(await createAccountAction(formData));
    });
  }

  return (
    <form action={onSubmit} className="space-y-4" style={accentStyle(accent)}>
      <Field
        label="Account name"
        required
        hint="What the account card is called. You can change it whenever you like."
        error={result?.errors?.name}
      >
        <Input
          name="name"
          required
          autoFocus
          autoComplete="off"
          maxLength={maxNameLength}
          placeholder="Your name"
        />
      </Field>

      <AvatarPicker value={avatar} onChange={setAvatar} />
      <AccentPicker value={accent} onChange={setAccent} />

      <div className="space-y-2 border-t border-hairline pt-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" error={result?.errors?.password}>
            <Input name="password" type="password" autoComplete="new-password" placeholder="Optional" />
          </Field>
          <Field label="Confirm password" error={result?.errors?.confirmPassword}>
            <Input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Optional"
            />
          </Field>
        </div>
        <p className="text-xs text-ink-dim">{PASSWORD_HINT}</p>
      </div>

      {result?.ok === false && result.message ? (
        <p className="rounded-md border border-hairline-strong bg-panel-2 px-3 py-2 text-sm text-ink-muted">
          {result.message}
        </p>
      ) : null}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Setting things up…' : submitLabel}
      </Button>
    </form>
  );
}
