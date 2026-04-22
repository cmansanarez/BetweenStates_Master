/**
 * toneEngine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Web Audio API drone synthesizer that plays a continuous ambient tone whose
 * frequency and gain shift to match the system state.
 *
 * Two detuned sine oscillators are mixed together for a slightly thick,
 * beating quality. Frequency changes use setTargetAtTime for smooth glides.
 *
 * USAGE
 * ──────
 * const tone = new ToneEngine();
 * tone.init(optionalExistingAudioContext);   // call inside a user gesture
 * tone.setState('distortion');               // call on every state change
 *
 * FREQUENCY MAP
 * ─────────────
 *   idle       → A2  (110 Hz)  — low, latent
 *   emergence  → C#3 (138.6)  — rising tension
 *   distortion → F3  (174.6)  — dissonant peak
 *   collapse   → A1  (87 Hz)  — sub-bass drop
 *
 * AUDIO CONTEXT SHARING
 * ──────────────────────
 * Pass p5's AudioContext via getAudioContext() so we don't create a second
 * context — iOS Safari limits the number of concurrent AudioContexts.
 * Falls back to a new AudioContext if none is provided.
 */

export class ToneEngine {
  constructor() {
    this._ctx        = null;
    this._osc1       = null;
    this._osc2       = null;
    this._masterGain = null;
    this._started    = false;
  }

  /**
   * init(existingCtx)
   * ──────────────────
   * Creates the oscillators and connects them to the audio graph.
   * Must be called inside a user-gesture handler for iOS compatibility.
   *
   * @param {AudioContext|null} existingCtx  — reuse p5's context if available
   */
  init(existingCtx = null) {
    try {
      this._ctx = existingCtx ?? new AudioContext();
    } catch (err) {
      console.warn('[Tone] AudioContext unavailable:', err.message);
      return;
    }

    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.value = 0;
    this._masterGain.connect(this._ctx.destination);

    // Two oscillators detuned slightly — creates a slow beating / chorus effect
    this._osc1 = this._ctx.createOscillator();
    this._osc1.type = 'sine';
    this._osc1.frequency.value = 110;

    this._osc2 = this._ctx.createOscillator();
    this._osc2.type = 'sine';
    this._osc2.frequency.value = 110.7;   // 0.7 Hz detune for beat frequency

    const g1 = this._ctx.createGain();
    const g2 = this._ctx.createGain();
    g1.gain.value = 0.55;
    g2.gain.value = 0.45;

    this._osc1.connect(g1);
    this._osc2.connect(g2);
    g1.connect(this._masterGain);
    g2.connect(this._masterGain);

    this._osc1.start();
    this._osc2.start();

    // Fade in gently over 2 s so the drone enters beneath the experience
    this._masterGain.gain.setTargetAtTime(0.028, this._ctx.currentTime, 2.0);
    this._started = true;

    console.log('[Tone] Engine started');
  }

  /**
   * setState(state)
   * ────────────────
   * Glides the drone pitch and gain to values matching the new system state.
   * Uses setTargetAtTime (exponential curve) for natural-sounding transitions.
   *
   * @param {'idle'|'emergence'|'distortion'|'collapse'} state
   */
  setState(state) {
    if (!this._started || !this._ctx) return;

    const now = this._ctx.currentTime;

    const FREQ = {
      idle:       110,    // A2
      emergence:  138.6,  // C#3
      distortion: 174.6,  // F3
      collapse:   87,     // A1 — sub-bass drop on peak state
    };
    const GAIN = {
      idle:       0.022,
      emergence:  0.038,
      distortion: 0.055,
      collapse:   0.075,
    };

    const freq = FREQ[state] ?? 110;
    const gain = GAIN[state] ?? 0.022;

    // time-constant 0.7 s — smooth enough to feel intentional, fast enough to track state
    this._osc1.frequency.setTargetAtTime(freq,       now, 0.7);
    this._osc2.frequency.setTargetAtTime(freq + 0.7, now, 0.7);
    this._masterGain.gain.setTargetAtTime(gain,      now, 0.35);
  }
}
