import type { Card } from './types.js';

export type ComboType =
  | 'SINGLE'
  | 'PAIR'
  | 'TRIPLE'
  | 'QUAD'
  | 'SEQUENCE'
  | 'THREE_PAIRS_CONSECUTIVE'
  | 'FOUR_PAIRS_CONSECUTIVE'
  | 'INVALID';

// Sort cards by value (rank * 4 + suitIndex)
export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => a.value - b.value);
}

// Get the suit index (0 for spades, 1 for clubs, 2 for diamonds, 3 for hearts)
export function getSuitIndex(suit: string): number {
  switch (suit) {
    case 'spades': return 0;
    case 'clubs': return 1;
    case 'diamonds': return 2;
    case 'hearts': return 3;
    default: return 0;
  }
}

// Detect combo type
export function getComboType(cards: Card[]): ComboType {
  if (cards.length === 0) return 'INVALID';
  
  const sorted = sortCards(cards);
  const len = sorted.length;

  // Single card
  if (len === 1) return 'SINGLE';

  // Pair
  if (len === 2) {
    if (sorted[0].rank === sorted[1].rank) {
      return 'PAIR';
    }
    return 'INVALID';
  }

  // Triple
  if (len === 3) {
    if (sorted[0].rank === sorted[1].rank && sorted[1].rank === sorted[2].rank) {
      return 'TRIPLE';
    }
  }

  // Four of a kind
  if (len === 4) {
    if (sorted[0].rank === sorted[1].rank && 
        sorted[1].rank === sorted[2].rank && 
        sorted[2].rank === sorted[3].rank) {
      return 'QUAD';
    }
  }

  // Sequence (Sảnh) - 3 or more cards with consecutive ranks, no 2s (rank 15) allowed
  if (len >= 3) {
    let isSeq = true;
    for (let i = 0; i < len - 1; i++) {
      if (sorted[i].rank === 15 || sorted[i + 1].rank === 15) {
        isSeq = false;
        break;
      }
      if (sorted[i + 1].rank !== sorted[i].rank + 1) {
        isSeq = false;
        break;
      }
    }
    if (isSeq) return 'SEQUENCE';
  }

  // Three consecutive pairs (3 đôi thông) - 6 cards
  if (len === 6) {
    const r0 = sorted[0].rank;
    const r1 = sorted[1].rank;
    const r2 = sorted[2].rank;
    const r3 = sorted[3].rank;
    const r4 = sorted[4].rank;
    const r5 = sorted[5].rank;

    if (r0 === r1 && r2 === r3 && r4 === r5) {
      if (r2 === r0 + 1 && r4 === r2 + 1 && r4 < 15) {
        return 'THREE_PAIRS_CONSECUTIVE';
      }
    }
  }

  // Four consecutive pairs (4 đôi thông) - 8 cards
  if (len === 8) {
    const r0 = sorted[0].rank;
    const r1 = sorted[1].rank;
    const r2 = sorted[2].rank;
    const r3 = sorted[3].rank;
    const r4 = sorted[4].rank;
    const r5 = sorted[5].rank;
    const r6 = sorted[6].rank;
    const r7 = sorted[7].rank;

    if (r0 === r1 && r2 === r3 && r4 === r5 && r6 === r7) {
      if (r2 === r0 + 1 && r4 === r2 + 1 && r6 === r4 + 1 && r6 < 15) {
        return 'FOUR_PAIRS_CONSECUTIVE';
      }
    }
  }

  return 'INVALID';
}

// Compare if newPlay beats lastPlay
export function isValidPlay(newPlay: Card[], lastPlay: Card[]): boolean {
  const newType = getComboType(newPlay);
  if (newType === 'INVALID') return false;

  // If new round, any valid combo is allowed
  if (lastPlay.length === 0) return true;

  const lastType = getComboType(lastPlay);
  if (lastType === 'INVALID') return false;

  const sortedNew = sortCards(newPlay);
  const sortedLast = sortCards(lastPlay);
  const highestNew = sortedNew[sortedNew.length - 1];
  const highestLast = sortedLast[sortedLast.length - 1];

  // 1. Same combo type and same length (Standard comparison)
  if (newType === lastType && newPlay.length === lastPlay.length) {
    return highestNew.value > highestLast.value;
  }

  // 2. Beating special cards (cutting 2s or lower consecutive pairs)
  
  // Beating a single 2
  if (lastPlay.length === 1 && highestLast.rank === 15) {
    // Single 2 can be beaten by:
    // - Three consecutive pairs (3 đôi thông)
    // - Four of a kind (Tứ quý)
    // - Four consecutive pairs (4 đôi thông)
    return (
      newType === 'THREE_PAIRS_CONSECUTIVE' ||
      newType === 'QUAD' ||
      newType === 'FOUR_PAIRS_CONSECUTIVE'
    );
  }

  // Beating a pair of 2s
  if (lastPlay.length === 2 && highestLast.rank === 15 && lastType === 'PAIR') {
    // Pair of 2s can be beaten by:
    // - Four of a kind (Tứ quý)
    // - Four consecutive pairs (4 đôi thông)
    return newType === 'QUAD' || newType === 'FOUR_PAIRS_CONSECUTIVE';
  }

  // Beating three consecutive pairs
  if (lastType === 'THREE_PAIRS_CONSECUTIVE') {
    // Can be beaten by:
    // - Four of a kind (Tứ quý)
    // - Four consecutive pairs (4 đôi thông)
    return newType === 'QUAD' || newType === 'FOUR_PAIRS_CONSECUTIVE';
  }

  // Beating a Quad
  if (lastType === 'QUAD') {
    // Can be beaten by:
    // - A higher Quad (handled above in standard comparison)
    // - Four consecutive pairs (4 đôi thông)
    return newType === 'FOUR_PAIRS_CONSECUTIVE';
  }

  return false;
}
