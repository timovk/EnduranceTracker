/**
 * The five systems of 0.4.0 — Career Milestones, Event Legacy, Race
 * Expeditions, the Chronicle with Endurance Wrapped, and Career Statistics —
 * driven through the application the way a person drives them.
 *
 * `tests/e2e/desktop.mjs` runs these on the career it has just made, signed
 * in, with one race in the library that has stints on it. They live in a file
 * of their own so that the same checks can also be pointed at `next dev` in a
 * browser window while the application is being worked on, without packaging
 * anything; the harness (`step`, `check`, `section` and the navigation
 * helpers) is the one `desktop.mjs` defines, passed in.
 *
 * What they leave behind is returned, so `desktop.mjs` can check the database
 * once the application is shut: the expedition checkpoints the page showed as
 * paid, and the year whose Wrapped preview was clicked through. The SQL for
 * that, and for the simulated upgrade from 0.3.2, is here too, as plain
 * strings: `tests/integration/upgrade-from-0.3.2.test.ts` runs the upgrade
 * queries against the upgraded fixture, so they are known to read a finished
 * upgrade as finished before anyone packages anything.
 */

/** The race the Expedition checks add: long enough to be one by itself. */
const EXPEDITION_RACE = '24 Hours of Spa';
/** The event the Event Legacy checks create and put the first race in. */
const EVENT_NAME = 'Fuji 6 Hours';

/**
 * The 0.4.0 history pass records its progress per account in
 * `config_overrides`, as JSON naming its version and the phases it has
 * finished: `CAREER_BACKFILL_KEY`, `CAREER_BACKFILL_VERSION` and
 * `CAREER_BACKFILL_PHASES` in src/lib/server/upgrades/career-backfill.ts,
 * which plain JavaScript cannot import. The upgrade test holds these to them.
 */
export const HISTORY_PASS = {
  key: 'careerBackfill',
  version: '0.4.0',
  phases: ['P1', 'P2', 'P3', 'P4', 'P5'],
};

/**
 * What is looked for in the database once the application is shut. Each is
 * SQL selecting one number as `n`.
 */
export const DATABASE_CHECKS = {
  /** Accounts whose 0.4.0 history pass has finished every phase. */
  completeHistoryPasses: `
    SELECT COUNT(*) AS n FROM config_overrides AS marker
    WHERE marker.key = '${HISTORY_PASS.key}'
      AND json_extract(marker.value, '$.version') = '${HISTORY_PASS.version}'
      AND (SELECT COUNT(DISTINCT phase.value) FROM json_each(marker.value, '$.done') AS phase
           WHERE phase.value IN (${HISTORY_PASS.phases.map((phase) => `'${phase}'`).join(', ')})) = ${HISTORY_PASS.phases.length}`,
  /** Milestone rows. */
  milestones: 'SELECT COUNT(*) AS n FROM milestone_progress',
  /** Milestone rows with no date and no word on how exactly it is known: after 0.4.0 has run, none. */
  undatedMilestones: 'SELECT COUNT(*) AS n FROM milestone_progress WHERE achievedPrecision IS NULL',
  /** Expedition checkpoints held, their XP, how many distinct ones, and any that paid season XP. */
  expeditionCheckpoints: "SELECT COUNT(*) AS n FROM xp_transactions WHERE source = 'EXPEDITION'",
  expeditionXp: "SELECT COALESCE(SUM(amount), 0) AS n FROM xp_transactions WHERE source = 'EXPEDITION'",
  distinctExpeditionCheckpoints: "SELECT COUNT(DISTINCT dedupeKey) AS n FROM xp_transactions WHERE source = 'EXPEDITION'",
  expeditionSeasonXp: "SELECT COUNT(*) AS n FROM xp_transactions WHERE source = 'EXPEDITION' AND seasonAmount <> 0",
  /** Chronicle chapters frozen, for any year. */
  chapters: 'SELECT COUNT(*) AS n FROM chronicle_years',
  /** Frozen chapters of one year. */
  chaptersOf: (/** @type {number} */ year) => `SELECT COUNT(*) AS n FROM chronicle_years WHERE year = ${Math.trunc(year)}`,
};

/**
 * @param {import('playwright').Page} page  the application window, signed in
 * @param {object} harness
 * @param {(name: string, work: () => Promise<void>) => Promise<void>} harness.step
 * @param {(condition: unknown, message: string) => void} harness.check
 * @param {(title: string) => void} harness.section
 * @param {(page: import('playwright').Page, path: string) => Promise<void>} harness.go
 * @param {(page: import('playwright').Page, accepts: (path: string) => boolean) => Promise<void>} harness.waitForPath
 * @param {(page: import('playwright').Page) => string} harness.pathOf
 * @param {number} harness.timeout  how long to wait for any one thing
 * @param {{ id: string | null; name: string }} harness.race  a race in the library, with stints on it
 */
