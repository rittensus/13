import type { GameRoom, Player, Card, TradeOffer, Suit } from './types.js';
import { isValidPlay } from './rules.js';
import { playCardSelect } from './audio.js';

// Global error alert timer
let errorTimeout: number | null = null;

export function showError(message: string) {
  // Remove existing error popups
  const existing = document.querySelector('.error-popup');
  if (existing) existing.remove();

  const errEl = document.createElement('div');
  errEl.className = 'error-popup';
  errEl.innerText = message;
  document.body.appendChild(errEl);

  if (errorTimeout) clearTimeout(errorTimeout);
  errorTimeout = window.setTimeout(() => {
    errEl.remove();
  }, 3500);
}

// Convert suit string to symbol and class suffix
function getSuitDetails(suit: string): { symbol: string; className: string } {
  switch (suit) {
    case 'spades': return { symbol: '♠', className: 'suit-spades' };
    case 'clubs': return { symbol: '♣', className: 'suit-clubs' };
    case 'diamonds': return { symbol: '♦', className: 'suit-diamonds' };
    case 'hearts': return { symbol: '♥', className: 'suit-hearts' };
    default: return { symbol: '?', className: '' };
  }
}

// Attach 3D tilt effect to a card element
function attach3DTilt(cardEl: HTMLElement) {
  cardEl.addEventListener('mousemove', (e) => {
    const rect = cardEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const xc = rect.width / 2;
    const yc = rect.height / 2;
    
    // Max rotation 12 degrees
    const rotateX = (yc - y) / 4;
    const rotateY = (x - xc) / 4;

    const isSelected = cardEl.classList.contains('selected');
    const baseTranslateY = isSelected ? -35 : -15;

    cardEl.style.transform = `translateY(${baseTranslateY}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.06)`;
    cardEl.style.transition = 'transform 0.05s ease';
  });

  cardEl.addEventListener('mouseleave', () => {
    cardEl.style.transform = '';
    cardEl.style.transition = 'transform 0.3s ease';
  });
}

// Dev and layout reactive state globals
let selectedOfferId: string | null = null;
let isDevMode = false;
let onReRenderCallback: (() => void) | null = null;
let selectedWants: { rank: number | null; suit: Suit | null } = { rank: null, suit: null };

interface PlayHistoryItem {
  cards: Card[];
  playerId: string | null;
  hasAnimated: boolean;
}
let currentRoundPlays: PlayHistoryItem[] = [];
let lastRenderedPlaySignature = '';

export function setReRenderCallback(cb: () => void) {
  onReRenderCallback = cb;
}

// 2. Render Lobby Setup Room screen
export function renderLobbyScreen(
  app: HTMLElement,
  room: GameRoom,
  socketId: string,
  onAddBot: () => void,
  onRemovePlayer: (id: string) => void,
  onUpdateSettings: (limit: number) => void,
  onStartGame: () => void
) {
  const isHost = room.players.length > 0 && room.players[0].id === socketId;
  const playersHtml = room.players.map(p => `
    <div class="lobby-player-row">
      <div class="player-info-meta">
        <span class="player-name">${p.name} ${p.isAI ? '(AI)' : ''} ${p.id === socketId ? '(You)' : ''}</span>
        ${p.id === room.players[0].id ? '<span class="player-status-badge ready">Host</span>' : ''}
      </div>
      <div>
        ${isHost && p.id !== socketId ? `<button class="remove-btn" data-id="${p.id}">Kick</button>` : ''}
      </div>
    </div>
  `).join('');

  app.innerHTML = `
    <div class="lobby-screen">
      <div class="lobby-card">
        <h2>Game Lobby</h2>
        <div class="room-code-display">${room.roomCode}</div>
        
        <div class="lobby-players">
          <div class="market-section-title">Players (${room.players.length}/4)</div>
          ${playersHtml}
        </div>

        <div class="input-group" style="text-align: left;">
          <label for="trade-limit">Pre-Game Trades Limit</label>
          <select id="trade-limit" ${!isHost ? 'disabled' : ''}>
            <option value="0" ${room.tradeLimit === 0 ? 'selected' : ''}>0 (No Trading)</option>
            <option value="1" ${room.tradeLimit === 1 ? 'selected' : ''}>1 Trade</option>
            <option value="2" ${room.tradeLimit === 2 ? 'selected' : ''}>2 Trades</option>
            <option value="3" ${room.tradeLimit === 3 ? 'selected' : ''}>3 Trades</option>
          </select>
        </div>

        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 25px;">
          ${isHost && room.players.length < 4 ? `<button id="add-bot-btn" class="btn-secondary" style="margin-top:0;">Add AI Bot</button>` : ''}
          ${isHost ? `<button id="start-game-btn" class="btn-primary">Start Game</button>` : '<div class="divider">Waiting for host to start</div>'}
        </div>
      </div>
    </div>
  `;

  // Bind settings change
  const selectLimit = document.getElementById('trade-limit') as HTMLSelectElement;
  selectLimit.addEventListener('change', () => {
    onUpdateSettings(parseInt(selectLimit.value));
  });

  // Bind kick buttons
  document.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).getAttribute('data-id');
      if (id) onRemovePlayer(id);
    });
  });

  // Bind host actions
  document.getElementById('add-bot-btn')?.addEventListener('click', onAddBot);
  document.getElementById('start-game-btn')?.addEventListener('click', onStartGame);
}

// Helper to create card HTML element
function createCardElement(card: Card, isPlayable: boolean = true): HTMLElement {
  const { symbol, className } = getSuitDetails(card.suit);
  const cardEl = document.createElement('div');
  cardEl.className = `card ${className}`;
  cardEl.setAttribute('data-id', card.id);
  cardEl.innerHTML = `
    <div class="card-inner">
      <div style="text-align: left;">
        <div class="card-value">${card.name}</div>
        <div class="card-suit">${symbol}</div>
      </div>
      <div class="card-center-suit">${symbol}</div>
      <div style="text-align: right; transform: rotate(180deg);">
        <div class="card-value">${card.name}</div>
        <div class="card-suit">${symbol}</div>
      </div>
    </div>
  `;
  if (isPlayable) {
    attach3DTilt(cardEl);
  }
  return cardEl;
}

