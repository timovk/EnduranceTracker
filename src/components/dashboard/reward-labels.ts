/**
 * What each kind of season pass reward is called on screen.
 *
 * Shared by the open track, which is a client component, and the closed-state
 * preview, which is not. A constant exported from a `'use client'` module
 * reaches a server component as a client reference rather than as the object,
 * so it lives here, in a module that is neither.
 */

import type { RewardType } from '@/lib/domain/types';

export const REWARD_TYPE_LABEL: Record<RewardType, string> = {
  BADGE: 'Badge',
  TITLE: 'Title',
  THEME: 'Theme',
  RACE_CARD: 'Race card',
  TROPHY_ITEM: 'Trophy',
  PATCH: 'Patch',
  EMBLEM: 'Emblem',
  BANNER: 'Banner',
  POSTER: 'Poster',
  XP_BONUS: 'XP bonus',
  HALL_OF_FAME_COLLECTIBLE: 'Hall of Fame',
};
