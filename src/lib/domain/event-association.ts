/**
 * Suggestions for the Events page (0.4.0): which races look like editions of
 * the same recurring event.
 *
 * Suggestions only. Nothing here links, creates or merges anything: every
 * suggestion is a button the user presses, and a merge still goes through its
 * confirmation. The rules read only what the user's own library holds — names,
 * circuits, lengths, championships — and there is no list of famous races
 * behind them, so an event the application has never heard of is suggested
 * exactly as readily as Le Mans.
 *
 * Deterministic: the same library and the same dismissals always give the
 * same suggestions, in the same order.
 */

import {
  editionIdentityOf, editionYear, eventNameFromRaceName, eventNameSignature, normaliseEventKey,
} from './edition';

export interface AssociationRace {
  id: string;
  name: string;
  circuitSlug: string | null;
  runtimeSec: number;
  championshipId: string | null;
  /** The event the race already belongs to, if any. */
  eventKey: string | null;
  raceDate: Date | null;
  seasonYear: number | null;
}

export interface AssociationEvent {
  key: string;
  /** The name the user sees (their own name for it, if they gave one). */
  name: string;
  memberCount: number;
  createdAt: Date;
  /** Neither archived nor merged into another event. */
  active: boolean;
}

export type EventSuggestion =
  | {
    id: string; kind: 'link'; raceId: string; eventKey: string;
    strength: 'strong' | 'likely'; reason: 'name' | 'name-and-circuit' | 'circuit-and-length';
  }
  | { id: string; kind: 'create'; name: string; raceIds: string[] }
  | { id: string; kind: 'merge'; fromKey: string; intoKey: string };

type LinkSuggestion = Extract<EventSuggestion, { kind: 'link' }>;

/**
 * A signature is only worth matching on when it says something: at least two
 * words and six letters. "gt" or "race 3" would match half a library.
 */
const MIN_SIGNATURE_TOKENS = 2;
const MIN_SIGNATURE_LENGTH = 6;

function usableSignature(signature: string): boolean {
  return signature.length >= MIN_SIGNATURE_LENGTH && signature.split(' ').length >= MIN_SIGNATURE_TOKENS;
}

/** How strong each reason is, for picking one link per race. */
const REASON_RANK: Record<LinkSuggestion['reason'], number> = {
  'name-and-circuit': 3,
  name: 2,
  'circuit-and-length': 1,
};

