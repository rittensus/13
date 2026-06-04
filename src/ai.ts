import type { Card, Suit, TradeRequest } from './types.js';
import { getComboType, sortCards, isValidPlay } from './rules.js';

// Calculate the utility of each card in the hand.
// Lower utility means the card is a candidate for trading.
export function calculateCardUtilities(hand: Card[]): { card: Card; score: number }[] {
  const sorted = sortCards(hand);
  
  // Group by rank to identify pairs, triples, quads
  const rankGroups: Record<number, Card[]> = {};
  for (const card of sorted) {
    if (!rankGroups[card.rank]) {
      rankGroups[card.rank] = [];
    }
    rankGroups[card.rank].push(card);
  }

  // Identify sequences (excluding 2s)
  const nonTwoCards = sorted.filter(c => c.rank !== 15);
  const inSequence = new Set<string>();

  // A simple sequence check: for each card, see if it can form a sequence of length >= 3
  for (let i = 0; i < nonTwoCards.length; i++) {
    const startCard = nonTwoCards[i];
    // Look for consecutive ranks
    let seq = [startCard];
    let nextRank = startCard.rank + 1;
    for (let j = i + 1; j < nonTwoCards.length; j++) {
      if (nonTwoCards[j].rank === nextRank) {
        seq.push(nonTwoCards[j]);
        nextRank++;
      }
    }
    if (seq.length >= 3) {
      for (const c of seq) {
        inSequence.add(c.id);
      }
    }
  }

  return hand.map(card => {
    let score = 0;
    const rankCount = rankGroups[card.rank]?.length || 1;

    if (card.rank === 15) {
      // 2s are extremely valuable
      score = 100 + getSuitScore(card.suit);
    } else if (card.rank === 14) {
      // Aces are very valuable
      score = 80 + getSuitScore(card.suit);
    } else if (rankCount === 4) {
      // Part of a quad (bomb)
      score = 90 + card.rank;
    } else if (rankCount === 3) {
      // Part of a triple
      score = 70 + card.rank;
    } else if (inSequence.has(card.id)) {
      // Part of a sequence
      score = 60 + card.rank;
    } else if (rankCount === 2) {
      // Part of a pair
      score = 50 + card.rank;
    } else {
      // Single garbage card
      score = card.rank + getSuitScore(card.suit) * 0.1;
    }

    return { card, score };
  });
}

function getSuitScore(suit: Suit): number {
  switch (suit) {
    case 'spades': return 0;
    case 'clubs': return 1;
    case 'diamonds': return 2;
    case 'hearts': return 3;
    default: return 0;
  }
}

// AI chooses which card to offer for trade.
// It will always offer its lowest utility card.
export function chooseCardToOffer(hand: Card[]): Card {
  const utilities = calculateCardUtilities(hand);
  utilities.sort((a, b) => a.score - b.score);
  return utilities[0].card;
}

// AI decides whether to bid on a player's offered card.
// It will bid if the offered card has a utility in the AI's hand
// that is higher than the utility of its lowest card.
export function evaluateTradeOffer(
  hand: Card[],
  offeredCard: Card,
  lookingFor: TradeRequest
): Card | null {
  const utilities = calculateCardUtilities(hand);
  utilities.sort((a, b) => a.score - b.score);

  // Filter candidates based on what the offerer is looking for
  let candidates = utilities;
  if (lookingFor.rank !== null || lookingFor.suit !== null) {
    candidates = utilities.filter(u => {
      const matchRank = lookingFor.rank === null || u.card.rank === lookingFor.rank;
      const matchSuit = lookingFor.suit === null || u.card.suit === lookingFor.suit;
      return matchRank && matchSuit;
    });
  }

  if (candidates.length === 0) {
    return null; // AI has no cards matching criteria
  }

  // Pick the lowest utility card that matches the criteria
  candidates.sort((a, b) => a.score - b.score);
  const lowestUtility = candidates[0];

  // Evaluate the offered card's potential utility in the AI's hand (simulating swapping)
  const simulatedHand = [...hand.filter(c => c.id !== lowestUtility.card.id), offeredCard];
  const simulatedUtilities = calculateCardUtilities(simulatedHand);
  const offeredCardSimulated = simulatedUtilities.find(u => u.card.id === offeredCard.id);

  if (offeredCardSimulated && offeredCardSimulated.score > lowestUtility.score - 5) {
    return lowestUtility.card;
  }

  // Fallback: If player asked for a specific rank/suit and we matched it, we trade if our matching card is low rank
  if ((lookingFor.rank !== null || lookingFor.suit !== null) && lowestUtility.card.rank < 14) {
    return lowestUtility.card;
  }

  return null;
}

