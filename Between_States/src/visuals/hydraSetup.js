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
    window.gate      = () => Math.max(0, Math.sin(time * 1.2));
    window.antiGate  = () => 1 - window.gate();
    window.colorCycle = () => {
      let t = (time * 0.2) % 4;
      if (t < 1)      return [1, 1, 0, 1];   // yellow
      else if (t < 2) return [1, 0, 1, 1];   // magenta
      else if (t < 3) return [0, 1, 1, 1];   // cyan
      else            return [1, 1, 1, 1];   // white
    };

    // ── Sketch (verbatim from user's patch) ──────────────────────────────────
    shape(3, 0.01, 0.5).rotate(Math.PI / 2, 0.5)
      .contrast(1.2).saturate(0)

      .color(
        () => colorCycle()[0] * Math.max(0, a.fft[0] - 0.15) * 3,
        () => colorCycle()[1] * Math.max(0, a.fft[0] - 0.15) * 3,
        () => colorCycle()[2] * Math.max(0, a.fft[0] - 0.15) * 3
      )

      .modulatePixelate(noise(3, 3).scrollY(0, 0.2), [100, 200].fast(0.2).smooth(0.4))
      .modulate(noise(6, 0.2).pixelate(80, 40), 0.05).scale(1.1)
      .sub(src(o0).scale(1.01).rotate(0.005))
      .modulate(src(o0), [0, 1].fast(0.5).smooth(0.4))

      .modulate(noise(6, 0.2).pixelate(80, 40), () => gate() * 0.05).scale(1.1)

      .scrollX(() => gate() * (a.fft[1] + a.fft[2]) * 0.02 * Math.sin(time * 5))
      .scrollY(() => gate() * (a.fft[0] + a.fft[3]) * 0.02 * Math.cos(time * 4))
      .rotate(() =>  gate() * (a.fft[4] + a.fft[2]) * 0.02)

      .out(o0);
  }
}
