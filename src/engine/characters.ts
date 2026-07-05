/**
 * Playable character database. Pure data (no imports from cards.ts) so the
 * card module can build starter decks from it without an import cycle.
 */
import type { CharacterId } from './types';

export interface CharacterDef {
  id: CharacterId;
  /** Canonical English display name (zh overlaid by the UI layer). */
  name: string;
  maxHp: number;
  startingRelic: string;
  /** Starter deck as card def ids (duplicates = multiple copies). */
  starterCards: string[];
}

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  warrior: {
    id: 'warrior',
    name: 'The Wanderer',
    maxHp: 80,
    startingRelic: 'burning_blood',
    starterCards: [
      'strike', 'strike', 'strike', 'strike', 'strike',
      'defend', 'defend', 'defend', 'defend',
      'bash',
    ],
  },
  assassin: {
    id: 'assassin',
    name: 'The Night Blade',
    maxHp: 70,
    startingRelic: 'snake_ring',
    starterCards: [
      'strike', 'strike', 'strike', 'strike', 'strike',
      'defend', 'defend', 'defend', 'defend', 'defend',
      'neutralize', 'survivor',
    ],
  },
};

export function getCharacterDef(id: CharacterId): CharacterDef {
  const def = CHARACTERS[id];
  if (!def) throw new Error(`Unknown character: ${id}`);
  return def;
}
