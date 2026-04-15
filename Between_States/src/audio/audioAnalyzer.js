/**
 * audioAnalyzer.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Captures live microphone input and performs FFT (Fast Fourier Transform)
 * frequency analysis using p5.js and p5.sound.
 *
 * HOW FFT WORKS HERE
 * ──────────────────
 * FFT decomposes an audio signal into its constituent frequency components.
 * p5.FFT continuously samples the mic stream and builds a frequency spectrum
 * array (1024 bins from ~20 Hz to 20 kHz). We then query named sub-ranges:
 *
 *   'bass'   → ~20–300 Hz    (kick drum, bass guitar, body resonance)
 *   'mid'    → ~300–2000 Hz  (voice, snare, most melodic content)
 *   'treble' → ~2000–20000 Hz (air, sibilance, cymbal shimmer)
 *
 * getEnergy() returns a value 0–255; we normalize to 0–1 before exposing it.
 *
 * The FFT smoothing parameter (0–1) controls temporal averaging:
 *   0 = no smoothing (instantaneous, jittery)
 *   1 = maximum smoothing (very slow response)
 * We use 0.8 to keep movement fluid without losing rhythmic punch.
 *
 * USAGE
 * ──────
 * const analyzer = new AudioAnalyzer();
 * await analyzer.init();          // call after a user gesture
 * analyzer.state.bass             // live 0–1 values, read each frame
 */

// p5 and p5.sound are loaded via CDN script tags in index.html — no import needed.
/* global p5 */

export class AudioAnalyzer {
  /**
   * @param {function|null} onUpdate  — optional callback fired every draw() frame
   *   with the latest audioState. Used by StateMachine to evaluate transitions
   *   on the same tick that audio values are updated.
   */
  constructor(onUpdate = null) {
    this._onUpdate = onUpdate;

    /**
     * state — the shared live audio data object.
     *
     * This is a plain object (not a copy) so that any module holding a
     * reference to it always sees the latest values without polling.
     * HydraSetup reads this object via arrow functions that are evaluated
     * on every Hydra render tick.
     */
    this.state = {
      bass: 0,    // normalized low-frequency energy  (0–1)
      mid: 0,     // normalized mid-frequency energy  (0–1)
      treble: 0,  // normalized high-frequency energy (0–1)
      level: 0,   // overall microphone amplitude     (0–1)
    };

    this._p5Instance = null;
    this._mic = null;
    this._fft = null;
  }

  /**
   * init()
   * ──────
   * Initializes the p5.js sketch in instance mode (no canvas — audio only),
   * creates the microphone input, sets up the FFT analyzer, and starts
   * the analysis loop.
   *
   * MUST be called inside a user-gesture handler (click / touchend).
   * Mobile browsers require a user gesture before the Web Audio API can
   * create or resume an AudioContext.
   *
   * Returns a Promise that resolves once the microphone is live.
   */
  init() {
    return new Promise((resolve, reject) => {
      // p5 instance mode: pass a sketch function instead of running globally.
      // This prevents p5 from polluting the global namespace and avoids
      // conflicts with Hydra's own globals.
      this._p5Instance = new p5((p) => {
        p.setup = () => {
          // No canvas needed — we only want the audio pipeline.
          p.noCanvas();

          // p5.AudioIn wraps getUserMedia to stream mic input into the
          // Web Audio graph. p5.sound attaches AudioIn/FFT to the p5
          // constructor, so we access them as p5.AudioIn (not p.AudioIn).
          this._mic = new p5.AudioIn();

          // p5.FFT(smoothing, bins)
          //   smoothing 0.8 → 80% weighted average with previous frame
          //   1024 bins    → fine frequency resolution across the spectrum
          this._fft = new p5.FFT(0.8, 1024);

          // Route the mic signal into the FFT analyzer.
          this._fft.setInput(this._mic);

          // Start the microphone. On mobile this triggers the browser
          // permission dialog. The success callback fires once the stream
          // is active; the error callback fires if the user denies access.
          this._mic.start(
            () => resolve(),
            (err) => reject(err)
          );
        };

        /**
         * p.draw() runs on every animation frame (~60 fps).
         * This is our analysis loop — it updates this.state continuously
         * so Hydra always has fresh values when it renders its next frame.
         */
        p.draw = () => {
          if (!this._fft || !this._mic) return;

          // analyze() populates the internal spectrum array.
          // It MUST be called before any getEnergy() call.
          this._fft.analyze();

          // getEnergy(band) returns 0–255; divide by 255 to normalize to 0–1.
          this.state.bass   = this._fft.getEnergy('bass')   / 255;
          this.state.mid    = this._fft.getEnergy('mid')    / 255;
          this.state.treble = this._fft.getEnergy('treble') / 255;

          // getLevel() already returns 0–1 (RMS amplitude of the mic stream).
          this.state.level  = this._mic.getLevel();

          // Notify any observer (e.g. StateMachine) with the freshly updated state.
          if (this._onUpdate) this._onUpdate(this.state);
        };
      });
    });
  }
}
