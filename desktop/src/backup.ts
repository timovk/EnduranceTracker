/**
 * Copying a career, safely, while the application is still using it.
 *
 * `fs.copyFile` is the obvious answer and the wrong one: the database runs in
 * WAL mode, so the most recent writes live in `endurance.db-wal` and a copy of
 * `endurance.db` alone can be missing hours of viewing. `VACUUM INTO` asks
 * SQLite itself for a consistent copy, which it can produce while another
 * process holds the file open — and it compacts it on the way out.
 *
 * The source is opened read-only. A backup must never be able to damage the
 * thing it is backing up.
 */

import Database from 'better-sqlite3';
import { BrowserWindow, dialog, shell } from 'electron';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from './log';

export interface BackupOptions {
  parent: BrowserWindow | null;
  databaseFile: string;
  backupDir: string;
  logger: Logger;
}

export async function backUpCareer(options: BackupOptions): Promise<void> {
  const { parent, databaseFile, backupDir, logger } = options;

  if (!existsSync(databaseFile)) {
    await report(parent, 'info', 'There is nothing to back up yet', 'Your career begins the first time you record some viewing.');
    return;
  }

  mkdirSync(backupDir, { recursive: true });
  const suggested = join(backupDir, `endurance-${today()}.db`);

  const saveOptions = {
    title: 'Back up career',
    defaultPath: suggested,
    buttonLabel: 'Back up',
    filters: [{ name: 'Career database', extensions: ['db'] }],
  };
  const chosen = parent
    ? await dialog.showSaveDialog(parent, saveOptions)
    : await dialog.showSaveDialog(saveOptions);

  if (chosen.canceled || !chosen.filePath) return;
  const target = chosen.filePath;

  try {
    // The save dialog has already asked about replacing an existing file, but
    // VACUUM INTO refuses to write over one, so honour that answer here.
    if (existsSync(target)) rmSync(target);

    const source = new Database(databaseFile, { readonly: true });
    try {
      source.prepare('VACUUM INTO ?').run(target);
    } finally {
      source.close();
    }

    logger.info(`career backed up to ${target}`);
    await report(parent, 'info', 'Career backed up', target, target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('the backup could not be written', error);
    await report(parent, 'error', 'The backup could not be written', message);
  }
}

/** `YYYY-MM-DD` in the machine's own timezone, which is the one the user is in. */
function today(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function report(
  parent: BrowserWindow | null,
  type: 'info' | 'error',
  message: string,
  detail: string,
  revealPath?: string,
): Promise<void> {
  const buttons = revealPath ? ['Show in folder', 'Close'] : ['Close'];
  const boxOptions = {
    type,
    title: 'Endurance Racing Career',
    message,
    detail,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    noLink: true,
  };
  const answer = parent
    ? await dialog.showMessageBox(parent, boxOptions)
    : await dialog.showMessageBox(boxOptions);
  if (revealPath && answer.response === 0) shell.showItemInFolder(revealPath);
}
