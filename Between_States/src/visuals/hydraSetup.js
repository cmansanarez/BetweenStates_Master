/**
 * hydraSetup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Initializes the Hydra visual synthesizer.
 *
 * detectAudio: false — Hydra does NOT request the mic on page load.
 * Instead, setReactivePatch() installs a window.a shim whose .fft array is a
 * Proxy over our p5.js audioState. Every time the Hydra sketch reads a.fft[n]
 * it gets the current live value with no extra capture or permission dialog.
 *
 * Bin mapping (audioState → a.fft):
 *   fft[0] = bass          fft[1] = (bass + mid) / 2
 *   fft[2] = mid           fft[3] = (mid + treble) / 2
 *   fft[4] = treble        fft[5] = level
 */

// Hydra is loaded via CDN script tag in index.html — no import needed.
/* global Hydra */

export class HydraSetup {
  constructor(canvasId) {
    this._canvas = document.getElementById(canvasId);
    this._hydra  = null;
  }

  /**
   * init()
   * ──────
   * detectAudio: false keeps Hydra from calling getUserMedia before the user
   * taps. The a.fft shim installed in setReactivePatch() provides the data.
   */
  init() {
    this._hydra = new Hydra({
      canvas:              this._canvas,
      detectAudio:         false,
      makeGlobal:          true,
      enableStreamCapture: false,
    });
  }

  /**
   * setIdlePatch()
   * ──────────────
   * Simple ambient osc patch before mic access is granted. No a.fft refs.
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
   * Installs a window.a shim that mirrors Hydra's audio API, then runs the
   * sketch. Called after the user gesture so audioState is live.
   *
   * The shim's .fft property is a Proxy: reading a.fft[n] evaluates the
   * current audioState value at that moment — no polling loop needed.
   * a.setSmooth / setCutoff / setScale / setBins are accepted but no-ops
   * since smoothing is already handled by p5's AudioIn.
   */
  setReactivePatch(audioState, stateStore, motionState, flashState, arState) {
    // ── a.fft shim — maps our 4-band audioState to 6 Hydra-style bins ──────
    const bins = [
      () => audioState.bass,
      () => (audioState.bass  + audioState.mid)    / 2,
      () => audioState.mid,
      () => (audioState.mid   + audioState.treble)  / 2,
      () => audioState.treble,
      () => audioState.level,
    ];

    window.a = {
      fft: new Proxy([], {
        get(_, prop) {
          const i = parseInt(prop);
          return isNaN(i) ? undefined : (bins[i]?.() ?? 0);
        },
      }),
      setSmooth: () => {},
      setCutoff: () => {},
      setScale:  () => {},
      setBins:   () => {},
      show:      () => {},
      hide:      () => {},
    };

    // ── Sketch globals on window (ES modules are strict — no bare assignment) ─

    // gate: audio-driven with a time-based floor — always some movement,
    // dramatically more with loud audio. Replaces the old time-only sine gate.
    window.gate = () => Math.max(a.fft[5] * 1.8, Math.abs(Math.sin(time * 0.9)) * 0.18);

    // stateColor: maps current state to the project's 4-color palette.
    // Evaluated by Hydra on every render tick via closure over stateStore.
    // Replaces colorCycle() so hue reacts to state, not arbitrary time cycling.
    window.stateColor = () => {
      const s = stateStore.current ?? 'idle';
      if (s === 'emergence')  return [0.188, 0.31,  1.0];    // blue   #304FFE
      if (s === 'distortion') return [1.0,   0.114, 0.537];  // pink   #FF1D89
      if (s === 'collapse')   return [1.0,   0.925, 0.0];    // yellow #FFEC00
      return [0.267, 1.0, 0.82];                             // aqua   #44FFD1
    };

    // ── Reactive patch ───────────────────────────────────────────────────────
    shape(3, 0.01, 0.5).rotate(Math.PI / 2, 0.5)
      .contrast(() => 1.1 + a.fft[0] * 2.5)        // bass pumps contrast hard
      .saturate(() => 0.5 + a.fft[2] * 4.0)        // mids saturate the image

      // State hue × audio level — no dead zone, kicks in immediately
      .color(
        () => stateColor()[0] * (0.35 + a.fft[0] * 2.8),
        () => stateColor()[1] * (0.35 + a.fft[0] * 2.8),
        () => stateColor()[2] * (0.35 + a.fft[0] * 2.8)
      )

      // Pixelate: tap flash → big blocks; otherwise audio drives glitch size
      // quiet = fine grain (6px), loud = coarse glitch blocks (up to 146px)
      .modulatePixelate(
        noise(3, 3).scrollY(0, 0.2),
        () => flashState.pixelate > 2 ? flashState.pixelate : 6 + a.fft[5] * 140
      )
      // Warp amount is now audio-driven (was a fixed 0.05)
      .modulate(noise(6, 0.2).pixelate(80, 40), () => 0.02 + a.fft[5] * 0.22)
      .scale(() => 1.03 + a.fft[0] * 0.28)          // bass inflates the form
      .sub(src(o0).scale(1.01).rotate(0.005))
      .modulate(src(o0), [0, 1].fast(0.5).smooth(0.4))

      // Louder = significantly brighter overall output
      .brightness(() => -0.05 + a.fft[5] * 0.45)

      // Scroll/rotate multipliers raised 0.02 → 0.10; gate is now audio-driven
      .scrollX(() => gate() * (a.fft[1] + a.fft[2]) * 0.10 * Math.sin(time * 5))
      .scrollY(() => gate() * (a.fft[0] + a.fft[3]) * 0.10 * Math.cos(time * 4))
      .rotate(() => (a.fft[4] + a.fft[2]) * 0.08)

      .out(o0);
  }
}
