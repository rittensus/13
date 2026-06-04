import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameRoom, Player, Card, Suit, TradeOffer, Bid, GameStatus } from '../src/types.js';
import { getComboType, isValidPlay, sortCards } from '../src/rules.js';
import { chooseCardToOffer, evaluateTradeOffer, getAIPlay } from '../src/ai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

const PORT = process.env.PORT || 3000;

// Serve static assets from the Vite dist folder
const distPath = __dirname.includes('dist-server')
  ? path.join(__dirname, '../../dist')
  : path.join(__dirname, '../dist');
app.use(express.static(distPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Memory storage for active rooms
const rooms: Record<string, GameRoom> = {};
// Mapping of socket ID to room code
const socketToRoom: Record<string, string> = {};

const SUITS: Suit[] = ['spades', 'clubs', 'diamonds', 'hearts'];
const RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const RANK_NAMES: Record<number, string> = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2'
};

// Create a deck of cards
function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) {
    for (let s = 0; s < SUITS.length; s++) {
      const suit = SUITS[s];
      deck.push({
        id: `${rank}_${suit}`,
        suit,
        rank,
        name: RANK_NAMES[rank],
        value: rank * 4 + s
      });
    }
  }
  return deck;
}

// Shuffle a deck
function shuffle(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Generate a random room code
function generateRoomCode(): string {
  let code = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms[code]);
  return code;
}

// Get the display name for a card
function getCardName(card: Card): string {
  let suitSymbol = '';
  switch (card.suit) {
    case 'spades': suitSymbol = '♠'; break;
    case 'clubs': suitSymbol = '♣'; break;
    case 'diamonds': suitSymbol = '♦'; break;
    case 'hearts': suitSymbol = '♥'; break;
  }
  return `${card.name}${suitSymbol}`;
}

// Active trade offers in rooms
const activeTradeOffers: Record<string, TradeOffer[]> = {};