function getWantsDescription(wants: { rank: number | null; suit: Suit | null }): string {
  if (wants.rank === null && wants.suit === null) return 'Any Card';
  const rankLabels: Record<number, string> = {
    3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2'
  };
  const suitSymbols: Record<string, string> = {
    spades: '♠', clubs: '♣', diamonds: '♦', hearts: '♥'
  };
  const rName = wants.rank ? (rankLabels[wants.rank] || String(wants.rank)) : 'Any';
  const sSym = wants.suit ? (suitSymbols[wants.suit] || wants.suit) : 'Any';

  if (wants.rank !== null && wants.suit !== null) return `${rName}${sSym}`;
  if (wants.rank !== null) return `Any ${rName}`;
  return `Any ${sSym}`;
}

export function showWantsSelectorModal(
  onSelect: (wants: { rank: number | null; suit: Suit | null }) => void
) {
  const existing = document.querySelector('.wants-modal-overlay');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'wants-modal-overlay';
  
  const ranks = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const suits: Suit[] = ['spades', 'clubs', 'diamonds', 'hearts'];
  const suitSymbols: Record<Suit, string> = { spades: '♠', clubs: '♣', diamonds: '♦', hearts: '♥' };
  const rankLabels: Record<number, string> = {
    3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2'
  };

  const rankSelectorsHtml = ranks.map(r => `
    <button class="wants-quick-btn rank-btn" data-rank="${r}">Any ${rankLabels[r]}</button>
  `).join('');

  const suitSelectorsHtml = suits.map(s => `
    <button class="wants-quick-btn suit-btn suit-${s}" data-suit="${s}">Any ${suitSymbols[s]}</button>
  `).join('');

  let cardsGridHtml = '';
  ranks.forEach(r => {
    suits.forEach(s => {
      const isRed = s === 'hearts' || s === 'diamonds';
      cardsGridHtml += `
        <div class="wants-grid-card ${isRed ? 'suit-red' : 'suit-black'}" data-rank="${r}" data-suit="${s}">
          <span class="val">${rankLabels[r]}</span>
          <span class="st">${suitSymbols[s]}</span>
        </div>
      `;
    });
  });

  modal.innerHTML = `
    <div class="wants-modal-card">
      <div class="modal-header">
        <h3>Select Card You Want</h3>
        <button id="close-wants-modal-btn" class="close-x">×</button>
      </div>
      
      <div class="modal-section">
        <button class="wants-quick-btn any-card-btn" data-any="true" style="width:100%; font-weight:700; border-color:var(--gold-accent); color:var(--gold-accent); background:rgba(213,178,99,0.05);">★ Any Card</button>
      </div>

      <div class="modal-section">
        <div class="section-title">Quick Suit Shortcuts</div>
        <div class="quick-suits-grid">
          ${suitSelectorsHtml}
        </div>
      </div>

      <div class="modal-section">
        <div class="section-title">Quick Rank Shortcuts</div>
        <div class="quick-ranks-grid">
          ${rankSelectorsHtml}
        </div>
      </div>

      <div class="modal-section" style="flex: 1; min-height: 0; display: flex; flex-direction: column;">
        <div class="section-title">Select Specific Card</div>
        <div class="specific-cards-scroll-grid">
          ${cardsGridHtml}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  document.getElementById('close-wants-modal-btn')?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  modal.querySelectorAll('.wants-quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('data-any')) {
        onSelect({ rank: null, suit: null });
      } else if (btn.getAttribute('data-suit')) {
        onSelect({ rank: null, suit: btn.getAttribute('data-suit') as Suit });
      } else if (btn.getAttribute('data-rank')) {
        onSelect({ rank: parseInt(btn.getAttribute('data-rank')!), suit: null });
      }
      closeModal();
    });
  });

  modal.querySelectorAll('.wants-grid-card').forEach(card => {
    card.addEventListener('click', () => {
      const rank = parseInt(card.getAttribute('data-rank')!);
      const suit = card.getAttribute('data-suit') as Suit;
      onSelect({ rank, suit });
      closeModal();
    });
  });
}

// 3. Render Game Screen (Table + Sidebar)
export function renderGameScreen(
  app: HTMLElement,
  room: GameRoom,
  socketId: string,
  activeTradeOffers: TradeOffer[],
  onPlayCards: (cardIds: string[]) => void,
  onPassTurn: () => void,
  onSubmitTradeOffer: (cardId: string, lookingFor: { rank: number | null; suit: Suit | null }) => void,
  onSubmitBid: (offerId: string, cardId: string) => void,
  onAcceptBid: (offerId: string, bidderId: string) => void,
  onReadyToPlay: () => void,
  onSkipTrading: () => void,
  onRestartGame: () => void,
  onCancelTradeOffer: () => void,
  onCancelBid: (offerId: string) => void
) {
  // Validate selected offer still exists
  if (selectedOfferId && !activeTradeOffers.some(o => o.id === selectedOfferId)) {
    selectedOfferId = null;
  }

  // Manage current round play history
  if (room.status !== 'PLAYING') {
    currentRoundPlays = [];
    lastRenderedPlaySignature = '';
  } else if (room.lastPlay.length === 0) {
    currentRoundPlays = [];
    lastRenderedPlaySignature = '';
  } else {
    const playSignature = room.lastPlay.map(c => c.id).join(',');
    if (playSignature !== lastRenderedPlaySignature) {
      const latestSig = currentRoundPlays.length > 0 
        ? currentRoundPlays[currentRoundPlays.length - 1].cards.map(c => c.id).join(',')
        : '';
      if (playSignature !== latestSig) {
        currentRoundPlays.push({
          cards: [...room.lastPlay],
          playerId: room.lastPlayerId,
          hasAnimated: false
        });
      }
      lastRenderedPlaySignature = playSignature;
    }
  }

  // 1. Identify seats
  const me = room.players.find(p => p.id === socketId);
  const mySeat = me ? me.seatIndex : 0;

  const getPlayerAtSeat = (relativeIndex: number): Player | undefined => {
    const seatIndex = (mySeat + relativeIndex) % 4;
    return room.players.find(p => p.seatIndex === seatIndex);
  };

  const pBottom = me;
  const pLeft = getPlayerAtSeat(1);
  const pTop = getPlayerAtSeat(2);
  const pRight = getPlayerAtSeat(3);

  // Clear existing UI structure first
  app.innerHTML = `
    <div class="game-screen">
      <!-- Sidebar Drawer Backdrop -->
      <div class="drawer-backdrop" id="drawer-backdrop"></div>

      <div class="table-area">
        <div class="table-outer-wood"></div>
        
        <!-- Mobile Header Bar -->
        <div class="table-header-bar">
          <span class="mobile-room-tag">Room: ${room.roomCode}</span>
          <button id="mobile-drawer-toggle" class="btn-game play">Logs ☰</button>
        </div>

        <div class="center-felt ${room.status === 'TRADING' ? 'trading-mode' : ''}">
          <div class="discard-pile" id="discard-pile-container">
            <span class="deck-pile-center">Tiến Lên</span>
          </div>
        </div>

        <!-- Seats -->
        <div class="seat bottom" id="seat-bottom"></div>
        <div class="seat left" id="seat-left"></div>
        <div class="seat top" id="seat-top"></div>
        <div class="seat right" id="seat-right"></div>
      </div>

      <!-- Logs Sidebar -->
      <div class="side-panel">
        <div class="side-header">
          <span>Game Logs</span>
          <span class="room-tag">Room: ${room.roomCode}</span>
        </div>
        <div class="logs-container" id="logs-container"></div>
        <div class="sidebar-footer" style="padding: 4px 10px; font-size: 0.65rem; color: var(--text-secondary); text-align: right; opacity: 0.5; border-top: 1px solid rgba(255,255,255,0.05); font-family: var(--font-sans);">
          v1.3.0
        </div>
      </div>
    </div>
  `;

  // Mobile Drawer Toggle handlers
  const drawerToggle = document.getElementById('mobile-drawer-toggle');
  const sidePanel = document.querySelector('.side-panel');
  const drawerBackdrop = document.getElementById('drawer-backdrop');

  if (drawerToggle && sidePanel && drawerBackdrop) {
    drawerToggle.addEventListener('click', () => {
      sidePanel.classList.add('drawer-active');
      (drawerBackdrop as HTMLElement).style.display = 'block';
    });

    drawerBackdrop.addEventListener('click', () => {
      sidePanel.classList.remove('drawer-active');
      (drawerBackdrop as HTMLElement).style.display = 'none';
    });
  }

  // Render Dev Mode bar if enabled
  if (isDevMode) {
    renderDevSandboxBar(app, room.status.toLowerCase());
  }

  // 2. Render logs
  const logsEl = document.getElementById('logs-container')!;
  logsEl.innerHTML = room.combatLogs.map(log => {
    let typeClass = 'system';
    if (log.includes('played:')) typeClass = 'play';
    if (log.includes('passed')) typeClass = 'pass';
    return `<div class="log-entry ${typeClass}">${log}</div>`;
  }).join('');
  logsEl.scrollTop = logsEl.scrollHeight;

  // 3. Render Center Area (Discard Pile OR Trade Inspector)
  const discardEl = document.getElementById('discard-pile-container')!;
  
  if (room.status === 'TRADING') {
    discardEl.innerHTML = '';
    
    if (selectedOfferId === null) {
      // General view: show active offers as mini clickable cards
      if (activeTradeOffers.length === 0) {
        discardEl.innerHTML = `
          <div class="deck-pile-center" style="opacity: 0.45; text-align: center; line-height: 1.5;">
            No Active Offers<br>
            <span style="font-size:0.75rem; font-family:var(--font-sans);">Select a card in your hand and click "List Card" to start bartering!</span>
          </div>
        `;
      } else {
        const rowHeader = document.createElement('div');
        rowHeader.style.color = 'var(--gold-accent)';
        rowHeader.style.fontSize = '0.85rem';
        rowHeader.style.textTransform = 'uppercase';
        rowHeader.style.letterSpacing = '0.5px';
        rowHeader.style.marginBottom = '10px';
        rowHeader.innerText = 'Active Offers on Table';
        discardEl.appendChild(rowHeader);

        const listContainer = document.createElement('div');
        listContainer.className = 'table-trade-offers-scroll-row';
        
        activeTradeOffers.forEach(offer => {
          const offerer = room.players.find(p => p.id === offer.offererId);
          if (!offerer) return;
          
          const isMyOffer = offer.offererId === socketId;
          const { symbol, className } = getSuitDetails(offer.offererCard.suit);

          const offerEl = document.createElement('div');
          offerEl.className = `mini-trade-card-btn ${isMyOffer ? 'my-offer' : ''}`;
          offerEl.innerHTML = `
            <div class="lbl">${offerer.name}</div>
            <div class="mini-card-view ${className}">
              <span class="val">${offer.offererCard.name}</span>
              <span class="st">${symbol}</span>
            </div>
            <div class="bids-badge">${offer.bids.length} Bid${offer.bids.length !== 1 ? 's' : ''}</div>
          `;
          
          offerEl.addEventListener('click', () => {
            selectedOfferId = offer.id;
            if (onReRenderCallback) onReRenderCallback();
          });

          listContainer.appendChild(offerEl);
        });

        discardEl.appendChild(listContainer);
        
        const helperText = document.createElement('div');
        helperText.style.fontSize = '0.75rem';
        helperText.style.color = 'var(--text-secondary)';
        helperText.style.marginTop = '10px';
        helperText.innerText = 'Click any player\'s offer card above or in their seat to inspect and bid.';
        discardEl.appendChild(helperText);
      }
    } else {
      // Inspector view: show detailed selected offer
      const offer = activeTradeOffers.find(o => o.id === selectedOfferId)!;
      const offerer = room.players.find(p => p.id === offer.offererId)!;
      const isMyOffer = offer.offererId === socketId;
      const { symbol, className } = getSuitDetails(offer.offererCard.suit);

      // Wants description
      let wantsText = 'Any';
      if (offer.lookingFor.rank !== null || offer.lookingFor.suit !== null) {
        const rankNames: Record<number, string> = {
          3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
          11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2'
        };
        const rName = offer.lookingFor.rank ? (rankNames[offer.lookingFor.rank] || offer.lookingFor.rank) : '';
        let sSymbol = '';
        if (offer.lookingFor.suit === 'spades') sSymbol = '♠';
        else if (offer.lookingFor.suit === 'clubs') sSymbol = '♣';
        else if (offer.lookingFor.suit === 'diamonds') sSymbol = '♦';
        else if (offer.lookingFor.suit === 'hearts') sSymbol = '♥';
        wantsText = `${rName}${sSymbol}`.trim();
      }

      let bidsHtml = '';
      if (isMyOffer) {
        if (offer.bids.length === 0) {
          bidsHtml = `<div class="no-bids-text" style="padding:10px 0;">Waiting for other players to bid...</div>`;
        } else {
          bidsHtml = offer.bids.map(b => {
            const bidder = room.players.find(p => p.id === b.bidderId);
            const bCard = getSuitDetails(b.bidderCard.suit);
            return `
              <div class="bid-entry-line">
                <span class="bidder-name-label">${bidder ? bidder.name : 'AI'}:</span>
                <span class="bid-card-label ${bCard.className}">${b.bidderCard.name}${bCard.symbol}</span>
                <button class="accept-bid-btn" data-offer-id="${offer.id}" data-bidder-id="${b.bidderId}">Accept</button>
              </div>
            `;
          }).join('');
        }
      } else {
        const myBid = offer.bids.find(b => b.bidderId === socketId);
        const otherBidsCount = offer.bids.filter(b => b.bidderId !== socketId).length;
        bidsHtml = `
          <div class="bid-entry-line-client" style="text-align: center; width: 100%;">
            ${myBid ? `
              <div class="my-active-bid-indicator" style="font-size:0.8rem; margin-bottom: 6px;">
                Your bid: <span class="${getSuitDetails(myBid.bidderCard.suit).className}">${myBid.bidderCard.name}${getSuitDetails(myBid.bidderCard.suit).symbol}</span>
              </div>
            ` : `
              <span class="no-bids-text" style="display:block; margin-bottom:6px; font-size:0.75rem;">${otherBidsCount} other bids placed</span>
            `}
            <div style="display:flex; gap:8px; justify-content:center; width:100%;">
              <button class="btn-game play bid-offer-btn" data-offer-id="${offer.id}" ${me && me.tradesRemaining > 0 ? '' : 'disabled'} style="padding: 4px 10px; font-size: 0.75rem; margin:0;">
                ${myBid ? 'Change Bid' : 'Bid Selected'}
              </button>
              ${myBid ? `
                <button class="btn-game pass cancel-bid-btn" data-offer-id="${offer.id}" style="border-color:#ff4a5a; color:#ff4a5a; background:rgba(255,74,90,0.05); padding: 4px 10px; font-size: 0.75rem; margin:0;">
                  Cancel Bid
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }

      discardEl.innerHTML = `
        <div class="trade-inspector-panel">
          <div class="inspector-header">
            <button id="inspector-back-btn" class="btn-game pass" style="padding: 2px 8px; font-size: 0.75rem; margin: 0;">⬅ Back</button>
            <span style="font-weight:700; color:var(--gold-accent); font-size:0.9rem;">${offerer.name}'s Offer</span>
          </div>

          <div class="inspector-core">
            <div class="mini-card-view ${className}">
              <span class="val">${offer.offererCard.name}</span>
              <span class="st">${symbol}</span>
            </div>
            <span class="trade-arrow" style="font-size:1.5rem;">➔</span>
            <div class="trade-wants-display" style="text-align:center;">
              <div class="wants-lbl">Looking For</div>
              <div class="wants-val" style="font-size:1.2rem;">${wantsText}</div>
            </div>
          </div>

          <div class="trade-bids-container-box" style="margin-top:10px; width: 100%;">
            <div style="font-size:0.75rem; text-transform:uppercase; color:var(--gold-accent); margin-bottom:5px; text-align:left;">Bids:</div>
            ${bidsHtml}
          </div>
        </div>
      `;

      document.getElementById('inspector-back-btn')?.addEventListener('click', () => {
        selectedOfferId = null;
        if (onReRenderCallback) onReRenderCallback();
      });

      // Bind Accept bids
      discardEl.querySelectorAll('.accept-bid-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const offerId = (e.target as HTMLElement).getAttribute('data-offer-id')!;
          const bidderId = (e.target as HTMLElement).getAttribute('data-bidder-id')!;
          onAcceptBid(offerId, bidderId);
        });
      });

      // Bind Bid button
      discardEl.querySelector('.bid-offer-btn')?.addEventListener('click', (e) => {
        const offerId = (e.target as HTMLElement).getAttribute('data-offer-id')!;
        const selected = document.querySelector('.cards-container .card.selected');
        if (!selected) {
          showError('Select a card from your hand first to Bid.');
          return;
        }
        const cardId = selected.getAttribute('data-id')!;
        onSubmitBid(offerId, cardId);
      });

      // Bind Cancel Bid button
      discardEl.querySelector('.cancel-bid-btn')?.addEventListener('click', (e) => {
        const offerId = (e.target as HTMLElement).getAttribute('data-offer-id')!;
        onCancelBid(offerId);
      });
    }
  } else if (room.lastPlay.length > 0 && currentRoundPlays.length > 0) {
    discardEl.innerHTML = '';

    currentRoundPlays.forEach((play, playIdx) => {
      const isLatest = (playIdx === currentRoundPlays.length - 1);
      const animateThisPlay = isLatest && !play.hasAnimated;

      // Find the relative seat index of the player to animate from their position
      let originX = 0;
      let originY = 250;
      if (animateThisPlay) {
        const lastPlayer = room.players.find(p => p.id === play.playerId);
        const lastPlayerSeat = lastPlayer ? lastPlayer.seatIndex : 0;
        const relativeSeatIndex = (lastPlayerSeat - mySeat + 4) % 4;
        if (relativeSeatIndex === 1) {
          originX = -350;
          originY = 0;
        } else if (relativeSeatIndex === 2) {
          originX = 0;
          originY = -250;
        } else if (relativeSeatIndex === 3) {
          originX = 350;
          originY = 0;
        }
      }

      // Visual stack offset for older plays in same round
      const playOffsetCount = currentRoundPlays.length - 1 - playIdx;
      const playShiftX = -12 * playOffsetCount;
      const playShiftY = -6 * playOffsetCount;

      play.cards.forEach((card, cardIdx) => {
        const cardEl = createCardElement(card, false);

        const angle = -10 + (cardIdx * 8);
        const offsetX = -25 + (cardIdx * 25) + playShiftX;
        const offsetY = -5 + (cardIdx * 2) + playShiftY;

        if (animateThisPlay) {
          cardEl.className = `${cardEl.className} played-card`;
          cardEl.style.setProperty('--play-origin-x', `${originX}px`);
          cardEl.style.setProperty('--play-origin-y', `${originY}px`);
          cardEl.style.setProperty('--play-offset-x', `${offsetX}px`);
          cardEl.style.setProperty('--play-offset-y', `${offsetY}px`);
          cardEl.style.setProperty('--play-angle', `${angle}deg`);
          cardEl.style.animationDelay = `${cardIdx * 80}ms`;
        } else if (isLatest) {
          cardEl.className = `${cardEl.className} played-card-static`;
        } else {
          cardEl.className = `${cardEl.className} played-card-history`;
        }

        // Set static transform positioning
        cardEl.style.transform = `translate(${offsetX}px, ${offsetY}px) rotate(${angle}deg)`;
        discardEl.appendChild(cardEl);
      });

      // Mark this play as animated so it remains static on subsequent re-renders
      if (isLatest) {
        play.hasAnimated = true;
      }
    });
  }

  // 4. Render other players' seats (AI/Other Humans)
  const renderSeatPanel = (player: Player | undefined, elementId: string, position: string) => {
    const el = document.getElementById(elementId)!;
    if (!player) {
      el.innerHTML = '';
      return;
    }
    const isActive = room.activePlayerId === player.id;
    const miniCardsHtml = Array.from({ length: player.cards.length })
      .map(() => '<div class="ai-card-back-mini"></div>')
      .join('');

    // Check if player has an active trade offer
    const playerOffer = activeTradeOffers.find(o => o.offererId === player.id);
    let tradePreviewHtml = '';
    
    if (playerOffer && room.status === 'TRADING') {
      const { symbol, className } = getSuitDetails(playerOffer.offererCard.suit);
      const isSelected = selectedOfferId === playerOffer.id;
      tradePreviewHtml = `
        <div class="player-panel-trade-preview ${className} ${isSelected ? 'selected' : ''}" data-offer-id="${playerOffer.id}">
          <div class="preview-title">Offer</div>
          <div class="preview-card-display">
            <span class="preview-val">${playerOffer.offererCard.name}</span>
            <span class="preview-st">${symbol}</span>
          </div>
        </div>
      `;
    }

    el.innerHTML = `
      <div class="player-panel ${isActive ? 'active-turn' : ''} ${player.hasPassed ? 'passed' : ''}">
        ${player.hasPassed ? '<span class="passed-indicator">Pass</span>' : ''}
        <div class="player-name">${player.name}</div>
        <div class="player-card-count">${player.cards.length} Cards</div>
        ${position !== 'bottom' ? `<div class="ai-cards-back">${miniCardsHtml}</div>` : ''}
      </div>
      ${tradePreviewHtml}
    `;

    // Click trade preview to open in inspector
    if (playerOffer && room.status === 'TRADING') {
      const previewEl = el.querySelector('.player-panel-trade-preview') as HTMLElement;
      previewEl?.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedOfferId = playerOffer.id;
        if (onReRenderCallback) onReRenderCallback();
      });
    }
  };

  renderSeatPanel(pLeft, 'seat-left', 'left');
  renderSeatPanel(pTop, 'seat-top', 'top');
  renderSeatPanel(pRight, 'seat-right', 'right');
  renderSeatPanel(pBottom, 'seat-bottom', 'bottom');

  // 5. Render bottom seat components (TRADING vs PLAYING modes)
  if (pBottom) {
    const bottomSeatEl = document.getElementById('seat-bottom')!;
    
    if (room.status === 'TRADING') {
      bottomSeatEl.innerHTML = ''; // reset panel

      // Create cards list
      const cardsContainer = document.createElement('div');
      cardsContainer.className = 'cards-container';
      pBottom.cards.forEach(card => {
        const cardEl = createCardElement(card);
        cardEl.addEventListener('click', () => {
          playCardSelect();
          const wasSelected = cardEl.classList.contains('selected');
          cardsContainer.querySelectorAll('.card').forEach(el => el.classList.remove('selected'));
          if (!wasSelected) {
            cardEl.classList.add('selected');
          }
          updateTradeControlsState();
        });
        cardsContainer.appendChild(cardEl);
      });
      bottomSeatEl.appendChild(cardsContainer);

      // Create Trading Controls Panel
      let updateTradeControlsState = () => {};
      const isHost = room.players.length > 0 && room.players[0].id === socketId;
      const myOffer = activeTradeOffers.find(o => o.offererId === socketId);
      const tradeControls = document.createElement('div');
      tradeControls.className = 'trading-controls-panel-integrated';

      if (myOffer) {
        tradeControls.innerHTML = `
          <div class="trade-dropdowns">
            <div style="font-size:0.85rem; padding: 10px; border-radius: 6px; background: rgba(213,178,99,0.08); border: 1px solid rgba(213,178,99,0.2); text-align: center; width: 100%;">
              You offered <span class="${getSuitDetails(myOffer.offererCard.suit).className}" style="font-weight:700;">${myOffer.offererCard.name}${getSuitDetails(myOffer.offererCard.suit).symbol}</span>
              for <span style="font-weight:700; color: var(--gold-accent);">${getWantsDescription(myOffer.lookingFor)}</span>
            </div>
          </div>
          <div class="trade-buttons">
            <button id="withdraw-offer-btn" class="btn-game pass" style="border-color:#ff4a5a; color:#ff4a5a; background:rgba(255,74,90,0.05); margin: 0; padding: 10px 14px;">Withdraw Listing</button>
            <button id="ready-trade-btn" class="btn-game play" ${pBottom.isReady ? 'disabled' : ''}>
              ${pBottom.isReady ? 'Ready ✓' : 'Ready to Play'}
            </button>
            ${isHost ? `<button id="skip-trade-btn" class="btn-game pass" style="border-color:#fa9632; color:#fa9632; background:rgba(250,150,50,0.05);">Skip Trading</button>` : ''}
          </div>
          <div class="trade-status-text">
            Remaining Trades: ${pBottom.tradesRemaining} ${pBottom.isReady ? '(Ready)' : ''}
          </div>
        `;
        bottomSeatEl.insertBefore(tradeControls, cardsContainer);

        const withdrawBtn = document.getElementById('withdraw-offer-btn') as HTMLButtonElement;
        const readyBtn = document.getElementById('ready-trade-btn') as HTMLButtonElement;
        const skipBtn = document.getElementById('skip-trade-btn') as HTMLButtonElement;

        withdrawBtn.addEventListener('click', () => {
          onCancelTradeOffer();
        });
        readyBtn.addEventListener('click', onReadyToPlay);
        if (skipBtn) {
          skipBtn.addEventListener('click', onSkipTrading);
        }
      } else {
        tradeControls.innerHTML = `
          <div class="trade-dropdowns">
            <button id="select-wants-trigger-btn" class="btn-game play" style="width: 100%; margin: 0; padding: 10px 14px; font-size: 0.85rem; justify-content: center; display: flex; align-items: center; gap: 8px;">
              <span>🔍 Want:</span> <span style="font-weight: 700; color: var(--gold-accent);">${getWantsDescription(selectedWants)}</span>
            </button>
          </div>
          <div class="trade-buttons">
            <button id="list-trade-btn" class="btn-game play" disabled>List Card for Trade</button>
            <button id="ready-trade-btn" class="btn-game pass" ${pBottom.isReady ? 'disabled' : ''}>
              ${pBottom.isReady ? 'Ready ✓' : 'Ready to Play'}
            </button>
            ${isHost ? `<button id="skip-trade-btn" class="btn-game pass" style="border-color:#fa9632; color:#fa9632; background:rgba(250,150,50,0.05);">Skip Trading</button>` : ''}
          </div>
          <div class="trade-status-text">
            Remaining Trades: ${pBottom.tradesRemaining} ${pBottom.isReady ? '(Ready)' : ''}
          </div>
        `;
        bottomSeatEl.insertBefore(tradeControls, cardsContainer);

        const selectWantsBtn = document.getElementById('select-wants-trigger-btn') as HTMLButtonElement;
        const listBtn = document.getElementById('list-trade-btn') as HTMLButtonElement;
        const readyBtn = document.getElementById('ready-trade-btn') as HTMLButtonElement;
        const skipBtn = document.getElementById('skip-trade-btn') as HTMLButtonElement;

        updateTradeControlsState = () => {
          const selected = cardsContainer.querySelector('.card.selected');
          if (selected && pBottom.tradesRemaining > 0) {
            listBtn.disabled = false;
          } else {
            listBtn.disabled = true;
          }
        };

        selectWantsBtn.addEventListener('click', () => {
          showWantsSelectorModal((wants) => {
            selectedWants = wants;
            playCardSelect();
            if (onReRenderCallback) onReRenderCallback();
          });
        });

        listBtn.addEventListener('click', () => {
          const selected = cardsContainer.querySelector('.card.selected');
          if (!selected) return;
          const cardId = selected.getAttribute('data-id')!;
          onSubmitTradeOffer(cardId, selectedWants);
          selectedWants = { rank: null, suit: null };
        });

        readyBtn.addEventListener('click', onReadyToPlay);
        if (skipBtn) {
          skipBtn.addEventListener('click', onSkipTrading);
        }
      }

    } else if (room.status === 'PLAYING') {
      const isMyTurn = room.activePlayerId === socketId;
      
      // Create card collection container
      const cardsContainer = document.createElement('div');
      cardsContainer.className = 'cards-container';
      
      pBottom.cards.forEach(card => {
        const cardEl = createCardElement(card);
        cardEl.addEventListener('click', () => {
          playCardSelect();
          cardEl.classList.toggle('selected');
          updatePlayButtonState();
        });
        cardsContainer.appendChild(cardEl);
      });
      
      bottomSeatEl.appendChild(cardsContainer);

      // Controls Panel
      const controlsHtml = document.createElement('div');
      controlsHtml.className = 'action-controls';
      controlsHtml.innerHTML = `
        <button id="play-btn" class="btn-game play" disabled>Play Cards</button>
        <button id="pass-btn" class="btn-game pass" ${!isMyTurn || room.lastPlay.length === 0 ? 'disabled' : ''}>Pass</button>
      `;
      bottomSeatEl.appendChild(controlsHtml);

      const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
      const passBtn = document.getElementById('pass-btn') as HTMLButtonElement;

      const updatePlayButtonState = () => {
        if (!isMyTurn) {
          playBtn.disabled = true;
          return;
        }
        const selectedEls = cardsContainer.querySelectorAll('.card.selected');
        if (selectedEls.length === 0) {
          playBtn.disabled = true;
          return;
        }

        const selectedIds = Array.from(selectedEls).map(el => el.getAttribute('data-id'));
        const selectedCards = selectedIds
          .map(id => pBottom.cards.find(c => c.id === id))
          .filter((c): c is Card => c !== undefined);

        if (isValidPlay(selectedCards, room.lastPlay)) {
          playBtn.disabled = false;
        } else {
          playBtn.disabled = true;
        }
      };

      playBtn.addEventListener('click', () => {
        const selectedEls = cardsContainer.querySelectorAll('.card.selected');
        const selectedIds = Array.from(selectedEls).map(el => el.getAttribute('data-id') as string);
        onPlayCards(selectedIds);
      });

      passBtn.addEventListener('click', onPassTurn);
    }
  }

  // 7. RENDER GAME OVER / VICTORY OVERLAY
  if (room.status === 'GAMEOVER') {
    const winner = room.players.find(p => p.id === room.winnerId);
    const winOverlay = document.createElement('div');
    winOverlay.className = 'victory-overlay';
    winOverlay.innerHTML = `
      <div class="victory-card">
        <span class="victory-icon">🏆</span>
        <div class="victory-title">${winner ? winner.name : 'Unknown'} Wins!</div>
        <div class="victory-subtitle">All cards shed successfully.</div>
        <button id="restart-btn" class="btn-primary">Back to Lobby</button>
      </div>
    `;
    app.appendChild(winOverlay);

    document.getElementById('restart-btn')?.addEventListener('click', onRestartGame);
  }
}

// 4. Update renderWelcomeScreen to include Sandbox start button (dev only) and version
export function renderWelcomeScreen(
  app: HTMLElement,
  onCreate: (name: string) => void,
  onJoin: (name: string, code: string) => void
) {
  const showDevSandbox = import.meta.env.DEV;

  app.innerHTML = `
    <div class="welcome-screen">
      <div class="welcome-card">
        <h1>Tiến Lên Classic</h1>
        <div style="font-size:0.75rem; color:var(--text-secondary); text-align:center; margin-top:-10px; margin-bottom:20px; opacity:0.6;">v1.3.0</div>
        <div class="input-group">
          <label for="player-name">Your Display Name</label>
          <input type="text" id="player-name" placeholder="Enter name..." value="Netrunner">
        </div>
        <button id="create-room-btn" class="btn-primary">Create Table</button>
        <div class="divider">Or Join Table</div>
        <div class="input-group">
          <label for="room-code">Room Code</label>
          <input type="text" id="room-code" placeholder="4-Letter Code" style="text-align: center; text-transform: uppercase;">
        </div>
        <button id="join-room-btn" class="btn-secondary">Join Game</button>
        ${showDevSandbox ? `
          <div class="divider" style="margin-top:25px;">Testing Sandbox</div>
          <button id="dev-sandbox-btn" class="btn-secondary" style="border-color:var(--gold-accent); color:var(--gold-accent); background:rgba(213,178,99,0.05);">Start Dev Sandbox</button>
        ` : ''}
      </div>
    </div>
  `;

  // If Dev Mode was enabled, remove any lingering bar when showing welcome screen normally
  const devBar = document.querySelector('.dev-sandbox-bar');
  if (devBar && !isDevMode) devBar.remove();

  const nameInput = document.getElementById('player-name') as HTMLInputElement;
  const codeInput = document.getElementById('room-code') as HTMLInputElement;

  // Set randomized name default
  const localName = localStorage.getItem('tl_name');
  if (localName) {
    nameInput.value = localName;
  } else {
    nameInput.value = `Player_${Math.floor(100 + Math.random() * 900)}`;
  }

  document.getElementById('create-room-btn')?.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      showError('Please enter a display name.');
      return;
    }
    localStorage.setItem('tl_name', name);
    onCreate(name);
  });

  document.getElementById('join-room-btn')?.addEventListener('click', () => {
    const name = nameInput.value.trim();
    const code = codeInput.value.trim().toUpperCase();
    if (!name) {
      showError('Please enter a display name.');
      return;
    }
    if (code.length !== 4) {
      showError('Room code must be exactly 4 letters.');
      return;
    }
    localStorage.setItem('tl_name', name);
    onJoin(name, code);
  });

  // Start Sandbox (dev only)
  if (showDevSandbox) {
    document.getElementById('dev-sandbox-btn')?.addEventListener('click', () => {
      isDevMode = true;
      renderDevSandboxBar(app, 'welcome');
      // Load lobby mock state
      const { room, offers } = getMockRoom('lobby');
      renderGameScreen(
        app,
        room,
        'dev_player',
        offers,
        () => {},
        () => {},
        () => {},
        () => {},
        () => {},
        () => {},
        () => {},
        () => {},
        () => {},
        () => {}
      );
      renderDevSandboxBar(app, 'lobby');
    });
  }
}

function mockCard(rank: number, suit: Suit): Card {
  const rankNames: Record<number, string> = {
    3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2'
  };
  const suitIndex = { spades: 0, clubs: 1, diamonds: 2, hearts: 3 }[suit];
  return {
    id: `${rank}_${suit}`,
    suit,
    rank,
    name: rankNames[rank] || String(rank),
    value: rank * 4 + suitIndex
  };
}

export function getMockRoom(mode: string): { room: GameRoom, offers: TradeOffer[] } {
  const pBottom: Player = {
    id: 'dev_player',
    name: 'You (Dev)',
    isAI: false,
    cards: [
      mockCard(3, 'spades'),
      mockCard(3, 'clubs'),
      mockCard(4, 'diamonds'),
      mockCard(5, 'hearts'),
      mockCard(9, 'spades'),
      mockCard(10, 'clubs'),
      mockCard(11, 'diamonds'),
      mockCard(12, 'hearts'),
      mockCard(13, 'spades'),
      mockCard(14, 'clubs'),
      mockCard(15, 'diamonds'),
      mockCard(15, 'hearts')
    ],
    tradesRemaining: 2,
    hasPassed: false,
    isReady: mode === 'playing',
    seatIndex: 0
  };

  const pLeft: Player = {
    id: 'bot_1',
    name: 'Bot Alpha',
    isAI: true,
    cards: Array.from({ length: 12 }, (_, i) => mockCard(4 + Math.floor(i / 2), 'spades')),
    tradesRemaining: 1,
    hasPassed: false,
    isReady: false,
    seatIndex: 1
  };

  const pTop: Player = {
    id: 'bot_2',
    name: 'Bot Beta',
    isAI: true,
    cards: Array.from({ length: 10 }, (_, i) => mockCard(5 + Math.floor(i / 2), 'clubs')),
    tradesRemaining: 2,
    hasPassed: false,
    isReady: false,
    seatIndex: 2
  };

  const pRight: Player = {
    id: 'bot_3',
    name: 'Bot Gamma',
    isAI: true,
    cards: Array.from({ length: 13 }, (_, i) => mockCard(3 + Math.floor(i / 2), 'diamonds')),
    tradesRemaining: 0,
    hasPassed: mode === 'playing',
    isReady: true,
    seatIndex: 3
  };

  const statusMap: Record<string, GameRoom['status']> = {
    lobby: 'LOBBY',
    trading: 'TRADING',
    playing: 'PLAYING',
    gameover: 'GAMEOVER'
  };

  const room: GameRoom = {
    roomCode: 'DEVS',
    status: statusMap[mode] || 'PLAYING',
    players: [pBottom, pLeft, pTop, pRight],
    tradeLimit: 2,
    activePlayerId: mode === 'playing' ? 'dev_player' : null,
    lastPlay: mode === 'playing' ? [mockCard(8, 'clubs'), mockCard(8, 'hearts')] : [],
    lastPlayerId: mode === 'playing' ? 'bot_1' : null,
    winnerId: mode === 'gameover' ? 'dev_player' : null,
    combatLogs: [
      'Game started in Dev Mode.',
      'Dealing 13 cards to everyone.',
      'Trading phase initiated.',
      mode === 'playing' ? 'Bot Alpha played: 8♣, 8♥' : 'Waiting for ready status.'
    ]
  };

  const offers: TradeOffer[] = [];
  if (mode === 'trading' || mode === 'playing') {
    offers.push({
      id: 'offer_1',
      offererId: 'bot_1',
      offererCard: mockCard(15, 'spades'),
      lookingFor: { rank: 14, suit: 'hearts' },
      bids: [
        { bidderId: 'bot_2', bidderCard: mockCard(14, 'clubs') }
      ]
    });
    offers.push({
      id: 'offer_2',
      offererId: 'dev_player',
      offererCard: mockCard(3, 'spades'),
      lookingFor: { rank: null, suit: null },
      bids: [
        { bidderId: 'bot_3', bidderCard: mockCard(5, 'diamonds') },
        { bidderId: 'bot_1', bidderCard: mockCard(7, 'hearts') }
      ]
    });
  }

  return { room, offers };
}

export function renderDevSandboxBar(app: HTMLElement, currentMode: string) {
  const existing = document.querySelector('.dev-sandbox-bar');
  if (existing) existing.remove();

  const bar = document.createElement('div');
  bar.className = 'dev-sandbox-bar';
  bar.innerHTML = `
    <span class="bar-title">🛠 DEV SANDBOX</span>
    <div class="bar-buttons">
      <button class="dev-btn ${currentMode === 'welcome' ? 'active' : ''}" data-mode="welcome">Welcome</button>
      <button class="dev-btn ${currentMode === 'lobby' ? 'active' : ''}" data-mode="lobby">Lobby</button>
      <button class="dev-btn ${currentMode === 'trading' ? 'active' : ''}" data-mode="trading">Trading Felt</button>
      <button class="dev-btn ${currentMode === 'playing' ? 'active' : ''}" data-mode="playing">Playing Board</button>
      <button class="dev-btn ${currentMode === 'gameover' ? 'active' : ''}" data-mode="gameover">Victory Screen</button>
      <button class="dev-btn exit-btn" data-mode="exit">Exit Dev Mode</button>
    </div>
  `;

  bar.querySelectorAll('.dev-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const mode = (e.target as HTMLElement).getAttribute('data-mode')!;
      if (mode === 'exit') {
        isDevMode = false;
        bar.remove();
        window.location.reload();
        return;
      }
      
      if (mode === 'welcome') {
        renderWelcomeScreen(
          app,
          (name) => console.log('Create room:', name),
          (name, code) => console.log('Join room:', name, code)
        );
        renderDevSandboxBar(app, 'welcome');
      } else {
        const { room, offers } = getMockRoom(mode);
        renderGameScreen(
          app,
          room,
          'dev_player',
          offers,
          (cardIds) => {
            showError(`[Dev Mode] Played: ${cardIds.join(', ')}`);
            room.lastPlay = cardIds.map(id => {
              const [rank, suit] = id.split('_');
              return mockCard(parseInt(rank), suit as Suit);
            });
            renderGameScreen(app, room, 'dev_player', offers, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
            renderDevSandboxBar(app, mode);
          },
          () => showError('[Dev Mode] Passed Turn'),
          (cardId, lookingFor) => {
            showError(`[Dev Mode] Listed card ${cardId} looking for ${JSON.stringify(lookingFor)}`);
            const cardObj = room.players[0].cards.find(c => c.id === cardId);
            if (cardObj) {
              offers.push({
                id: `offer_${Date.now()}`,
                offererId: 'dev_player',
                offererCard: cardObj,
                lookingFor,
                bids: []
              });
              room.players[0].cards = room.players[0].cards.filter(c => c.id !== cardId);
              renderGameScreen(app, room, 'dev_player', offers, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
              renderDevSandboxBar(app, mode);
            }
          },
          (offerId, cardId) => {
            showError(`[Dev Mode] Bid card ${cardId} on offer ${offerId}`);
          },
          (offerId, bidderId) => {
            showError(`[Dev Mode] Accepted bid from ${bidderId} on offer ${offerId}`);
          },
          () => {
            showError('[Dev Mode] Ready status clicked');
            room.players[0].isReady = !room.players[0].isReady;
            renderGameScreen(app, room, 'dev_player', offers, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
            renderDevSandboxBar(app, mode);
          },
          () => {
            showError('[Dev Mode] Host skip trading clicked');
          },
          () => {
            showError('[Dev Mode] Restarting game (back to lobby)');
            const { room: lobbyRoom, offers: lobbyOffers } = getMockRoom('lobby');
            renderGameScreen(app, lobbyRoom, 'dev_player', lobbyOffers, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => {});
            renderDevSandboxBar(app, 'lobby');
          },
          () => {
            showError('[Dev Mode] Cancel Trade Offer clicked');
          },
          (offerId) => {
            showError(`[Dev Mode] Cancel Bid clicked for offer ${offerId}`);
          }
        );
        renderDevSandboxBar(app, mode);
      }
    });
  });

  document.body.appendChild(bar);
}
