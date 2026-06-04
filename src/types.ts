export type Suit = 'spades' | 'clubs' | 'diamonds' | 'hearts';

export interface Card {
  id: string; // e.g. "3_spades"
  suit: Suit;
  rank: number; // 3 to 15 (15 is 2)
  name: string; // "3", "4", ..., "10", "J", "Q", "K", "A", "2"
  value: number; // rank * 4 + suitIndex (for easy sorting and comparisons)
}

export interface Player {
  id: string;
  name: string;
  isAI: boolean;
  cards: Card[];
  tradesRemaining: number;
  hasPassed: boolean;
  isReady: boolean;
  seatIndex: number;
}

export interface Bid {
  bidderId: string;
  bidderCard: Card;
}

export interface TradeRequest {
  rank: number | null; // 3 to 15, or null for any
  suit: Suit | null;   // Suit, or null for any
}

export interface TradeOffer {
  id: string;
  offererId: string;
  offererCard: Card;
  lookingFor: TradeRequest;
  bids: Bid[];
}

export type GameStatus = 'LOBBY' | 'TRADING' | 'PLAYING' | 'GAMEOVER';

export interface GameRoom {
  roomCode: string;
  status: GameStatus;
  players: Player[];
  tradeLimit: number;
  activePlayerId: string | null;
  lastPlay: Card[];
  lastPlayerId: string | null;
  winnerId: string | null;
  combatLogs: string[];
}
