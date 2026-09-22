/**
 * The application menu.
 *
 * Electron's default menu belongs to a browser: it offers Edit, History and
 * an About box for "Electron". This one offers the four things a career
 * actually needs — switching who is playing, taking a copy, finding the
 * files, and reading the log when something looks wrong.
 */

import { Menu, type MenuItemConstructorOptions } from 'electron';

export interface MenuActions {
  switchAccount(): void;
  backUpCareer(): void;
  openDataFolder(): void;
  openLog(): void;
  about(): void;
}

export function applyApplicationMenu(actions: MenuActions): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '&Career',
      submenu: [
        { label: 'Switch account…', accelerator: 'CmdOrCtrl+Shift+A', click: actions.switchAccount },
        { type: 'separator' },
        { label: 'Back up career…', accelerator: 'CmdOrCtrl+B', click: actions.backUpCareer },
        { label: 'Open data folder', click: actions.openDataFolder },
        { type: 'separator' },
        { role: 'quit', label: 'Quit' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Zoom in' },
        { role: 'zoomOut', label: 'Zoom out' },
        { role: 'resetZoom', label: 'Reset zoom' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle full screen' },
        { role: 'toggleDevTools', label: 'Toggle developer tools' },
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'About Endurance Racing Career', click: actions.about },
        { label: 'Open log', click: actions.openLog },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
