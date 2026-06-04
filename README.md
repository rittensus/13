# 🎴 Tiến Lên Classic - Multiplayer Card Game

An elegant, modern, and lightweight multiplayer-compatible web version of the classic Vietnamese card game **Tiến Lên (Thirteen)**. Built with Vite, TypeScript, and Vanilla CSS, featuring pre-game card bartering, real-time Socket.io coordination, and synthetically generated procedural sound effects.

---

## ✨ Features

- **Pre-Game Card Market**: Barter cards before each round to optimize your hand. Set filters for ranks or suits you are looking for. AI players automatically evaluate listings and bid utility-based cards.
- **Procedural Synthesizer Audio**: Real-time card deals, table taps, game chimes, clicks, and error buzzes generated directly on the client using the Web Audio API (zero audio files to download, keeping loading times ultra-fast).
- **Interactive Dev Sandbox Mode**: Built-in developer menu allows you to view and check all interfaces (Lobby, Trading Felt, Playing Board, and Victory screen) instantly with mock data.
- **Docker Ready**: Multi-stage lightweight Docker image (~20MB running on Node Alpine) and Docker Compose configuration.
- **Automated CI/CD**: Pre-configured GitHub Actions workflow to build and push images to GitHub Container Registry (GHCR).

---

## 🃏 Game Rules (Tiến Lên / Thirteen)

1. **Card Hierarchy**: 
   - Rank: `3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2` (3 is lowest, 2 is highest).
   - Suit: `Spades ♠ < Clubs ♣ < Diamonds ♦ < Hearts ♥` (Spades is lowest, Hearts is highest).
   - The lowest card is `3♠`, the highest card is `2♥`.
2. **Valid Combos**:
   - **Single (Rác)**: One card.
   - **Pair (Đôi)**: Two cards of the same rank.
   - **Triple (Sám cô)**: Three cards of the same rank.
   - **Sequence (Sảnh)**: Three or more cards in consecutive rank order (e.g., `4-5-6`). *Note: 2s cannot be part of sequences.*
   - **Bombs**:
     - *Three consecutive pairs*: e.g., `3-3, 4-4, 5-5`. Can beat a single 2.
     - *Four of a kind*: e.g., `J-J-J-J`. Can beat a single 2, a pair of 2s, or three consecutive pairs.
     - *Four consecutive pairs*: e.g., `3-3, 4-4, 5-5, 6-6`. Can beat any single 2, pair of 2s, three consecutive pairs, or four of a kind, and can be played out of turn.
3. **Gameplay**:
   - Play proceeds clockwise. Each player must play a higher combination of the same type or pass.
   - Passing blocks you from playing until the current round resets (when all other players pass).
   - First player to empty their hand wins.

---

## 🛠️ Getting Started

### Prerequisites

- Node.js (v20 or higher)
- npm (v10 or higher)

### Installation & Local Run

1. Clone the repository and navigate to the folder:
   ```bash
   git clone <your-repository-url>
   cd noble-raman
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the hot-reloading development server (starts client on port `5173` proxying socket connections to the backend on `3000`):
   ```bash
   npm run dev
   ```
4. Build the application for production:
   ```bash
   npm run build
   ```
5. Start the production build:
   ```bash
   npm start
   ```
   Open `http://localhost:3000` in your browser.

---

## 🐳 Docker Deployment

### Docker Compose (Recommended)

Running with Docker Compose builds the app locally or pulls the container and sets it up in detached mode:

1. Launch using Docker Compose:
   ```bash
   docker compose up -d
   ```
2. Check logs:
   ```bash
   docker compose logs -f
   ```
3. Stop the container:
   ```bash
   docker compose down
   ```

### Docker Manual Build

1. Build the Docker image:
   ```bash
   docker build -t classic-tienlen .
   ```
2. Run the container:
   ```bash
   docker run -d -p 3000:3000 --name tienlen-game classic-tienlen
   ```
3. Stop the container:
   ```bash
   docker stop tienlen-game
   docker rm tienlen-game
   ```

---

## 🚀 GitHub Actions CI/CD Pipeline

The project includes an automated GitHub Actions workflow inside `.github/workflows/docker-build.yml`. On every push to the `master` or `main` branches, it will:
1. Check out the source code.
2. Build the Docker image using multi-stage layers.
3. Authenticate and push the compiled image automatically to the **GitHub Container Registry (GHCR)** at `ghcr.io/<username>/<repo-name>:latest`.
