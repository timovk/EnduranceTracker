'use server';

/**
 * Account server actions.
 *
 * Kept apart from src/lib/server/actions.ts because they answer a different
 * question. Everything there resolves a session first and refuses without
 * one; these either create a session or are the only thing standing between
 * the picker and somebody else's career.
 *
 * Validation lives in @/lib/auth/accounts, which raises an `AccountError`
 * whose message is already written in the application's voice. These actions
 * hand that sentence straight to the screen rather than re-wording it — one
 * refusal, phrased once.
 *
 * No action trusts an account id from the client except the two that cannot:
 * opening a card and signing in, which both re-check the account server-side
 * before a session exists. Everything afterwards uses `requireUserId`.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  authenticateAccount, createAccount, deleteAccount, getAccount, isAccountError,
  removeAccountPassword, renameAccount, setAccountPassword, updateAccountCosmetics,
  type AccountErrorCode,
} from '@/lib/auth/accounts';
import {
  createSession, requireUserId, signOut, signOutEverywhere,
} from '@/lib/auth/session';
import { accentKeyOf, avatarKeyOf } from '@/components/accounts/identity';
import { clearCareerTimelineCache } from '@/lib/engines/career-timeline-engine';
import {
  ACCOUNT_GONE_NOTE, PASSWORDS_DIFFER_NOTE, WRONG_PASSWORD_NOTE,
} from '@/components/accounts/copy';
import type { ActionResult } from '@/lib/server/actions';
import { markReleaseNotesSeen } from '@/lib/server/whats-new';

// ---------------------------------------------------------------------------
// Getting in
// ---------------------------------------------------------------------------

/**
 * Create an account, sign in with it and open its dashboard.
 *
 * A new account never lands back on the picker. The point of making one is to
 * start using it.
 */
export async function createAccountAction(form: FormData): Promise<ActionResult> {
  const password = passwordFrom(form, 'password');
  const confirmation = passwordFrom(form, 'confirmPassword');
  if (password !== null && confirmation !== password) {
    return {
      ok: false,
      message: PASSWORDS_DIFFER_NOTE,
      errors: { confirmPassword: PASSWORDS_DIFFER_NOTE },
    };
  }

  let accountId: string;
  try {
    accountId = await createAccount({
      name: textFrom(form, 'name') ?? '',
      avatarKey: avatarKeyOf(textFrom(form, 'avatarKey')),
      accentKey: accentKeyOf(textFrom(form, 'accentKey')),
      password,
    });
  } catch (error) {
    return refusal(error);
  }

  await createSession(accountId);
  redirect('/');
}

/**
 * Open an account straight from its card.
 *
 * The card knows whether it is protected, but this does not take its word for
 * it: an account that turns out to have a password is sent to the prompt from
 * here rather than opened.
 */
export async function openAccountAction(accountId: string): Promise<ActionResult> {
  const id = typeof accountId === 'string' ? accountId.trim() : '';
  const outcome = await authenticateAccount(id);

  if (outcome === 'not-found') return { ok: false, message: ACCOUNT_GONE_NOTE };
  if (outcome === 'wrong-password') redirect(`/accounts/${encodeURIComponent(id)}/sign-in`);

  await createSession(id);
  redirect('/');
}

/** Sign in to a password-protected account. */
export async function signInAction(form: FormData): Promise<ActionResult> {
  const id = textFrom(form, 'accountId') ?? '';
  const outcome = await authenticateAccount(id, passwordFrom(form, 'password') ?? '');

  if (outcome === 'not-found') return { ok: false, message: ACCOUNT_GONE_NOTE };
  if (outcome === 'wrong-password') {
    // Nothing else happens. There is no attacker here to slow down, and a
    // delay or a counter would only ever hurt the one person it belongs to.
    return { ok: false, message: WRONG_PASSWORD_NOTE, errors: { password: WRONG_PASSWORD_NOTE } };
  }

  await createSession(id);
  redirect('/');
}

// ---------------------------------------------------------------------------
// Getting out
// ---------------------------------------------------------------------------

/** End this session and return to the picker. */
export async function signOutAction(): Promise<void> {
  await signOut();
  redirect('/accounts');
}

/** End every session this account has on this PC. */
export async function signOutEverywhereAction(): Promise<void> {
  const userId = await requireUserId();
  await signOutEverywhere(userId);
  redirect('/accounts');
}

// ---------------------------------------------------------------------------
// Looking after the account
// ---------------------------------------------------------------------------

