/**
 * main.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Entry point for Between States — Milestone 2.
 *
 * Boot sequence:
 *   1. HydraSetup.init()         — create Hydra renderer on the canvas
 *   2. HydraSetup.setIdlePatch() — start ambient visual before mic is live
 *   3. StateStore + StateMachine — create shared state container and machine
 *   4. AudioAnalyzer             — created with stateMachine.update as onUpdate
 *                                   callback; state evaluated every draw() tick
 *   5. App.init()                — attach tap listener to the overlay
 *
 * After the user taps:
 *   6. AudioAnalyzer.init()            — start mic + FFT (inside gesture)
 *   7. HydraSetup.setReactivePatch()   — switch to state-aware audio-reactive patch
 *   8. Overlay fades out               — experience begins
 *
 * Loops:
 *   - p5 draw() updates audioState + calls stateMachine.update() ~60 fps
 *   - Hydra reads audioState and stateStore via () => functions each render tick
 * No manual synchronization is needed between the loops.
 */

import { AudioAnalyzer } from './audio/audioAnalyzer.js';
import { HydraSetup }    from './visuals/hydraSetup.js';
import { ThreeSetup }    from './visuals/threeSetup.js';
import { App }           from './app/app.js';
import { StateStore }    from './state/stateStore.js';
import { StateMachine }  from './state/stateMachine.js';
import { MotionSensor }  from './motion/motionSensor.js';
import { ARSystem }      from './ar/arSystem.js';

try {
  // ── 1. Initialize Hydra ────────────────────────────────────────────────────
  const hydraSetup = new HydraSetup('hydra-canvas');
  hydraSetup.init();

  // ── 2. Start the idle visual ───────────────────────────────────────────────
  hydraSetup.setIdlePatch();

  // ── 3. State system ────────────────────────────────────────────────────────
  // stateStore holds the current state string (read by HydraSetup on every tick).
  // stateMachine evaluates audio levels and writes to stateStore.current.
  const stateStore   = new StateStore();
  const stateMachine = new StateMachine(stateStore);

  // ── 4. Audio analyzer ─────────────────────────────────────────────────────
  // onUpdate fires each draw() frame — keeps state evaluation in sync with audio.
  const audioAnalyzer = new AudioAnalyzer(
    (audioState) => stateMachine.update(audioState, arSystem.arState)
  );

  // ── 5. Motion sensor ──────────────────────────────────────────────────────
  // Created here but not started yet — init() requires a user gesture (iOS).
  // app.js calls motionSensor.init() inside the same tap handler as the mic.
  const motionSensor = new MotionSensor();

  // ── 6. AR system ──────────────────────────────────────────────────────────
  // Created here but not started yet — camera permission requires a user
  // gesture. app.js calls arSystem.init() inside the same tap handler.
  const arSystem = new ARSystem();

  // ── 7. Three.js 3D object layer ───────────────────────────────────────────
  // Sits on #three-canvas at z-index 1 (above camera, below Hydra).
  // loadModel() fetches the GLB immediately; the object stays hidden until
  // a face is detected. start() is called in app.js after AR init.
  const threeSetup = new ThreeSetup('three-canvas');
  threeSetup.init();
  threeSetup.loadModel('/model.glb');  // opacity is now audio-driven, not static

  // ── 8. Wire up the app ────────────────────────────────────────────────────
  const app = new App(audioAnalyzer, hydraSetup, stateStore, motionSensor, arSystem, threeSetup);
  app.init();

} catch (err) {
  // Surface any load-time crash in the overlay so it's visible on mobile
  // (where there's no easy way to open DevTools).
  console.error('[Between States] Boot error:', err);
  const errorEl = document.getElementById('error-msg');
  if (errorEl) {
    errorEl.textContent = `load error: ${err.message ?? err}`;
    errorEl.style.display = 'block';
  }
}
