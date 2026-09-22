/**
 * Everything the pages are allowed to ask the shell for.
 *
 * Which is one thing. The renderer runs sandboxed with no Node and no direct
 * access to Electron, and this bridge is the only way through — so it stays
 * a list short enough to read in full, and every entry has to earn its place.
 * `openLogFolder` earns it because the error window is shown precisely when
 * the application could not start, which is when the log matters most.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('endurance', {
  openLogFolder: (): Promise<void> => ipcRenderer.invoke('endurance:open-log-folder'),
});