// AI Play Logic: Find all valid combinations in hand that can beat lastPlay,
// and return the one with the lowest highest card.
export function getAIPlay(hand: Card[], lastPlay: Card[]): Card[] | null {
  if (lastPlay.length === 0) {
    // AI starts a new round. Let's choose a combination to play.
    return chooseStartingPlay(hand);
  }

  const lastType = getComboType(lastPlay);
  const len = lastPlay.length;

  const validPlays: Card[][] = [];

  // Helper to add if valid
  const checkAndAdd = (combo: Card[]) => {
    if (isValidPlay(combo, lastPlay)) {
      validPlays.push(combo);
    }
  };

  // 1. Singles
  if (lastType === 'SINGLE') {
    for (const c of hand) {
      checkAndAdd([c]);
    }
  }

  // 2. Pairs
  if (lastType === 'PAIR') {
    const pairs = findPairs(hand);
    for (const p of pairs) {
      checkAndAdd(p);
    }
  }

  // 3. Triples
  if (lastType === 'TRIPLE') {
    const triples = findTriples(hand);
    for (const t of triples) {
      checkAndAdd(t);
    }
  }

  // 4. Quads
  if (lastType === 'QUAD') {
    const quads = findQuads(hand);
    for (const q of quads) {
      checkAndAdd(q);
    }
  }

  // 5. Sequences
  if (lastType === 'SEQUENCE') {
    const sequences = findSequences(hand, len);
    for (const s of sequences) {
      checkAndAdd(s);
    }
  }

  // 6. Three pairs consecutive
  if (lastType === 'THREE_PAIRS_CONSECUTIVE') {
    const threePairs = findConsecutivePairs(hand, 3);
    for (const tp of threePairs) {
      checkAndAdd(tp);
    }
  }

  // 7. Four pairs consecutive
  if (lastType === 'FOUR_PAIRS_CONSECUTIVE') {
    const fourPairs = findConsecutivePairs(hand, 4);
    for (const fp of fourPairs) {
      checkAndAdd(fp);
    }
  }

  // 8. If last play is a 2, or pair of 2s, or bombs, look for cutting bombs
  const isLastSingleTwo = len === 1 && lastPlay[0].rank === 15;
  const isLastPairTwo = lastType === 'PAIR' && lastPlay[0].rank === 15;
  const isLastThreePairs = lastType === 'THREE_PAIRS_CONSECUTIVE';
  const isLastQuad = lastType === 'QUAD';

  if (isLastSingleTwo || isLastPairTwo || isLastThreePairs || isLastQuad) {
    // Look for Three Pairs Consecutive (cuts single 2, or lower three pairs)
    if (isLastSingleTwo) {
      const threePairs = findConsecutivePairs(hand, 3);
      for (const tp of threePairs) {
        checkAndAdd(tp);
      }
    }

    // Look for Quads (cuts single 2, pair of 2s, three pairs, lower quads)
    if (isLastSingleTwo || isLastPairTwo || isLastThreePairs) {
      const quads = findQuads(hand);
      for (const q of quads) {
        checkAndAdd(q);
      }
    }

    // Look for Four Pairs Consecutive (cuts single 2, pair of 2s, three pairs, quads, lower four pairs)
    if (isLastSingleTwo || isLastPairTwo || isLastThreePairs || isLastQuad) {
      const fourPairs = findConsecutivePairs(hand, 4);
      for (const fp of fourPairs) {
        checkAndAdd(fp);
      }
    }
  }

  if (validPlays.length === 0) {
    return null; // Pass
  }

  // Sort valid plays by their highest card value to select the most cost-effective play
  validPlays.sort((a, b) => {
    const maxA = sortCards(a)[a.length - 1].value;
    const maxB = sortCards(b)[b.length - 1].value;
    return maxA - maxB;
  });

  return validPlays[0];
}

// AI starts a new round. It chooses a combination to play.
// Strategy: Play sequences first, then triples, then pairs, then lowest single card.
function chooseStartingPlay(hand: Card[]): Card[] {
  // 1. Try to find the longest sequence
  for (let len = 5; len >= 3; len--) {
    const sequences = findSequences(hand, len);
    if (sequences.length > 0) {
      // Play the lowest sequence
      sequences.sort((a, b) => sortCards(a)[a.length - 1].value - sortCards(b)[b.length - 1].value);
      return sequences[0];
    }
  }

  // 2. Try to play triples (if rank is low, e.g. < 11)
  const triples = findTriples(hand);
  if (triples.length > 0) {
    triples.sort((a, b) => a[0].value - b[0].value);
    if (triples[0][0].rank < 11) {
      return triples[0];
    }
  }

  // 3. Try to play pairs (if rank is low, e.g. < 11)
  const pairs = findPairs(hand);
  if (pairs.length > 0) {
    pairs.sort((a, b) => a[0].value - b[0].value);
    if (pairs[0][0].rank < 11) {
      return pairs[0];
    }
  }

  // 4. Play the lowest single card
  const sorted = sortCards(hand);
  return [sorted[0]];
}

// Find all pairs in the hand
function findPairs(hand: Card[]): Card[][] {
  const pairs: Card[][] = [];
  const sorted = sortCards(hand);
  for (let i = 0; i < sorted.length - 1; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[i].rank === sorted[j].rank) {
        pairs.push([sorted[i], sorted[j]]);
      }
    }
  }
  return pairs;
}

