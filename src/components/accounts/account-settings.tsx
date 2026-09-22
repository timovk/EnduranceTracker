'use client';

/**
 * Account settings.
 *
 * Everything you can do to the account itself, as opposed to the career it
 * holds: what it is called, what it looks like, whether it asks for a
 * password, and how to leave or remove it. It is deliberately the last thing
 * on the settings page — the career is the point, and this is the paperwork.
 */

import * as React from 'react';
import { LogOut, Trash2, Users } from 'lucide-react';
import { AccentPicker, AvatarPicker } from '@/components/accounts/identity-picker';
import { accentStyle } from '@/components/accounts/identity';
import {
  PASSWORD_HINT, SIGN_OUT_EVERYWHERE_NOTE, deletionConfirmHint, deletionNote,
} from '@/components/accounts/copy';
import { Button, Field, Input } from '@/components/ui/controls';
import { Dialog } from '@/components/ui/dialog';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/primitives';
import {
  deleteAccountAction, removePasswordAction, setPasswordAction, signOutAction,
  signOutEverywhereAction, updateAccountAction,
} from '@/lib/server/account-actions';
import type { ActionResult } from '@/lib/server/actions';

export function AccountSettings({
  name, avatarKey, accentKey, hasPassword, maxNameLength, losses,
}: {
  name: string;
  avatarKey: string;
  accentKey: string;
  hasPassword: boolean;
  maxNameLength: number;
  losses: { races: number; hours: number; achievements: number };
}) {
  return (
    <div className="space-y-4">
      <IdentityPanel
        name={name}
        avatarKey={avatarKey}
        accentKey={accentKey}
        maxNameLength={maxNameLength}
      />
      <PasswordPanel hasPassword={hasPassword} />
      <ThisPcPanel name={name} losses={losses} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Name and look
// ---------------------------------------------------------------------------

function IdentityPanel({
  name, avatarKey, accentKey, maxNameLength,
}: { name: string; avatarKey: string; accentKey: string; maxNameLength: number }) {
  const [avatar, setAvatar] = React.useState(avatarKey);
  const [accent, setAccent] = React.useState(accentKey);
  const [result, setResult] = React.useState<ActionResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      setResult(await updateAccountAction(formData));
    });
  }

  return (
    <form action={onSubmit} style={accentStyle(accent)}>
      <Panel>
        <PanelHeader title="This account" />
        <PanelBody className="space-y-4">
          <Field
            label="Account name"
            required
            hint="What the account card is called on the picker."
            error={result?.errors?.name}
          >
            <Input
              name="name"
              required
              autoComplete="off"
              maxLength={maxNameLength}
              defaultValue={name}
            />
          </Field>

          <AvatarPicker value={avatar} onChange={setAvatar} />
          <AccentPicker value={accent} onChange={setAccent} />

          <Notice result={result} />

          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save account'}
          </Button>
        </PanelBody>
      </Panel>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

function PasswordPanel({ hasPassword }: { hasPassword: boolean }) {
  const formRef = React.useRef<HTMLFormElement>(null);
  const [result, setResult] = React.useState<ActionResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      setResult(await setPasswordAction(formData));
    });
  }

  /** Removing reuses the current-password field rather than asking for it twice. */
  function onRemove() {
    const form = formRef.current;
    if (form === null) return;
    startTransition(async () => {
      setResult(await removePasswordAction(new FormData(form)));
    });
  }

  return (
    <form ref={formRef} action={onSubmit}>
      <Panel>
        <PanelHeader title="Password" />
        <PanelBody className="space-y-4">
          {hasPassword ? (
            <Field
              label="Current password"
              required
              hint="Asked for so that nobody sitting at this PC can lock you out of your own career."
              error={result?.errors?.currentPassword}
            >
              <Input name="currentPassword" type="password" autoComplete="current-password" />
            </Field>
          ) : null}

          <div className="space-y-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={hasPassword ? 'New password' : 'Password'}
                error={result?.errors?.password}
              >
                <Input name="password" type="password" autoComplete="new-password" />
              </Field>
              <Field label="Confirm password" error={result?.errors?.confirmPassword}>
                <Input name="confirmPassword" type="password" autoComplete="new-password" />
              </Field>
            </div>
            <p className="text-xs text-ink-dim">{PASSWORD_HINT}</p>
          </div>

          <Notice result={result} />

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? 'Saving…' : hasPassword ? 'Change password' : 'Set a password'}
            </Button>
            {hasPassword ? (
              <Button type="button" variant="subtle" disabled={pending} onClick={onRemove}>
                Remove password
              </Button>
            ) : null}
          </div>
        </PanelBody>
      </Panel>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Leaving, and removing
// ---------------------------------------------------------------------------

function ThisPcPanel({
  name, losses,
}: { name: string; losses: { races: number; hours: number; achievements: number } }) {
  const [confirming, setConfirming] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const [result, setResult] = React.useState<ActionResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  const matches = typed.trim().toLowerCase() === name.toLowerCase();

  function onSignOut() {
    startTransition(async () => {
      await signOutAction();
    });
  }

  function onSignOutEverywhere() {
    startTransition(async () => {
      await signOutEverywhereAction();
    });
  }

  function onDelete(formData: FormData) {
    startTransition(async () => {
      // Deleting redirects to the picker, so anything returned is a refusal.
      setResult(await deleteAccountAction(formData));
    });
  }

  return (
    <Panel>
      <PanelHeader title="This PC" />
      <PanelBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" disabled={pending} onClick={onSignOut}>
            <LogOut size={15} />
            Sign out
          </Button>
          <Button type="button" variant="subtle" disabled={pending} onClick={onSignOutEverywhere}>
            <Users size={15} />
            Sign out everywhere
          </Button>
        </div>
        <p className="text-xs text-ink-dim">{SIGN_OUT_EVERYWHERE_NOTE}</p>

        <div className="space-y-3 border-t border-hairline pt-4">
          <p className="text-sm text-ink-muted">{deletionNote(losses)}</p>
          <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
            <Trash2 size={15} />
            Delete this account
          </Button>
        </div>
      </PanelBody>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${name}`}
        size="sm"
      >
        <form action={onDelete} className="space-y-4">
          <p className="text-sm text-ink-muted">{deletionNote(losses)}</p>

          <Field
            label="Account name"
            hint={deletionConfirmHint(name)}
            error={result?.errors?.confirmName}
          >
            <Input
              name="confirmName"
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          </Field>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="subtle" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
            <Button type="submit" variant="danger" disabled={pending || !matches}>
              {pending ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </div>
        </form>
      </Dialog>
    </Panel>
  );
}

/** The house notice strip, as used by the settings form. */
function Notice({ result }: { result: ActionResult | null }) {
  if (result?.message === undefined) return null;
  return (
    <p className="rounded-md border border-hairline-strong bg-panel-2 px-3 py-2 text-sm text-ink-muted">
      {result.message}
    </p>
  );
}