io.on('connection', (socket: Socket) => {
  console.log(`User connected: ${socket.id}`);

  // Create room
  socket.on('createRoom', (playerName: string) => {
    const roomCode = generateRoomCode();
    const player: Player = {
      id: socket.id,
      name: playerName || 'Player 1',
      isAI: false,
      cards: [],
      tradesRemaining: 0,
      hasPassed: false,
      isReady: false,
      seatIndex: 0,
    };

    rooms[roomCode] = {
      roomCode,
      status: 'LOBBY',
      players: [player],
      tradeLimit: 1,
      activePlayerId: null,
      lastPlay: [],
      lastPlayerId: null,
      winnerId: null,
      combatLogs: [`Lobby ${roomCode} created by ${player.name}.`],
    };

    activeTradeOffers[roomCode] = [];
    socketToRoom[socket.id] = roomCode;
    socket.join(roomCode);
    socket.emit('roomState', rooms[roomCode], activeTradeOffers[roomCode]);
  });

  // Join room
  socket.on('joinRoom', ({ roomCode, playerName }: { roomCode: string; playerName: string }) => {
    const code = roomCode.toUpperCase();
    const room = rooms[code];

    if (!room) {
      socket.emit('errorMsg', 'Room not found.');
      return;
    }

    if (room.status !== 'LOBBY') {
      socket.emit('errorMsg', 'Game has already started.');
      return;
    }

    if (room.players.length >= 4) {
      socket.emit('errorMsg', 'Room is full.');
      return;
    }

    // Find first available seat index
    const takenSeats = room.players.map(p => p.seatIndex);
    let seatIndex = 0;
    for (let i = 0; i < 4; i++) {
      if (!takenSeats.includes(i)) {
        seatIndex = i;
        break;
      }
    }

    const player: Player = {
      id: socket.id,
      name: playerName || `Player ${room.players.length + 1}`,
      isAI: false,
      cards: [],
      tradesRemaining: 0,
      hasPassed: false,
      isReady: false,
      seatIndex,
    };

    room.players.push(player);
    // Sort players by seat index
    room.players.sort((a, b) => a.seatIndex - b.seatIndex);

    room.combatLogs.push(`${player.name} joined the lobby.`);
    socketToRoom[socket.id] = code;
    socket.join(code);

    io.to(code).emit('roomState', room, activeTradeOffers[code]);
  });

  // Add AI Bot
  socket.on('addBot', () => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];

    if (!room || room.status !== 'LOBBY' || room.players.length >= 4) return;

    const botNames = ['CyberBot', 'QuantumAI', 'DeepCard', 'AlphaDealer'];
    const currentBotNames = room.players.filter(p => p.isAI).map(p => p.name);
    let botName = botNames[0];
    for (const name of botNames) {
      if (!currentBotNames.includes(name)) {
        botName = name;
        break;
      }
    }

    const takenSeats = room.players.map(p => p.seatIndex);
    let seatIndex = 0;
    for (let i = 0; i < 4; i++) {
      if (!takenSeats.includes(i)) {
        seatIndex = i;
        break;
      }
    }

    const bot: Player = {
      id: `ai_${Math.random().toString(36).substr(2, 9)}`,
      name: botName,
      isAI: true,
      cards: [],
      tradesRemaining: 0,
      hasPassed: false,
      isReady: true, // Bots are always ready
      seatIndex,
    };

    room.players.push(bot);
    room.players.sort((a, b) => a.seatIndex - b.seatIndex);
    room.combatLogs.push(`${bot.name} (AI) joined the lobby.`);

    io.to(roomCode).emit('roomState', room, activeTradeOffers[roomCode]);
  });

  // Remove Player
  socket.on('removePlayer', (playerId: string) => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];

    if (!room || room.status !== 'LOBBY') return;

    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;

    const player = room.players[playerIndex];
    room.players.splice(playerIndex, 1);
    room.combatLogs.push(`${player.name} left the lobby.`);

    io.to(roomCode).emit('roomState', room, activeTradeOffers[roomCode]);
  });

  // Update Settings
  socket.on('updateSettings', ({ tradeLimit }: { tradeLimit: number }) => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];

    if (!room || room.status !== 'LOBBY') return;

    room.tradeLimit = tradeLimit;
    room.combatLogs.push(`Trade limit updated to ${tradeLimit} per player.`);

    io.to(roomCode).emit('roomState', room, activeTradeOffers[roomCode]);
  });

  // Start Game
  socket.on('startGame', () => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];

    if (!room || room.status !== 'LOBBY' || room.players.length < 2) return;

    // Fill remaining spots with bots to make it 4 players
    const botNames = ['CyberBot', 'QuantumAI', 'DeepCard', 'AlphaDealer'];
    while (room.players.length < 4) {
      const currentBotNames = room.players.filter(p => p.isAI).map(p => p.name);
      let botName = botNames[0];
      for (const name of botNames) {
        if (!currentBotNames.includes(name)) {
          botName = name;
          break;
        }
      }

      const takenSeats = room.players.map(p => p.seatIndex);
      let seatIndex = 0;
      for (let i = 0; i < 4; i++) {
        if (!takenSeats.includes(i)) {
          seatIndex = i;
          break;
        }
      }

      const bot: Player = {
        id: `ai_${Math.random().toString(36).substr(2, 9)}`,
        name: botName,
        isAI: true,
        cards: [],
        tradesRemaining: 0,
        hasPassed: false,
        isReady: true,
        seatIndex,
      };

      room.players.push(bot);
      room.players.sort((a, b) => a.seatIndex - b.seatIndex);
      room.combatLogs.push(`${bot.name} (AI) filled the table.`);
    }

    // Deal cards
    const deck = shuffle(createDeck());
    for (let i = 0; i < 4; i++) {
      room.players[i].cards = sortCards(deck.slice(i * 13, (i + 1) * 13));
      room.players[i].tradesRemaining = room.tradeLimit;
      room.players[i].hasPassed = false;
      room.players[i].isReady = room.players[i].isAI; // bots ready, humans not ready yet
    }

    room.lastPlay = [];
    room.lastPlayerId = null;
    room.winnerId = null;
    activeTradeOffers[roomCode] = [];

    if (room.tradeLimit > 0) {
      room.status = 'TRADING';
      room.combatLogs.push(`Cards dealt. Enter Card Trading Market (Limit: ${room.tradeLimit} trades).`);
    } else {
      startPlayPhase(room);
    }

    io.to(roomCode).emit('roomState', room, activeTradeOffers[roomCode]);
  });

  // Submit Trade Offer
  socket.on('submitTradeOffer', ({ cardId, lookingFor }: { cardId: string; lookingFor: { rank: number | null; suit: Suit | null } }) => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];

    if (!room || room.status !== 'TRADING') return;

    const offerer = room.players.find(p => p.id === socket.id);
    if (!offerer || offerer.tradesRemaining <= 0) return;

    const card = offerer.cards.find(c => c.id === cardId);
    if (!card) return;

    // Check if player already has an active offer
    const existingOfferIndex = activeTradeOffers[roomCode].findIndex(o => o.offererId === socket.id);
    if (existingOfferIndex !== -1) {
      // Remove old offer
      activeTradeOffers[roomCode].splice(existingOfferIndex, 1);
    }

    const offerId = `offer_${Math.random().toString(36).substr(2, 9)}`;
    const newOffer: TradeOffer = {
      id: offerId,
      offererId: socket.id,
      offererCard: card,
      lookingFor,
      bids: [],
    };

    activeTradeOffers[roomCode].push(newOffer);
    
    let lookingMsg = '';
    if (lookingFor.rank !== null || lookingFor.suit !== null) {
      const rName = lookingFor.rank ? (RANK_NAMES[lookingFor.rank] || lookingFor.rank) : 'Any';
      let sSymbol = '';
      if (lookingFor.suit === 'spades') sSymbol = '♠';
      else if (lookingFor.suit === 'clubs') sSymbol = '♣';
      else if (lookingFor.suit === 'diamonds') sSymbol = '♦';
      else if (lookingFor.suit === 'hearts') sSymbol = '♥';
      lookingMsg = ` (Looking for: ${rName}${sSymbol})`;
    }
    room.combatLogs.push(`${offerer.name} listed ${getCardName(card)} for trade${lookingMsg}.`);

    // Trigger AI bids on this offer
    for (const player of room.players) {
      if (player.isAI && player.tradesRemaining > 0) {
        const bidCard = evaluateTradeOffer(player.cards, card, lookingFor);
        if (bidCard) {
          newOffer.bids.push({
            bidderId: player.id,
            bidderCard: bidCard,
          });
          room.combatLogs.push(`${player.name} (AI) bid a card on ${offerer.name}'s offer.`);
        }
      }
    }

    io.to(roomCode).emit('roomState', room, activeTradeOffers[roomCode]);
  });

  // Submit Bid (from human player on another player's offer)
  socket.on('submitBid', ({ offerId, cardId }: { offerId: string; cardId: string }) => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];

    if (!room || room.status !== 'TRADING') return;

    const bidder = room.players.find(p => p.id === socket.id);
    if (!bidder || bidder.tradesRemaining <= 0) return;

    const card = bidder.cards.find(c => c.id === cardId);
    if (!card) return;

    const offer = activeTradeOffers[roomCode].find(o => o.id === offerId);
    if (!offer || offer.offererId === socket.id) return;

    // Remove any existing bid by this player on this offer
    offer.bids = offer.bids.filter(b => b.bidderId !== socket.id);

    offer.bids.push({
      bidderId: socket.id,
      bidderCard: card,
    });

    room.combatLogs.push(`${bidder.name} bid a card on trade offer.`);
    io.to(roomCode).emit('roomState', room, activeTradeOffers[roomCode]);
  });

  // Accept Bid
  socket.on('acceptBid', ({ offerId, bidderId }: { offerId: string; bidderId: string }) => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];

    if (!room || room.status !== 'TRADING') return;

    const offer = activeTradeOffers[roomCode].find(o => o.id === offerId);
    if (!offer || offer.offererId !== socket.id) return;

    const bid = offer.bids.find(b => b.bidderId === bidderId);
    if (!bid) return;

    const offerer = room.players.find(p => p.id === offer.offererId);
    const bidder = room.players.find(p => p.id === bidderId);

    if (!offerer || !bidder) return;
    if (offerer.tradesRemaining <= 0 || bidder.tradesRemaining <= 0) return;

    // Execute swap
    const offererCard = offer.offererCard;
    const bidderCard = bid.bidderCard;

    // Remove cards
    offerer.cards = offerer.cards.filter(c => c.id !== offererCard.id);
    bidder.cards = bidder.cards.filter(c => c.id !== bidderCard.id);

    // Add swapped cards
    offerer.cards.push(bidderCard);
    bidder.cards.push(offererCard);

    // Re-sort
    offerer.cards = sortCards(offerer.cards);
    bidder.cards = sortCards(bidder.cards);

    // Decrement trade count
    offerer.tradesRemaining--;
    bidder.tradesRemaining--;

    room.combatLogs.push(
      `TRADE CONFIRMED: ${offerer.name} swapped ${getCardName(offererCard)} for ${bidder.name}'s ${getCardName(bidderCard)}.`
    );

    // Remove all trade offers associated with these two players (since hands modified)
    activeTradeOffers[roomCode] = activeTradeOffers[roomCode].filter(
      o => o.offererId !== offerer.id && o.offererId !== bidder.id
    );

    // Also remove bids made by these players in other offers
    for (const o of activeTradeOffers[roomCode]) {
      o.bids = o.bids.filter(b => b.bidderId !== offerer.id && b.bidderId !== bidder.id);
    }

    io.to(roomCode).emit('roomState', room, activeTradeOffers[roomCode]);
  });

  // Ready Up / Close Trading
  socket.on('readyToPlay', () => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];

    if (!room || room.status !== 'TRADING') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    player.isReady = true;
    room.combatLogs.push(`${player.name} is ready.`);

    // If all human players are ready, start playing
    const allHumansReady = room.players.filter(p => !p.isAI).every(p => p.isReady);
    if (allHumansReady) {
      startPlayPhase(room);
    }

    io.to(roomCode).emit('roomState', room, activeTradeOffers[roomCode]);
  });

  // Host Skip Trading
  socket.on('skipTrading', () => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];

    if (!room || room.status !== 'TRADING') return;

    const isHost = room.players.length > 0 && room.players[0].id === socket.id;
    if (!isHost) return;

    room.combatLogs.push(`Host skipped the Card Trading Market.`);
    startPlayPhase(room);

    io.to(roomCode).emit('roomState', room, activeTradeOffers[roomCode]);
  });

  // Play Cards
  socket.on('playCards', (cardIds: string[]) => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];

    if (!room || room.status !== 'PLAYING') return;
    if (room.activePlayerId !== socket.id) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // Construct played card array
    const playedCards = cardIds.map(id => player.cards.find(c => c.id === id)).filter((c): c is Card => c !== undefined);

    if (playedCards.length !== cardIds.length) {
      socket.emit('errorMsg', 'Invalid cards selected.');
      return;
    }

    // Validate Play
    if (!isValidPlay(playedCards, room.lastPlay)) {
      socket.emit('errorMsg', 'This combination does not beat the active cards.');
      return;
    }

    // Check first game 3 of spades constraint if applicable
    const isFirstRoundEver = room.combatLogs.some(log => log.includes("First turn starts"));
    const isFirstPlay = room.lastPlay.length === 0 && !room.combatLogs.some(log => log.includes("played"));
    if (isFirstRoundEver && isFirstPlay) {
      const hasThreeOfSpades = player.cards.some(c => c.rank === 3 && c.suit === 'spades');
      if (hasThreeOfSpades) {
        const playedThreeOfSpades = playedCards.some(c => c.rank === 3 && c.suit === 'spades');
        if (!playedThreeOfSpades) {
          socket.emit('errorMsg', 'Your first play of the game must include the 3 of Spades ♠.');
          return;
        }
      }
    }

    // Apply Play
    player.cards = player.cards.filter(c => !cardIds.includes(c.id));
    room.lastPlay = playedCards;
    room.lastPlayerId = player.id;

    const playedNames = playedCards.map(getCardName).join(', ');
    room.combatLogs.push(`${player.name} played: [ ${playedNames} ] (${getComboType(playedCards)})`);

    // Check Win Condition
    if (player.cards.length === 0) {
      room.status = 'GAMEOVER';
      room.winnerId = player.id;
      room.combatLogs.push(`VICTORY: ${player.name} has shed all cards and won the game!`);
      io.to(roomCode).emit('roomState', room, activeTradeOffers[roomCode]);
      return;
    }

    // Advance turn
    advanceTurn(room);
  });

  // Pass Turn
  socket.on('passTurn', () => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];

    if (!room || room.status !== 'PLAYING') return;
    if (room.activePlayerId !== socket.id) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    player.hasPassed = true;
    room.combatLogs.push(`${player.name} passed.`);

    // Advance turn
    advanceTurn(room);
  });

  // Restart / Redeal
  socket.on('restartGame', () => {
    const roomCode = socketToRoom[socket.id];
    const room = rooms[roomCode];

    if (!room || room.status !== 'GAMEOVER') return;

    // Reset players states, keep them in lobby
    room.status = 'LOBBY';
    for (const player of room.players) {
      player.cards = [];
      player.tradesRemaining = 0;
      player.hasPassed = false;
      player.isReady = player.isAI;
    }
    room.lastPlay = [];
    room.lastPlayerId = null;
    room.winnerId = null;
    room.combatLogs = [`Lobby restarted. Ready for next game.`];
    activeTradeOffers[roomCode] = [];

    io.to(roomCode).emit('roomState', room, activeTradeOffers[roomCode]);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    const roomCode = socketToRoom[socket.id];
    if (roomCode) {
      const room = rooms[roomCode];
      if (room) {
        // Remove player
        room.players = room.players.filter(p => p.id !== socket.id);
        room.combatLogs.push(`Player disconnected.`);

        // Clean up trade offers associated
        activeTradeOffers[roomCode] = activeTradeOffers[roomCode].filter(o => o.offererId !== socket.id);

        if (room.players.filter(p => !p.isAI).length === 0) {
          // If no human players left, delete the room
          console.log(`Deleting empty room: ${roomCode}`);
          delete rooms[roomCode];
          delete activeTradeOffers[roomCode];
        } else {
          // If active turn was this player, advance
          if (room.status === 'PLAYING' && room.activePlayerId === socket.id) {
            advanceTurn(room);
          }
          io.to(roomCode).emit('roomState', room, activeTradeOffers[roomCode]);
        }
      }
      delete socketToRoom[socket.id];
    }
  });
});