// Find all triples in the hand
function findTriples(hand: Card[]): Card[][] {
  const triples: Card[][] = [];
  const sorted = sortCards(hand);
  for (let i = 0; i < sorted.length - 2; i++) {
    if (sorted[i].rank === sorted[i + 1].rank && sorted[i + 1].rank === sorted[i + 2].rank) {
      triples.push([sorted[i], sorted[i + 1], sorted[i + 2]]);
    }
  }
  return triples;
}

// Find all quads (four of a kind) in the hand
function findQuads(hand: Card[]): Card[][] {
  const quads: Card[][] = [];
  const sorted = sortCards(hand);
  for (let i = 0; i < sorted.length - 3; i++) {
    if (sorted[i].rank === sorted[i + 1].rank && 
        sorted[i + 1].rank === sorted[i + 2].rank && 
        sorted[i + 2].rank === sorted[i + 3].rank) {
      quads.push([sorted[i], sorted[i + 1], sorted[i + 2], sorted[i + 3]]);
    }
  }
  return quads;
}

// Find sequences of a specific length in the hand
function findSequences(hand: Card[], length: number): Card[][] {
  const sequences: Card[][] = [];
  const sorted = sortCards(hand).filter(c => c.rank !== 15); // Exclude 2s

  // Group by rank
  const rankMap: Record<number, Card[]> = {};
  for (const c of sorted) {
    if (!rankMap[c.rank]) rankMap[c.rank] = [];
    rankMap[c.rank].push(c);
  }

  const uniqueRanks = Object.keys(rankMap).map(Number).sort((a, b) => a - b);

  // Search for consecutive ranks of length 'length'
  for (let i = 0; i <= uniqueRanks.length - length; i++) {
    let isConsecutive = true;
    for (let j = 0; j < length - 1; j++) {
      if (uniqueRanks[i + j + 1] !== uniqueRanks[i + j] + 1) {
        isConsecutive = false;
        break;
      }
    }

    if (isConsecutive) {
      // Generate all card combinations for this rank sequence
      const ranksInSeq = uniqueRanks.slice(i, i + length);
      const combinations = generateCombinations(ranksInSeq.map(r => rankMap[r]));
      sequences.push(...combinations);
    }
  }

  return sequences;
}

// Helper to generate all combinations selecting one element from each sub-array
function generateCombinations(arrays: Card[][]): Card[][] {
  const result: Card[][] = [];

  function helper(comb: Card[], index: number) {
    if (index === arrays.length) {
      result.push([...comb]);
      return;
    }
    for (const card of arrays[index]) {
      comb.push(card);
      helper(comb, index + 1);
      comb.pop();
    }
  }

  helper([], 0);
  return result;
}

// Find consecutive pairs of a specific length (3 or 4 pairs)
function findConsecutivePairs(hand: Card[], numPairs: number): Card[][] {
  const combos: Card[][] = [];
  const sorted = sortCards(hand).filter(c => c.rank !== 15); // Exclude 2s

  // Find all pairs
  const rankPairs: Record<number, Card[][]> = {};
  const rankGroups: Record<number, Card[]> = {};
  for (const c of sorted) {
    if (!rankGroups[c.rank]) rankGroups[c.rank] = [];
    rankGroups[c.rank].push(c);
  }

  for (const rankStr in rankGroups) {
    const rank = Number(rankStr);
    const cards = rankGroups[rank];
    if (cards.length >= 2) {
      // Find all pairs for this rank
      const pairs: Card[][] = [];
      for (let i = 0; i < cards.length - 1; i++) {
        for (let j = i + 1; j < cards.length; j++) {
          pairs.push([cards[i], cards[j]]);
        }
      }
      rankPairs[rank] = pairs;
    }
  }

  const uniqueRanksWithPairs = Object.keys(rankPairs).map(Number).sort((a, b) => a - b);

  // Search for consecutive ranks of length 'numPairs'
  for (let i = 0; i <= uniqueRanksWithPairs.length - numPairs; i++) {
    let isConsecutive = true;
    for (let j = 0; j < numPairs - 1; j++) {
      if (uniqueRanksWithPairs[i + j + 1] !== uniqueRanksWithPairs[i + j] + 1) {
        isConsecutive = false;
        break;
      }
    }

    if (isConsecutive) {
      const ranks = uniqueRanksWithPairs.slice(i, i + numPairs);
      // Generate combinations of pairs
      const pairArrays = ranks.map(r => rankPairs[r]);
      const pairCombos = generatePairCombinations(pairArrays);
      combos.push(...pairCombos);
    }
  }

  return combos;
}

function generatePairCombinations(arrays: Card[][][]): Card[][] {
  const result: Card[][] = [];

  function helper(comb: Card[], index: number) {
    if (index === arrays.length) {
      result.push([...comb]);
      return;
    }
    for (const pair of arrays[index]) {
      comb.push(...pair);
      helper(comb, index + 1);
      // pop twice to backtrack the pair
      comb.pop();
      comb.pop();
    }
  }

  helper([], 0);
  return result;
}
