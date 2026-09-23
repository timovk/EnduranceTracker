# Update log

<!-- Generated from src/lib/changelog.ts by `npm run changelog`. Edit that file, not this one. -->

## 0.3.0 — Your look, earned

*23 September 2026*

Themes, race card designs, badges and banners now actually do something, and they are earned through the season pass. Stints can be logged using the time remaining on the broadcast clock. The app shows its version, and tells you what changed after an update.

### New

- Log a stint by time remaining. Choose "Time left" when logging and type the clock exactly as the broadcast shows it: 05:30:00 at the 6 Hours of Imola means half an hour watched. 00:00:00 means the chequered flag, final lap included. Whichever option you used last is chosen for you next time.
- Four race card designs for the race library: Classic, Timing Screen (each third of the race is coloured purple, green or grey by how much of it you have watched), Telemetry (a speed trace unique to each race) and Hyperpole (high contrast, one accent colour).
- Your banner runs across the top of the career page, and your badge sits next to your name.
- Settings has pickers for your badge and banner, including the option to show none.
- The version number is in the window title bar and at the bottom of the sidebar, which opens this update log.
- The first time you open a new version, its notes appear once.
- Automatic backup before an update. The first time a new version opens, it saves a copy of your career to the backups folder before it changes anything. The last five are kept.

### Changed

- Themes are earned. Graphite is free; Midnight, Sarthe, Daytona and Nordschleife come from the season pass. Each quarter offers two of them, alternating, so all four can be earned within any two quarters — starting with the Q4 2026 pass.
- The dashboard colour comes from your theme. Your account colour, now called card colour, only colours your account card and avatar.
- Settings shows every theme, design, badge, banner and title — the ones you have not unlocked are greyed out, with where to earn them.

### Fixed

- Choosing a dashboard theme did nothing. It now recolours the app.
- Choosing a race card design did nothing.
- Badges and banners you earned were never shown anywhere.
- Any theme or race card design could be chosen, whether you had earned it or not.
- A title chosen in Settings was replaced by your level title the next time you logged a stint.

## 0.2.0 — A real desktop application

*22 September 2026*

Endurance Racing Career became an installable Windows application with its own window, Start-menu entry and accounts.

> This build shows its version as 0.1.0 inside the app. It was numbered 0.2.0 afterwards.

### New

- A Windows installer and a portable version. No command window, no browser tab, and no administrator rights needed to install.
- Accounts. Several people can keep separate careers on one PC, each optionally protected by a password.
- A Career menu with Back up career…, Open data folder and Switch account.
- Your career is kept in your Windows app-data folder, and uninstalling the app does not delete it.

### Changed

- Deleting a stint takes back the XP it earned, and your level and season XP are recalculated. Achievements, trophies and other landmarks are never taken back.

### Fixed

- The launch window filled with database error messages on every page. They were harmless, but alarming.

## 0.1.0 — First version

*22 September 2026*

The first version, started with start.bat and opened in a web browser.

### New

- The race library, stint logging with coverage tracking, and Story Complete.
- Career XP, levels, prestige, the quarterly season pass, challenges, mastery trees, collections, achievements, the trophy cabinet, the Hall of Fame, statistics and the viewing budget.
- start.bat, which sets everything up the first time it runs.