// Starts the main play phase
function startPlayPhase(room: GameRoom) {
  room.status = 'PLAYING';
  
  // Find player with 3♠ (lowest value card) to start first round
  let startingPlayer = room.players[0];
  let lowestVal = 999;
  for (const p of room.players) {
    p.hasPassed = false;
    for (const c of p.cards) {
      if (c.value < lowestVal) {
        lowestVal = c.value;
        startingPlayer = p;
      }
    }
  }

  // If winner of previous game exists, they start instead (for continuity)
  // But for the very first round, 3♠ rules. We'll mark the first round check:
  room.activePlayerId = startingPlayer.id;
  room.combatLogs.push(`First turn starts! ${startingPlayer.name} has the 3 of Spades ♠ and plays first.`);

  // If starting player is AI, trigger its turn
  if (startingPlayer.isAI) {
    scheduleAITurn(room.roomCode);
  }
}

// Advance turn to the next player who has not passed and has cards
function advanceTurn(room: GameRoom) {
  const activeIndex = room.players.findIndex(p => p.id === room.activePlayerId);
  
  // Find next player
  let nextIndex = (activeIndex + 1) % 4;
  let loops = 0;
  
  // Keep looping until we find a player who hasn't passed and still has cards
  while (loops < 4) {
    const nextPlayer = room.players[nextIndex];
    if (!nextPlayer.hasPassed && nextPlayer.cards.length > 0) {
      break;
    }
    nextIndex = (nextIndex + 1) % 4;
    loops++;
  }

  // Count active players who haven't passed
  const activeCount = room.players.filter(p => !p.hasPassed && p.cards.length > 0).length;

  if (activeCount <= 1) {
    // Round is over! The last player who made a play starts the new round.
    let roundWinner = room.players.find(p => p.id === room.lastPlayerId);
    if (!roundWinner || roundWinner.cards.length === 0) {
      // Fallback to the only player left who hasn't passed
      roundWinner = room.players.find(p => !p.hasPassed && p.cards.length > 0) || room.players[nextIndex];
    }

    room.lastPlay = [];
    room.lastPlayerId = null;
    for (const p of room.players) {
      p.hasPassed = false;
    }
    room.activePlayerId = roundWinner.id;
    room.combatLogs.push(`Everyone passed. New round started by ${roundWinner.name}.`);

    // Broadcast update
    io.to(room.roomCode).emit('roomState', room, activeTradeOffers[room.roomCode]);

    if (roundWinner.isAI) {
      scheduleAITurn(room.roomCode);
    }
  } else {
    // Normal turn advance
    const nextPlayer = room.players[nextIndex];
    room.activePlayerId = nextPlayer.id;
    io.to(room.roomCode).emit('roomState', room, activeTradeOffers[room.roomCode]);

    if (nextPlayer.isAI) {
      scheduleAITurn(room.roomCode);
    }
  }
}