function compareIds(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Which event survives when two are the same one: the one with more races,
 * then the older, then the lower key.
 */
function survivorFirst(a: AssociationEvent, b: AssociationEvent): number {
  if (a.memberCount !== b.memberCount) return b.memberCount - a.memberCount;
  const byAge = a.createdAt.getTime() - b.createdAt.getTime();
  if (byAge !== 0) return byAge;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export function suggestEventLinks(
  races: readonly AssociationRace[],
  events: readonly AssociationEvent[],
  dismissed: ReadonlySet<string>,
): EventSuggestion[] {
  const activeEvents = events.filter((event) => event.active);
  const eventsByKey = new Map(activeEvents.map((event) => [event.key, event]));
  const signatures = new Map(races.map((race) => [race.id, eventNameSignature(race.name)]));

  // The races already in each active event: what a new race is compared with.
  const members = new Map<string, AssociationRace[]>();
  for (const race of races) {
    if (race.eventKey === null || !eventsByKey.has(race.eventKey)) continue;
    const list = members.get(race.eventKey);
    if (list) list.push(race);
    else members.set(race.eventKey, [race]);
  }

  // -- Links: one per unlinked race, the strongest ---------------------------
  const links: LinkSuggestion[] = [];
  const linkedRaceIds = new Set<string>();
  for (const race of races) {
    if (race.eventKey !== null) continue;
    const signature = signatures.get(race.id)!;
    const nameUsable = usableSignature(signature);
    const hours = Math.round(race.runtimeSec / 3600);

    const candidates: LinkSuggestion[] = [];
    for (const [eventKey, eventMembers] of members) {
      let reason: LinkSuggestion['reason'] | null = null;
      for (const member of eventMembers) {
        const sameName = nameUsable && signatures.get(member.id) === signature;
        const sameCircuit = race.circuitSlug !== null && member.circuitSlug === race.circuitSlug;
        let found: LinkSuggestion['reason'] | null = null;
        if (sameName) found = sameCircuit ? 'name-and-circuit' : 'name';
        else if (
          sameCircuit
          && Math.round(member.runtimeSec / 3600) === hours
          && (race.championshipId === null || member.championshipId === null || race.championshipId === member.championshipId)
        ) found = 'circuit-and-length';
        if (found !== null && (reason === null || REASON_RANK[found] > REASON_RANK[reason])) reason = found;
      }
      if (reason === null) continue;
      const id = `link:${race.id}:${eventKey}`;
      if (dismissed.has(id)) continue;
      candidates.push({
        id, kind: 'link', raceId: race.id, eventKey,
        strength: reason === 'circuit-and-length' ? 'likely' : 'strong', reason,
      });
    }
    if (candidates.length === 0) continue;

    candidates.sort((a, b) => {
      const byReason = REASON_RANK[b.reason] - REASON_RANK[a.reason];
      if (byReason !== 0) return byReason;
      const byMembers = eventsByKey.get(b.eventKey)!.memberCount - eventsByKey.get(a.eventKey)!.memberCount;
      if (byMembers !== 0) return byMembers;
      return a.eventKey < b.eventKey ? -1 : a.eventKey > b.eventKey ? 1 : 0;
    });
    links.push(candidates[0]!);
    linkedRaceIds.add(race.id);
  }

  // -- Creates: unlinked races with nothing to join, grouped by name ---------
  const groups = new Map<string, AssociationRace[]>();
  for (const race of races) {
    if (race.eventKey !== null || linkedRaceIds.has(race.id)) continue;
    const signature = signatures.get(race.id)!;
    if (!usableSignature(signature)) continue;
    const list = groups.get(signature);
    if (list) list.push(race);
    else groups.set(signature, [race]);
  }

  const creates: EventSuggestion[] = [];
  for (const [signature, group] of groups) {
    const years = group.map((race) => editionYear(race));
    const identities = new Set(group.map((race, index) => editionIdentityOf(race.id, years[index]!)));
    // Two races of one year are one edition: that is not yet a recurring event.
    if (identities.size < 2) continue;
    const id = `create:${signature}`;
    if (dismissed.has(id)) continue;

    const ordered = group
      .map((race, index) => ({ race, year: years[index]! }))
      .sort((a, b) => {
        if (a.year !== b.year) {
          if (a.year === null) return 1;
          if (b.year === null) return -1;
          return a.year - b.year;
        }
        if (a.race.name !== b.race.name) return a.race.name < b.race.name ? -1 : 1;
        return a.race.id < b.race.id ? -1 : a.race.id > b.race.id ? 1 : 0;
      });
    // The most recent edition names it: the latest year, and of those the first name.
    const dated = ordered.filter((entry) => entry.year !== null);
    const latestYear = dated.length > 0 ? dated[dated.length - 1]!.year : null;
    const latest = ordered.find((entry) => entry.year === latestYear) ?? ordered[0]!;
    creates.push({
      id, kind: 'create',
      name: eventNameFromRaceName(latest.race.name),
      raceIds: ordered.map((entry) => entry.race.id),
    });
  }

  // -- Merges: active events that are the same event ------------------------
  // Events that share a normalised key or name are grouped (transitively), and
  // each is suggested into the group's survivor, so there is never a chain of
  // merges to follow.
  const parent = new Map(activeEvents.map((event) => [event.key, event.key]));
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(key, root);
    return root;
  };
  const byNormal = new Map<string, string>();
  for (const event of activeEvents) {
    for (const normal of new Set([normaliseEventKey(event.key), normaliseEventKey(event.name)])) {
      if (normal === '') continue;
      const seen = byNormal.get(normal);
      if (seen === undefined) byNormal.set(normal, event.key);
      else parent.set(find(event.key), find(seen));
    }
  }
  const clusters = new Map<string, AssociationEvent[]>();
  for (const event of activeEvents) {
    const root = find(event.key);
    const list = clusters.get(root);
    if (list) list.push(event);
    else clusters.set(root, [event]);
  }

  const merges: EventSuggestion[] = [];
  for (const cluster of clusters.values()) {
    if (cluster.length < 2) continue;
    const [survivor, ...others] = [...cluster].sort(survivorFirst);
    for (const other of others) {
      const id = `merge:${other.key}:${survivor!.key}`;
      if (dismissed.has(id)) continue;
      merges.push({ id, kind: 'merge', fromKey: other.key, intoKey: survivor!.key });
    }
  }

  return [
    ...merges.sort(compareIds),
    ...links.filter((link) => link.strength === 'strong').sort(compareIds),
    ...links.filter((link) => link.strength === 'likely').sort(compareIds),
    ...creates.sort(compareIds),
  ];
}
