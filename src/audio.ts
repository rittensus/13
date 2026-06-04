// Web Audio API Procedural Synthesizer for card sounds
// Keeps loading size extremely lite with zero static audio files.

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// 1. Wood Tap Sound (Card placed on table)
export function playCardTap() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(120, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.08);

  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.08);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.08);
}

// 2. Paper Slide Sound (Card dealt or drawn)
export function playCardSlide() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const bufferSize = ctx.sampleRate * 0.15; // 0.15 seconds
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  // Generate white noise
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  // Filter white noise to make it sound like paper rustle
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1000, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.15);
  filter.Q.setValueAtTime(2, ctx.currentTime);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.08, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start();
  noise.stop(ctx.currentTime + 0.15);
}

// 3. UI Click Sound (Lobby clicks)
export function playClick() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.05);

  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.05);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.05);
}

// 4. Success/Chime Sound (Trade confirmed or starting play)
export function playChime() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const playNote = (freq: number, delay: number, dur: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + delay);

    gain.gain.setValueAtTime(0, now + delay);
    gain.gain.linearRampToValueAtTime(0.12, now + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + delay);
    osc.stop(now + delay + dur);
  };

  // Play a quick pleasant arpeggio (C major pentatonic style)
  playNote(523.25, 0, 0.3);      // C5
  playNote(659.25, 0.05, 0.3);   // E5
  playNote(783.99, 0.10, 0.3);   // G5
  playNote(1046.50, 0.15, 0.4);  // C6
}

// 5. Error Buzz / Pass Sound (Invalid play or pass)
export function playBuzz() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(130, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(90, ctx.currentTime + 0.2);

  gain.gain.setValueAtTime(0.1, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.2);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(300, ctx.currentTime);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.2);
}

// 6. Resume Audio Context (Autoplay workaround)
export function resumeAudio() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume();
  }
}

// 7. Quiet soft tap when selecting a card in hand
export function playCardSelect() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.03);

  gain.gain.setValueAtTime(0.04, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.03);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.03);
}

// 8. Triumphant Major Arpeggio Fanfare when winning the game
export function playVictoryFanfare() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const playNote = (freq: number, delay: number, dur: number, vol = 0.08) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + delay);

    gain.gain.setValueAtTime(0, now + delay);
    gain.gain.linearRampToValueAtTime(vol, now + delay + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now + delay);
    osc.stop(now + delay + dur);
  };

  playNote(261.63, 0, 0.4);      // C4
  playNote(329.63, 0.08, 0.4);   // E4
  playNote(392.00, 0.16, 0.4);   // G4
  playNote(523.25, 0.24, 0.5);   // C5
  playNote(659.25, 0.36, 0.5);   // E5
  playNote(783.99, 0.48, 0.7);   // G5
  playNote(1046.50, 0.60, 1.2, 0.12); // C6
}
