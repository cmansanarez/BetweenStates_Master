/**
 * hydraSetup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Initializes the Hydra visual synthesizer.
 *
 * Audio is handled by Hydra's own built-in analyzer (detectAudio: true).
 * The `a` global provides a.fft[0–5] (6 bins), smoothed and scaled via
 * a.setSmooth / a.setCutoff / a.setScale / a.setBins.
 *
 * p5.js AudioAnalyzer continues to run in parallel for the state machine —
 * both analyzers read the same mic input independently.
 */

// Hydra is loaded via CDN script tag in index.html — no import needed.
/* global Hydra */

export class HydraSetup {
  /**
   * @param {string} canvasId  — id of the <canvas> element in index.html
   */
  constructor(canvasId) {
    this._canvas = document.getElementById(canvasId);
    this._hydra  = null;
  }

  /**
   * init()
   * ──────
   * Creates the Hydra instance bound to our full-screen canvas.
   * detectAudio: true — Hydra manages its own mic capture for a.fft.
   * makeGlobal: true  — exposes osc(), shape(), noise(), src(), etc. on window.
   */
  init() {
    this._hydra = new Hydra({
      canvas:              this._canvas,
      detectAudio:         true,
      makeGlobal:          true,
      enableStreamCapture: false,
    });
  }

  /**
   * setIdlePatch()
   * ──────────────
   * Simple ambient patch before mic access is granted.
   * No a.fft references — time-driven only.
   */
  setIdlePatch() {
    osc(6, 0.04, 0.8)
      .color(0.267, 1.0, 0.82)  // aqua #44FFD1
      .rotate(Math.PI / 2)
      .scale(0.95)
      .out();
  }

  /**
   * setReactivePatch()
   * ───────────────────
   * Audio-reactive patch using Hydra's native a.fft analyzer (6 bins).
   * Parameters from audioState / stateStore are accepted for API compatibility
   * but this patch drives itself directly from a.fft.
   */
  setReactivePatch(audioState, stateStore, motionState, flashState, arState) {
    // ── Audio settings ──────────────────────────────────────────────────────
    a.setSmooth(0.9);
    a.setCutoff(-1);
    a.setScale(10);
    a.setBins(6);

    // ── Constants — assigned on window so Hydra arrow functions can reach them
    // ES modules run in strict mode; bare assignments like `gate = () => …`
    // throw ReferenceError. window.* makes them true globals like Hydra expects.
    window.gate     = () => Math.max(0, Math.sin(time * 1.2));
    window.antiGate = () => 1 - window.gate();

    // ── Color cycle (time-driven, ~20 s full loop) ──────────────────────────
    window.colorCycle = () => {
      let t = (time * 0.2) % 4;
      if (t < 1)      return [1, 1, 0, 1];   // yellow
      else if (t < 2) return [1, 0, 1, 1];   // magenta
      else if (t < 3) return [0, 1, 1, 1];   // cyan
      else            return [1, 1, 1, 1];   // white
    };

    shape(3, 0.01, 0.5).rotate(Math.PI / 2, 0.5)
      .contrast(1.2).saturate(0)

      .color(
        () => colorCycle()[0] * Math.max(0, a.fft[0] - 0.15) * 3,
        () => colorCycle()[1] * Math.max(0, a.fft[0] - 0.15) * 3,
        () => colorCycle()[2] * Math.max(0, a.fft[0] - 0.15) * 3
      )

      // Modulation options
      .modulatePixelate(noise(3, 3).scrollY(0, 0.2), [100, 200].fast(0.2).smooth(0.4))
      .modulate(noise(6, 0.2).pixelate(80, 40), 0.05).scale(1.1)
      .sub(src(o0).scale(1.01).rotate(0.005))
      .modulate(src(o0), [0, 1].fast(0.5).smooth(0.4))

      // Gated modulation
      .modulate(noise(6, 0.2).pixelate(80, 40), () => gate() * 0.05).scale(1.1)

      // Shake
      .scrollX(() => gate() * (a.fft[1] + a.fft[2]) * 0.02 * Math.sin(time * 5))
      .scrollY(() => gate() * (a.fft[0] + a.fft[3]) * 0.02 * Math.cos(time * 4))
      .rotate(() =>  gate() * (a.fft[4] + a.fft[2]) * 0.02)

      .out(o0);
  }
}
