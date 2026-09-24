# Update log

<!-- Generated from src/lib/changelog.ts by `npm run changelog`. Edit that file, not this one. -->

## 0.3.2 — Only races you can watch

*24 September 2026*

The Race Strategist no longer suggests races that have not been run yet. A race dated after today stays in your library as it is, and the strategist suggests it from its race day on.

### Fixed

- The Race Strategist, on its own page and on the dashboard, no longer suggests a race whose race date is after today. From the race day itself, it is suggested like any other race.
- A race you have already logged a stint on is still suggested, whatever its date, so a story you have started never drops out.
- Races without a race date are suggested as before.
- When races are left out because they have not been run yet, the strategist says how many. When they are all that is left to watch, it says the date of the first one.
- If you skip a version, "What's new" now shows the notes for every version since you last opened the app, not only the newest. Going straight from 0.3.0 to this version, you also see what 0.3.1 changed.

## 0.3.1 — Season pass closed until 1 October

*23 September 2026*

The season pass and seasonal challenges are closed until 1 October 2026, when the Q4 2026 pass opens. What they gave so far — their rewards, and the XP those rewards paid — has been removed, and your level is worked out again without it. Your races, stints, achievements and the rest of your career stay as they were.

> Before it changes anything, the desktop app saves a copy of your career as it was, in %APPDATA%\Endurance Racing Career\backups. Its name starts with pre-update- and the version you installed.

### Changed

- The season pass and seasonal challenges are closed until 1 October 2026. The Q4 2026 pass opens at midnight that day and starts from tier 0 with your first stint, with the Sarthe theme at tier 20 and Daytona at tier 60. Seasonal challenges return with it.
- Until then, stints earn career XP only. Levels, achievements, milestones, mastery, collections and daily, weekly and monthly challenges work exactly as before. Nothing earns season XP.
- Removed from careers that had them: every season pass before Q4 2026 and everything it unlocked — themes, race card designs, badges, banners, titles, patches, emblems, posters, trophy items and the Hall of Fame collectible — along with seasonal challenges, the trophies and Hall of Fame entries that came from the season pass, and the XP all of these paid. This happens once, the first time this version starts. Nothing from the Q4 2026 pass onwards is touched.
- Career XP, level, prestige and title are recalculated from what remains, the same way as when a stint is deleted, so your level may be lower than it was.
- Your look is back to the defaults: the Graphite theme, the Classic race card, no badge, no banner and the automatic title. Looks from the Q4 2026 pass can be chosen in Settings as you unlock them.
- Everything else stays as it was: races and stints, achievements, milestones, mastery, collections, and daily, weekly and monthly challenges, with the XP each of them earned.

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
