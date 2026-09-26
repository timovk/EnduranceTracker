# Update log

<!-- Generated from src/lib/changelog.ts by `npm run changelog`. Edit that file, not this one. -->

## 0.4.0 — Your career, year by year

*26 September 2026*

Five new ways to look back on your watching: a Chronicle with a chapter for every year and an Endurance Wrapped to click through, a page for every recurring event you follow, Expeditions for long races, Career Statistics with personal records, and Career Milestones that keep the date they happened.

> The first time this version starts, it reads your viewing history once and fills in what you had already reached: milestone dates, event histories, expedition checkpoints and the chapters of years already finished. Before that, the desktop app saves a copy of your career in %APPDATA%\Endurance Racing Career\backups, in a file whose name starts with pre-update-0.4.0.

### New

- Chronicle, in the menu: a chapter for every year you have watched, starting with your first stint. Each has your hours, races, complete race stories, championships and events, records, milestones and a month-by-month view. A finished year is kept exactly as it was, even if you change your history later (it is settled a few days into January, so a race you watch across New Year counts in both years).
- Endurance Wrapped: cards for a finished year that you click through yourself. You can open a preview of the current year at any time; every card of it is marked as a year still being written.
- Events, in the menu: every recurring event you follow, such as the 24 Hours of Le Mans, has a page with every edition you have watched, the hours and complete race stories they add up to, your longest run of consecutive editions and the steps you have reached. You can create your own events, rename them and combine two into one, and the page suggests races that look like editions of one. Any race can belong to an event, not only major events.
- Race Expeditions: races of 10 hours or more are Expeditions automatically, and you can switch Expedition Mode on or off for any race. An Expedition has its own page with a timeline that shows exactly which parts you have seen, and checkpoints at 10%, 25%, 50%, 75% and 90% of the story, which earn a little XP on races of 6 hours or more. Switching it off never takes that XP away. When you complete one, a summary of the whole expedition is kept.
- Career Statistics (was Statistics): filter by year, championship, event, race or race length, compare two years side by side, and see your personal records, such as your longest session and your most in seven days.
- Career Milestones, from the Career page: the big moments of your career, such as your first 24-hour race or 1,000 hours, each with the date and time it happened. New ones include your first 6-hour race, 250 hours, 100 races experienced and two full weeks of racing inside one calendar year.

### Changed

- Deleting a race now takes back the XP it earned, the same as deleting its stints one by one: viewing and re-watch XP, its Story Complete bonus and its Expedition checkpoints. Achievements, milestones and anything else you reached stay.
- Hours for milestones, records and statistics count viewing time the same way XP does, so a stint logged at a very slow speed cannot add more than it could earn.
- The recurring event of a race is now chosen from a list, and no longer disappears when "Major event" is switched off.
- An edition of an event is counted once per year, however many races of that year you have added.
- Some moments are now shown as milestones without paying a second time, because something already pays for them: your first race started (Green Flag), 2,500 hours (The Archive), and 5, 10 or 25 editions of an event (that event's own steps).
- The Milestones tab on Achievements is now called Lifetime ladders. The achievement "Expedition" is now called "Around the Clock, Three Times", and the event steps for complete editions now say "complete" in their names.

### Fixed

- Deleting a stint now says how much XP came off with it, instead of saying the XP stays.
- Changing a race's length now works out again what counts as watched, so a shorter length can no longer complete a race you have not fully seen.
- Event editions dated 1 January are no longer counted in the year before on computers west of Greenwich.
- A stint summary opened again later no longer lists things unlocked after that stint.
- A completion figure never rounds up to 100% while part of the race is still to watch.

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