// Schedule AI play after a delay to simulate thinking and natural flow
function scheduleAITurn(roomCode: string) {
  setTimeout(() => {
    const room = rooms[roomCode];
    if (!room || room.status !== 'PLAYING') return;

    const activePlayer = room.players.find(p => p.id === room.activePlayerId);
    if (!activePlayer || !activePlayer.isAI) return;

    // AI computes play
    const aiPlay = getAIPlay(activePlayer.cards, room.lastPlay);

    if (aiPlay && aiPlay.length > 0) {
      // AI plays combination
      const cardIds = aiPlay.map(c => c.id);
      activePlayer.cards = activePlayer.cards.filter(c => !cardIds.includes(c.id));
      room.lastPlay = aiPlay;
      room.lastPlayerId = activePlayer.id;

      const playedNames = aiPlay.map(getCardName).join(', ');
      room.combatLogs.push(`${activePlayer.name} (AI) played: [ ${playedNames} ] (${getComboType(aiPlay)})`);

      // Check Win
      if (activePlayer.cards.length === 0) {
        room.status = 'GAMEOVER';
        room.winnerId = activePlayer.id;
        room.combatLogs.push(`VICTORY: ${activePlayer.name} (AI) has shed all cards and won the game!`);
        io.to(roomCode).emit('roomState', room, activeTradeOffers[roomCode]);
        return;
      }

      advanceTurn(room);
    } else {
      // AI passes
      activePlayer.hasPassed = true;
      room.combatLogs.push(`${activePlayer.name} (AI) passed.`);
      advanceTurn(room);
    }
  }, 1200); // 1.2s delay for visual readability
}

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