/** Rename the account and change the card's mark and accent, in one save. */
export async function updateAccountAction(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  try {
    await renameAccount(userId, textFrom(form, 'name') ?? '');
    await updateAccountCosmetics(userId, {
      avatarKey: avatarKeyOf(textFrom(form, 'avatarKey')),
      accentKey: accentKeyOf(textFrom(form, 'accentKey')),
    });
  } catch (error) {
    return refusal(error);
  }

  revalidateAccountViews();
  return { ok: true, message: 'Account saved.' };
}

/**
 * Set or change the account's password.
 *
 * The current one is required when there is one: otherwise anyone sitting at
 * an unlocked, signed-in machine could lock the owner out of their own career.
 */
export async function setPasswordAction(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const password = passwordFrom(form, 'password');
  const confirmation = passwordFrom(form, 'confirmPassword');

  if (password === null) {
    return { ok: false, message: 'Choose a password first.', errors: { password: 'Choose a password first.' } };
  }
  if (confirmation !== password) {
    return {
      ok: false,
      message: PASSWORDS_DIFFER_NOTE,
      errors: { confirmPassword: PASSWORDS_DIFFER_NOTE },
    };
  }

  try {
    await setAccountPassword(userId, password, passwordFrom(form, 'currentPassword') ?? undefined);
  } catch (error) {
    return refusal(error);
  }

  revalidateAccountViews();
  return { ok: true, message: 'Password saved.' };
}

/** Remove the password, leaving the account openable straight from the picker. */
export async function removePasswordAction(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();

  try {
    await removeAccountPassword(userId, passwordFrom(form, 'currentPassword') ?? undefined);
  } catch (error) {
    return refusal(error);
  }

  revalidateAccountViews();
  return { ok: true, message: 'This account now opens straight from the picker.' };
}

/**
 * Delete the account and everything it owns.
 *
 * The typed name is checked here as well as in the dialog, because the dialog
 * is a courtesy and this is the actual gate.
 */
export async function deleteAccountAction(form: FormData): Promise<ActionResult> {
  const userId = await requireUserId();
  const account = await getAccount(userId);
  if (account === null) redirect('/accounts');

  const typed = textFrom(form, 'confirmName') ?? '';
  if (typed.toLowerCase() !== account.name.toLowerCase()) {
    const note = `Type “${account.name}” exactly to confirm.`;
    return { ok: false, message: note, errors: { confirmName: note } };
  }

  await deleteAccount(userId);
  // The career went with it, so its replay is no use to anyone now.
  clearCareerTimelineCache(userId);
  // The cascade has already taken the session row; this clears the cookie
  // that still points at it.
  await signOut();

  revalidateAccountViews();
  redirect('/accounts');
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Which field a refusal belongs beside, so the screen can show it inline. */
const FIELD_OF: Record<AccountErrorCode, string> = {
  'name-missing': 'name',
  'name-too-long': 'name',
  'name-taken': 'name',
  'not-found': '_',
  'wrong-password': 'currentPassword',
  'weak-password': 'password',
};

/**
 * Turn an `AccountError` into something a form can render.
 *
 * Anything else is re-thrown: a refusal the user is meant to read is not the
 * same thing as a bug, and swallowing the second would hide it.
 */
function refusal(error: unknown): ActionResult {
  if (!isAccountError(error)) throw error;
  return { ok: false, message: error.message, errors: { [FIELD_OF[error.code]]: error.message } };
}

/**
 * The account's name and mark are in the chrome, which lives in the root
 * layout, so a rename has to reach further than the page that made it.
 */
function revalidateAccountViews(): void {
  revalidatePath('/accounts');
  revalidatePath('/settings');
  revalidatePath('/', 'layout');
}

function textFrom(form: FormData, key: string): string | null {
  const value = form.get(key);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/**
 * A password is read exactly as typed.
 *
 * Trimming it would quietly change what the user chose, and a leading space is
 * a perfectly good character in a password nobody else has to type.
 */
function passwordFrom(form: FormData, key: string): string | null {
  const value = form.get(key);
  if (typeof value !== 'string' || value === '') return null;
  return value;
}

/** Close the "What's new" panel for good — for this account, for this version. */
export async function dismissReleaseNotesAction(): Promise<void> {
  const userId = await requireUserId();
  await markReleaseNotesSeen(userId);
  revalidatePath('/', 'layout');
}