export async function checkCareerHistory(page, { step, check, section, go, waitForPath, pathOf, timeout, race }) {
  const found = {
    /** The checkpoints the Expedition page showed as reached, and their XP. */
    checkpoints: /** @type {{ percent: number; xp: number }[]} */ ([]),
    /** The year whose Wrapped preview was clicked through, or null. */
    wrappedYear: /** @type {number | null} */ (null),
  };

  const bodyText = async () => ((await page.textContent('body')) ?? '').replace(/\s+/g, ' ');

  section('Your career, year by year');

  await step('puts Chronicle, Career Statistics and Events straight after Career in the menu', async () => {
    await go(page, '/');
    await page.waitForSelector('nav[aria-label="Main"]', { state: 'attached', timeout });
    // The rail and the narrow-screen bar are both in the page; both must agree.
    const menus = await page.$$eval('nav[aria-label="Main"]', (navs) =>
      navs.map((nav) => [...nav.querySelectorAll('a[href]')].map((link) => ({
        href: link.getAttribute('href'),
        text: (link.textContent ?? '').trim(),
      }))));
    check(menus.length > 0, 'there is no main menu');
    for (const links of menus) {
      const hrefs = links.map((link) => link.href);
      const at = hrefs.indexOf('/career');
      check(at !== -1, 'the menu has no Career item');
      const after = hrefs.slice(at + 1, at + 4);
      check(
        JSON.stringify(after) === JSON.stringify(['/chronicle', '/stats', '/events']),
        `after Career the menu reads ${JSON.stringify(after)}`,
      );
      const statistics = links.find((link) => link.href === '/stats');
      check(statistics?.text === 'Career Statistics', `the statistics item reads "${statistics?.text}"`);
    }
  });

  section('Career Milestones');

  await step('dates the first race started to the stint that started it', async () => {
    await go(page, '/career/milestones');
    await page.waitForSelector('h1:has-text("Career Milestones")', { timeout });
    const card = page.locator('li', { hasText: 'First race started' }).first();
    const text = ((await card.textContent()) ?? '').replace(/\s+/g, ' ');
    check(
      /Reached with the stint logged at \d{2}:\d{2} on \d{1,2} [A-Z][a-z]+ \d{4}/.test(text),
      `the milestone carried no date from its stint: ${JSON.stringify(text)}`,
    );
    // It pays nothing of its own: the first stint already pays that moment.
    check(text.includes('Celebrated by the Green Flag achievement'), 'the milestone did not say who celebrates it');
  });

  await step('shows the milestones still ahead as where the career stands', async () => {
    const body = await bodyText();
    check(body.includes('Still ahead:'), 'no milestone still ahead showed where the career stands');
  });

  section('Event Legacy');

  /** The event page the checks create, once it exists. */
  let eventPath = null;

  await step('creates an event from the Events page', async () => {
    await go(page, '/events');
    await page.waitForSelector('h1:has-text("Recurring events")', { timeout });
    await page.click('button:has-text("Create an event")');
    const dialog = page.locator('dialog[open]');
    await dialog.locator('input[name="name"]').fill(EVENT_NAME);
    await dialog.locator('button:has-text("Create the event")').click();
    await waitForPath(page, (path) => path.startsWith('/events/'));
    eventPath = pathOf(page);
    await page.waitForSelector('text=No editions linked yet', { timeout });
  });

  await step('adds a race to it as an edition', async () => {
    check(eventPath !== null, 'there is no event to add the race to');
    check(race.id !== null, 'there is no race to add');
    await page.click('button:has-text("Add races")');
    const dialog = page.locator('dialog[open]');
    await dialog.locator('label', { hasText: race.name }).click();
    await dialog.locator('button:has-text("Add as editions")').click();
    await page.waitForSelector('text=/Edition history · 1 edition/i', { timeout });
  });

  await step('opens the event page with the edition in its history', async () => {
    check(eventPath !== null, 'there is no event page to open');
    await go(page, eventPath);
    await page.waitForSelector(`h1:has-text("${EVENT_NAME}")`, { timeout });
    const body = await bodyText();
    check(body.includes(`${EVENT_NAME} — 1 edition experienced`), 'the headline did not count the edition');
    const edition = page.locator(`a[href="/races/${race.id}"]`);
    check((await edition.count()) > 0, 'the edition does not open its race page');
  });

  section('A Race Expedition');

  /** The 24-hour race, once it is in the library. */
  let expeditionRaceId = null;

  await step('adds a 24-hour race, which is an Expedition by itself', async () => {
    await go(page, '/races/new');
    await page.fill('input[name="name"]', EXPEDITION_RACE);
    await page.fill('input[name="scheduledDuration"]', '24:00:00');
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => url.pathname === '/races' && url.searchParams.has('added'), { timeout });
    expeditionRaceId = new URL(page.url()).searchParams.get('added');
    check(expeditionRaceId !== null, 'the library did not say which race was added');
    await go(page, `/races/${expeditionRaceId}`);
    await page.click('a:has-text("Open the expedition")');
    await waitForPath(page, (path) => path === `/races/${expeditionRaceId}/expedition`);
    await page.waitForSelector('text=Your expedition starts with the first stint', { timeout });
    const mode = page.locator('button[role="switch"]');
    check((await mode.getAttribute('aria-checked')) === 'true', 'a 24-hour race was not an Expedition');
  });

  /**
   * Log one stint from the Expedition page, by its timeline positions, and
   * wait for its summary to name the checkpoint it should have reached.
   */
  async function logFromExpedition(from, to, reaches) {
    check(expeditionRaceId !== null, 'there is no Expedition to log a stint on');
    await page.click('button:has-text("Log a stint")');
    const dialog = page.locator('dialog[open]');
    // The form opens on whichever way of logging was used last.
    await dialog.locator('button[role="tab"]:has-text("Timestamps")').click();
    await dialog.locator('input[placeholder="01:35:20"]').fill(from);
    await dialog.locator('input[placeholder="02:47:31"]').fill(to);
    await dialog.locator('button:has-text("Log stint")').click();
    await page.waitForSelector(`text=Checkpoint — ${reaches}% of the story`, { timeout });
  }

  /** The Checkpoints panel, one entry per percentage: whether it was reached, and its XP. */
  async function readCheckpoints() {
    const panel = page
      .locator('h2:text-is("Checkpoints")')
      .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " panel ")][1]');
    await panel.waitFor({ timeout });
    const rows = await panel.locator('li').allTextContents();
    return rows
      .map((row) => row.replace(/\s+/g, ' '))
      .filter((row) => /^\s*\d+%/.test(row))
      .map((row) => ({
        percent: Number(/^\s*(\d+)%/.exec(row)[1]),
        reached: row.includes('Reached with the stint logged at'),
        xp: Number((/\+([\d,]+) XP/.exec(row)?.[1] ?? '0').replace(/,/g, '')),
      }));
  }

  const reachedOf = (rows) => rows.filter((row) => row.reached).map(({ percent, xp }) => ({ percent, xp }));

  await step('logs two stints from the Expedition page, leaving a gap between them', async () => {
    await logFromExpedition('00:00:00', '03:00:00', 10);
    await logFromExpedition('06:00:00', '15:30:00', 50);
  });

  await step('draws both stints on the timeline, and the parts still to watch', async () => {
    await go(page, `/races/${expeditionRaceId}/expedition`);
    await page.waitForSelector('[role="list"][aria-label="Stints on the race timeline"]', { timeout });
    const stints = await page.locator('[aria-label="Stints on the race timeline"] [role="listitem"]').count();
    check(stints === 2, `the timeline drew ${stints} stints`);
    const body = await bodyText();
    check(body.includes('Watched in 2 stretches: 12h 30m of 24h 00m.'), 'the timeline did not describe what was watched');
    check(body.includes('2 stretches still to watch'), 'the timeline did not name the gap and the rest of the race');
    // Reaching 15:30 is not the same as watching everything before it.
    const furthest = page.locator('[title^="Furthest point reached — not the same as watched: 15:30:00"]');
    check((await furthest.count()) > 0, 'the furthest point was not marked as different from what was watched');
  });

  await step('reaches the 10%, 25% and 50% checkpoints, each dated, and no more', async () => {
    const rows = await readCheckpoints();
    const reached = rows.filter((row) => row.reached).map((row) => row.percent);
    check(JSON.stringify(reached) === JSON.stringify([10, 25, 50]), `the reached checkpoints were ${JSON.stringify(reached)}`);
    check(rows.every((row) => row.reached || row.percent > 50), 'a checkpoint below 50% was still ahead');
    found.checkpoints = reachedOf(rows);
    check(found.checkpoints.every((row) => row.xp > 0), 'a reached checkpoint of a 24-hour race paid no XP');
  });

  await step('keeps the checkpoint XP when Expedition Mode is switched off', async () => {
    await page.click('button[role="switch"]:has-text("Expedition Mode: on")');
    await page.waitForSelector('[role="status"]:has-text("Checkpoints you already reached keep their XP.")', { timeout });
    await page.waitForSelector('button[role="switch"][aria-checked="false"]', { timeout });
    const after = reachedOf(await readCheckpoints());
    check(
      JSON.stringify(after) === JSON.stringify(found.checkpoints),
      `the checkpoints went from ${JSON.stringify(found.checkpoints)} to ${JSON.stringify(after)}`,
    );
  });

  await step('pays nothing twice when it is switched back on', async () => {
    await page.click('button[role="switch"]:has-text("Expedition Mode: off")');
    await page.waitForSelector('[role="status"]:has-text("Expedition Mode is on.")', { timeout });
    await page.waitForSelector('button[role="switch"][aria-checked="true"]', { timeout });
    const said = (await page.textContent('[role="status"]')) ?? '';
    check(!said.includes('already behind you'), `switching on paid again: ${said}`);
    const after = reachedOf(await readCheckpoints());
    check(
      JSON.stringify(after) === JSON.stringify(found.checkpoints),
      `the checkpoints went from ${JSON.stringify(found.checkpoints)} to ${JSON.stringify(after)}`,
    );
  });

  await step('hands the choice back to the race’s length', async () => {
    await page.click('button:has-text("Reset to automatic")');
    await page.waitForSelector('[role="status"]:has-text("follows the race")', { timeout });
    await page.waitForSelector('text=Automatic for races of 10 hours or more', { timeout });
  });

  section('The Chronicle');

  const year = new Date().getFullYear();

  await step('lists this year as Career Year 1, still being written', async () => {
    await go(page, '/chronicle');
    await page.waitForSelector('h1:has-text("Chronicle")', { timeout });
    const card = page.locator('li', { hasText: `${year} · Career Year 1` }).first();
    await card.waitFor({ timeout });
    const text = ((await card.textContent()) ?? '').replace(/\s+/g, ' ');
    check(text.includes('Year to date'), `this year's card is not marked year to date: ${JSON.stringify(text)}`);
  });

  await step('opens this year’s chapter from the index', async () => {
    await page.locator('li', { hasText: `${year} · Career Year 1` }).first().locator('a:has-text("Read the chapter")').click();
    await waitForPath(page, (path) => path === `/chronicle/${year}`);
    await page.waitForSelector('text=Year to date — still being written', { timeout });
    const body = await bodyText();
    check(body.includes(EXPEDITION_RACE), 'the chapter does not mention the year’s races');
  });

  await step('clicks Wrapped through to the end, every card marked year to date', async () => {
    await page.click('a:has-text("Wrapped so far")');
    await waitForPath(page, (path) => path === `/chronicle/${year}/wrapped`);
    await page.waitForSelector('[aria-current="step"]', { timeout });
    const first = (await page.getAttribute('[aria-current="step"]', 'aria-label')) ?? '';
    const total = Number(/^Card 1 of (\d+)$/.exec(first)?.[1] ?? 'NaN');
    check(Number.isInteger(total) && total > 1, `the deck opened on "${first}"`);
    for (let card = 1; card <= total; card += 1) {
      const text = (await page.textContent('article')) ?? '';
      check(text.includes('Year to date · as of'), `card ${card} of ${total} was not marked year to date`);
      if (card < total) {
        await page.click('button:has-text("Next")');
        await page.waitForSelector(`[aria-current="step"][aria-label="Card ${card + 1} of ${total}"]`, { timeout });
      }
    }
    // The last card leads back to the chapter instead of on.
    check(!(await page.isVisible('button:has-text("Next")')), 'the last card still offered Next');
    check(await page.isVisible('text=Read the chapter'), 'the last card did not lead back to the chapter');
    found.wrappedYear = year;
  });

  section('Career Statistics');

  await step('shows personal records', async () => {
    await go(page, '/stats?tab=records');
    await page.waitForSelector('h2:has-text("Personal records")', { timeout });
    const body = await bodyText();
    check(body.includes('Longest session'), 'the longest session was not among the records');
  });

  await step('compares two years once there are two to compare', async () => {
    await go(page, '/stats?tab=compare');
    await page.waitForSelector('text=Comparisons open once your career spans two calendar years', { timeout });
  });

  return found;
}
