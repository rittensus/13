import './style.css';
import { io, Socket } from 'socket.io-client';
import type { GameRoom, TradeOffer, Suit } from './types.js';
import {
  renderWelcomeScreen,
  renderLobbyScreen,
  renderGameScreen,
  showError,
  setReRenderCallback
} from './ui.js';
import {
  playCardSlide,
  playClick,
  playChime,
  playBuzz,
  resumeAudio,
  playVictoryFanfare,
  playCardSwoosh,
  playCardSnap,
  playComboPlay,
  playBombPlay
} from './audio.js';

const app = document.getElementById('app')!;
const socket: Socket = io();

// Workaround for browser autoplay policy: resume AudioContext on first user interaction
window.addEventListener('click', () => resumeAudio(), { once: true });
window.addEventListener('touchstart', () => resumeAudio(), { once: true });

let currentRoomState: GameRoom | null = null;
let currentOffersState: TradeOffer[] = [];

// Sound state track
let previousStatus: string | null = null;
let previousCardCount: Record<string, number> = {};
let previousLastPlayLength = 0;

// Listen to room updates
socket.on('roomState', (room: GameRoom, offers: TradeOffer[]) => {
  currentRoomState = room;
  currentOffersState = offers;
  
  // Trigger sound cues based on transitions
  triggerSoundCues(room);

  // Render view
  renderCurrentView();
});

// Listen to errors
socket.on('errorMsg', (msg: string) => {
  playBuzz();
  showError(msg);
});

// UI views dispatcher
function renderCurrentView() {
  if (!currentRoomState) {
    renderWelcomeScreen(app, handleCreateRoom, handleJoinRoom);
    return;
  }

  const room = currentRoomState;
  const status = room.status;

  if (status === 'LOBBY') {
    renderLobbyScreen(
      app,
      room,
      socket.id || '',
      handleAddBot,
      handleRemovePlayer,
      handleUpdateSettings,
      handleStartGame
    );
  } else {
    // Covers TRADING, PLAYING, GAMEOVER
    renderGameScreen(
      app,
      room,
      socket.id || '',
      currentOffersState,
      handlePlayCards,
      handlePassTurn,
      handleSubmitTradeOffer,
      handleSubmitBid,
      handleAcceptBid,
      handleReadyToPlay,
      handleSkipTrading,
      handleRestartGame,
      handleCancelTradeOffer,
      handleCancelBid
    );
  }
}

// Sound cue logic mapping
function triggerSoundCues(room: GameRoom) {
  // 1. Initial Deal transition (LOBBY -> TRADING or PLAYING)
  if (previousStatus === 'LOBBY' && (room.status === 'TRADING' || room.status === 'PLAYING')) {
    playCardSlide();
    setTimeout(playCardSlide, 200);
    setTimeout(playCardSlide, 400);
  }

  // 2. Play Turn (card played) & Turn notification
  if (room.status === 'PLAYING') {
    if (room.lastPlay.length > 0 && room.lastPlay.length !== previousLastPlayLength) {
      playCardSwoosh();
      const count = room.lastPlay.length;
      if (count === 1) {
        setTimeout(() => playCardSnap(), 150);
      } else if (count >= 4) {
        setTimeout(() => playBombPlay(), 150);
      } else {
        setTimeout(() => playComboPlay(count), 150);
      }
    }
    
    // Play notification chime when it becomes your turn
    const wasMyTurnBefore = currentRoomState?.activePlayerId === socket.id;
    const isMyTurnNow = room.activePlayerId === socket.id;
    if (isMyTurnNow && !wasMyTurnBefore && previousStatus === 'PLAYING') {
      playChime();
    }
  }

  // 3. Trade swaps (trades remaining decreased for players)
  if (room.status === 'TRADING' && previousStatus === 'TRADING') {
    let wasTradeMade = false;
    for (const player of room.players) {
      const prevCount = previousCardCount[player.id];
      if (prevCount !== undefined) {
        // Compare remaining trade limit
        const prevPlayer = currentRoomState?.players.find(p => p.id === player.id);
        if (prevPlayer && player.tradesRemaining < prevPlayer.tradesRemaining) {
          wasTradeMade = true;
        }
      }
    }
    if (wasTradeMade) {
      playChime();
    }
  }

  // 4. Game Over / Victory Fanfare
  if (room.status === 'GAMEOVER' && previousStatus !== 'GAMEOVER') {
    playVictoryFanfare();
  }

  // Save states
  previousStatus = room.status;
  previousLastPlayLength = room.lastPlay.length;
  previousCardCount = {};
  for (const p of room.players) {
    previousCardCount[p.id] = p.cards.length;
  }
}

// Event handlers
function handleCreateRoom(name: string) {
  playClick();
  socket.emit('createRoom', name);
}

function handleJoinRoom(name: string, code: string) {
  playClick();
  socket.emit('joinRoom', { roomCode: code, playerName: name });
}

function handleAddBot() {
  playClick();
  socket.emit('addBot');
}

function handleRemovePlayer(id: string) {
  playClick();
  socket.emit('removePlayer', id);
}

function handleUpdateSettings(limit: number) {
  playClick();
  socket.emit('updateSettings', { tradeLimit: limit });
}

function handleStartGame() {
  playChime();
  socket.emit('startGame');
}

function handlePlayCards(cardIds: string[]) {
  // Optimistically play card click sound, server will buzz if invalid
  socket.emit('playCards', cardIds);
}

function handlePassTurn() {
  playBuzz(); // pass sound
  socket.emit('passTurn');
}

function handleSubmitTradeOffer(cardId: string, lookingFor: { rank: number | null; suit: Suit | null }) {
  playClick();
  socket.emit('submitTradeOffer', { cardId, lookingFor });
}

function handleSkipTrading() {
  playClick();
  socket.emit('skipTrading');
}

function handleSubmitBid(offerId: string, cardId: string) {
  playClick();
  socket.emit('submitBid', { offerId, cardId });
}

function handleAcceptBid(offerId: string, bidderId: string) {
  socket.emit('acceptBid', { offerId, bidderId });
}

function handleReadyToPlay() {
  playClick();
  socket.emit('readyToPlay');
}

function handleRestartGame() {
  playClick();
  socket.emit('restartGame');
}

function handleCancelTradeOffer() {
  playClick();
  socket.emit('cancelTradeOffer');
}

function handleCancelBid(offerId: string) {
  playClick();
  socket.emit('cancelBid', { offerId });
}

// Initialize View
setReRenderCallback(renderCurrentView);
renderCurrentView();
