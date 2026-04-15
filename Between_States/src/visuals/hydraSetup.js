/**
 * hydraSetup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Initializes the Hydra visual synthesizer and defines the generative patch
 * that responds to live audio FFT data.
 *
 * HOW HYDRA MAPS AUDIO VALUES
 * ────────────────────────────
 * Hydra evaluates parameters on every rendered frame. When a parameter is an
 * arrow function ( () => value ), Hydra calls it each tick, so passing
 * () => audioState.bass always reads the *current* bass value — no explicit
 * update loop required on our side.
 *
 * PATCH STRUCTURE (dual-buffer feedback loop)
 * ────────────────────────────────────────────
 * Two buffers reference each other, creating a self-evolving system:
 *
 *   o1  noise layer — rotating noise fed back through o0's scroll
 *   o0  feedback loop — o0 feeding into itself, modulated and layered with o1
 *
 * AUDIO → VISUAL MAPPING
 * ───────────────────────
 *   bass   → noise grain scale     Deep hits coarsen the noise texture.
 *   bass   → modulateHue amount    Low-end pulses warp the hue modulation depth.
 *
 *   mid    → noise animation speed Voice/melody accelerates noise evolution.
 *   mid    → hue shift             Mid content drifts the overall hue.
 *   mid    → o0 scroll speed       Mid energy pulls the feedback horizontally.
 *
 *   treble → rotation speed        High-frequency content spins the noise layer.
 *   treble → o1 hue offset         Treble shifts the color of the noise layer.
 *
 *   level  → saturation            Overall mic presence drives color richness.
 *   level  → gradient saturation   Overall energy saturates the layer blend.
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
   *
   * Options:
   *   detectAudio: false  — we supply our own FFT via p5; disable Hydra's
   *                          built-in Web Audio detection to avoid conflicts.
   *   makeGlobal: true    — exposes osc(), noise(), voronoi(), src(), etc.
   *                          on window so they can be called without a prefix.
   *   enableStreamCapture: false — not needed for M1; disabling saves resources.
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
   * A calm, slow-moving ambient patch that plays on the canvas *before* the
   * user grants microphone access. Gives life to the canvas even behind the
   * overlay — visible as the overlay fades out.
   *
   * No audio parameters; all values are static or time-driven.
   */
  setIdlePatch() {
    osc(3, 0.04, 0.6)
      .color(0.5, 0.2, 0.8)
      .modulateScale(noise(1.5, 0.15), 0.25)
      .modulateRotate(osc(0.8, 0.02), 0.15)
      .scale(0.9)
      .out();
  }

  /**
   * setReactivePatch(audioState, stateStore)
   * ─────────────────────────────────────────
   * Replaces the idle patch with the state-aware audio-reactive patch.
   * Called once the microphone is live (after user tap).
   *
   * Audio influence on each parameter is multiplied by a per-state intensity
   * value, read live on every Hydra render tick via arrow functions:
   *
   *   idle        0.12  — barely reactive; system is listening but quiet
   *   emergence   0.40  — audio starts shaping the visual; forms gather
   *   distortion  1.00  — full reactivity; the designed experience
   *   collapse    1.75  — parameters pushed beyond designed range; glitch territory
   *
   * At collapse, values intentionally exceed their designed ceilings — Hydra
   * wraps/clips these in ways that produce fragmentation, which aligns with
   * the spec's "structure breaks down" intention.
   *
   * Motion values are NOT scaled by state intensity — shaking destabilizes
   * the visual regardless of how quiet the audio is, per the M3 spec intent.
   *
   * @param {object}     audioState   — live reference from AudioAnalyzer.state
   * @param {StateStore} stateStore   — live reference to current system state
   * @param {object}     motionState  — live reference from MotionSensor.state
   * @param {object}     flashState   — { pixelate: 1–100 } driven by tap; decays back to 1
   * @param {object}     arState      — live reference from ARSystem.arState
   */
  setReactivePatch(audioState, stateStore, motionState, flashState, arState) {
    const STATE_INTENSITY = {
      idle:       0.12,
      emergence:  0.40,
      distortion: 1.00,
      collapse:   1.75,
    };

    // Read intensity on every tick so state changes take effect immediately.
    // faceSize boosts intensity when face is close — proximity = more aggression.
    const intensity = () =>
      STATE_INTENSITY[stateStore.current] * (1 + arState.faceSize * 0.6);

    // ── Buffer o1: noise layer ───────────────────────────────────────────────
    // A rotating noise field that feeds back through o0's scroll.
    // Acts as both an independent texture and a modulation source for o0.
    //
    // Motion contributions are additive and unscaled by state intensity —
    // shaking destabilizes the visual regardless of audio state.
    noise(
      () => 1   + audioState.bass   * 2   * intensity()
                + motionState.energy * 3,                // energy → coarser grain (distortion)
      () => 0.2 + audioState.mid    * 0.3                // mid    → noise speed (always animates)
    )
      .rotate(
        2,
        () => 0.5 + audioState.treble  * 1.5 * intensity()
                  + motionState.tilt   * 2              // tilt        → spin accelerates as device flattens
                  + arState.headTilt   * 0.3            // headTilt    → spin direction follows head angle
      )
      .layer(
        src(o0).scrollX(
          () => 0.2 + audioState.mid    * 0.3 * intensity()
                    + motionState.energy * 0.4           // energy → horizontal displacement
        )
      )

      // ── Tilt: perpendicular → parallel ──────────────────────────────────
      // Both ops scale from zero when upright (tilt=0) to full when flat (tilt=1).
      // modulateRotate warps the noise field rotationally using a circular mask;
      // rotate adds a continuous spin whose speed grows with tilt amount.
      .modulateRotate(
        shape(999, 0.3, 0.5),
        () => motionState.tilt * 1.57                   // tilt → rotational displacement
      )
      .rotate(
        0,
        () => motionState.tilt * 0.1                    // tilt → continuous spin speed
      )

      // ── Shake: kaleidoscope on acceleration ──────────────────────────────
      // kaleid(1) is a passthrough — no effect when still.
      // When shake energy crosses the threshold, cycles through the same
      // sequence as [1,2,4,8,3,1,2,6,4].fast(2).smooth(.4) using `time`
      // to step through values at 2 Hz, matching the original array speed.
      .kaleid(() => {
        if (motionState.energy < 0.15) return 1;
        const seq = [1, 2, 4, 8, 3, 1, 2, 6, 4];
        return seq[Math.floor(time * 2) % seq.length];
      })

      // ── Tap flash: pixelate burst ────────────────────────────────────────
      // Hydra's pixelate(x, y) is number of divisions, NOT block size:
      //   high value (400) = 400 fine divisions = invisible
      //   low value  (4)   = 4 large blocks     = strong pixelation
      //
      // We invert flashState.pixelate (1–100) so the user-facing value
      // behaves intuitively: 100 = strongest effect, 1 = no effect.
      //   flashState=100 → 400/100 = 4   divisions (big chunky blocks)
      //   flashState=10  → 400/10  = 40  divisions (medium blocks, mid-decay)
      //   flashState=1   → 400/1   = 400 divisions (invisible, at rest)
      .pixelate(
        () => Math.max(1, Math.round(400 / flashState.pixelate)),
        () => Math.max(1, Math.round(400 / flashState.pixelate))
      )
      .out(o1);
    // ── Buffer o0: feedback loop ─────────────────────────────────────────────
    // o0 feeds into itself — each frame is a transformation of the last.
    // The slow scale (.999) and slight brightness (1.01) cause the image to
    // gradually breathe inward while brightening, prevented from collapsing
    // by the o1 layer injection at the bottom.
    //
    // At collapse (intensity=1.75), saturation and modulateHue exceed their
    // designed ceilings — Hydra wraps these into blown-out color fragmentation.
    src(o0)
      .saturate(() => 1.01 + audioState.level  * 0.4  * intensity()) // level     → color richness
      .scale(   () => 0.999 - audioState.bass  * 0.008 * intensity()) // bass      → subtle inward pulse
      .color(1.01, 1.01, 1.01)                                         // fixed slight brighten each frame
      .hue(     () => 0.01  + audioState.mid   * 0.04  * intensity()) // mid       → hue drift

      // ── Face position: visual follows the face ───────────────────────────
      // faceX/faceY are 0–1 normalised. We map them to a small scroll offset
      // so the feedback loop drifts toward wherever the face is in frame.
      // Remapped to −0.1…+0.1 range so the effect is subtle but perceptible.
      .scrollX(() => (arState.faceX - 0.5) * 0.2)  // faceX → horizontal drift
      .scrollY(() => (arState.faceY - 0.5) * 0.2)  // faceY → vertical drift

      .modulateHue(
        src(o1)
          .hue(     () => 0.3 + audioState.treble * 0.4 * intensity()) // treble    → o1 hue offset
          .posterize(-1)
          .contrast(0.7),
        // mouth open directly drives warp depth — speaking warps colour
        () => 2 + audioState.bass    * 3   * intensity()
                + motionState.energy * 4
                + arState.mouthOpen  * 6                               // mouthOpen → colour warp
      )
      .layer(
        src(o1)
          .luma()
          .mult(
            gradient(1).saturate(() => 0.9 + audioState.level * 0.5 * intensity()) // level → blend saturation
          )
      )
      .out(o0);

    render(o0);
  }
}
