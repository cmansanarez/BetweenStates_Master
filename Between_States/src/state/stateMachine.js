/**
 * stateMachine.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Evaluates live audio levels against thresholds and drives state transitions
 * in StateStore. Called once per animation frame from AudioAnalyzer's draw loop.
 *
 * THRESHOLD DESIGN
 * ────────────────
 * Two thresholds per state boundary create a hysteresis band:
 *
 *   THRESHOLD_UP   — audio level required to enter a higher state
 *   THRESHOLD_DOWN — audio level required to remain in that state
 *                    (lower than UP, preventing flicker near the boundary)
 *
 * Example: distortion ↔ collapse boundary
 *   Entering collapse:  level must reach  0.65  (THRESHOLD_UP)
 *   Leaving collapse:   level must drop below 0.55  (THRESHOLD_DOWN)
 *   If level sits at 0.60, we stay in whichever state we're already in.
 *
 * HOLD-FRAME HYSTERESIS
 * ─────────────────────
 * Even with separate UP/DOWN thresholds, a rapidly fluctuating mic signal
 * could still cause rapid state switching. A hold-frame counter adds a second
 * layer: the target state must be consistently indicated for N frames before
 * the transition commits.
 *
 *   HOLD_UP   — frames required to escalate (~0.33 s at 60 fps)
 *   HOLD_DOWN — frames required to de-escalate (~1.5 s at 60 fps)
 *               Longer downward hold keeps states from dropping during
 *               brief silences within an active passage.
 */

import { STATES } from './stateStore.js';

// ── Thresholds ───────────────────────────────────────────────────────────────
// Keyed by the state being entered or maintained.
// audioState.level is 0–1 (RMS amplitude from p5.AudioIn).

// Tuned for demo/classroom environments (quieter than live festival).
// EMERGENCE threshold raised from 0.06→0.10 to prevent false triggers from
// ambient hum while still catching voice and clapping easily.
// DISTORTION/COLLAPSE unchanged — still require intentional loud input.
// HOLD_UP reduced 20→15 for snappier demo escalation (~0.25 s at 60 fps).
const THRESHOLD_UP = {
  [STATES.EMERGENCE]:  0.10,  // was 0.06 — raised for quieter demo rooms
  [STATES.DISTORTION]: 0.25,
  [STATES.COLLAPSE]:   0.65,
};

const THRESHOLD_DOWN = {
  [STATES.EMERGENCE]:  0.07,  // was 0.04 — paired raise for hysteresis band
  [STATES.DISTORTION]: 0.18,
  [STATES.COLLAPSE]:   0.55,
};

// ── Hold-frame counts ────────────────────────────────────────────────────────
const HOLD_UP   = 15;   // ~0.25 s to escalate (was 20 — snappier for demo)
const HOLD_DOWN = 90;   // ~1.5 s to de-escalate

const STATE_ORDER = [STATES.IDLE, STATES.EMERGENCE, STATES.DISTORTION, STATES.COLLAPSE];

export class StateMachine {
  /**
   * @param {StateStore} stateStore — shared state container; this class writes to it
   */
  constructor(stateStore) {
    this._store        = stateStore;
    this._holdCounter  = 0;
    this._pendingState = null;
  }

  /**
   * update(audioState, arState)
   * ───────────────────────────
   * Called every animation frame from AudioAnalyzer's draw loop.
   * Resolves the desired target state from audio level, applies the AR face
   * detection floor, then applies hold-frame hysteresis before committing.
   *
   * Face detection floor: when a face is detected, the state cannot drop
   * below 'emergence' regardless of audio level — face presence keeps the
   * system alive even in silence. Face lost → state decays normally.
   *
   * @param {{ level: number, bass: number, mid: number, treble: number }} audioState
   * @param {{ faceDetected: boolean }|null} arState
   */
  update(audioState, arState = null) {
    const level   = audioState.level;
    const current = this._store.current;

    // Resolve audio-based target, then apply face detection floor.
    const audioTarget = this._resolveTarget(level, current);
    const faceFloor   = arState?.faceDetected ? STATES.EMERGENCE : STATES.IDLE;
    const target      = STATE_ORDER.indexOf(audioTarget) >= STATE_ORDER.indexOf(faceFloor)
      ? audioTarget
      : faceFloor;

    if (target === current) {
      // Already in the right state — reset any pending transition
      this._holdCounter  = 0;
      this._pendingState = null;
      return;
    }

    // Start or continue accumulating frames toward this target
    if (target !== this._pendingState) {
      this._pendingState = target;
      this._holdCounter  = 0;
    }
    this._holdCounter++;

    const goingUp   = STATE_ORDER.indexOf(target) > STATE_ORDER.indexOf(current);
    const required  = goingUp ? HOLD_UP : HOLD_DOWN;

    if (this._holdCounter >= required) {
      console.log(`[State] ${current} → ${target}  (level: ${level.toFixed(3)})`);
      this._store.current = target;
      this._holdCounter   = 0;
      this._pendingState  = null;
    }
  }

  /**
   * _resolveTarget(level, current)
   * ──────────────────────────────
   * Determines the desired state without any hysteresis delay applied.
   * Uses UP thresholds when evaluating upward moves, DOWN thresholds when
   * evaluating whether to stay in or drop from the current state.
   *
   * @param  {number} level    — current audioState.level (0–1)
   * @param  {string} current  — current state string
   * @returns {string}         — desired target state string
   */
  _resolveTarget(level, current) {
    const currentIdx = STATE_ORDER.indexOf(current);

    // Can we escalate? Scan from top — jump to highest state we qualify for.
    for (let i = STATE_ORDER.length - 1; i > currentIdx; i--) {
      if (level >= THRESHOLD_UP[STATE_ORDER[i]]) return STATE_ORDER[i];
    }

    // Should we drop? Find the highest state whose DOWN threshold we still meet.
    for (let i = currentIdx; i > 0; i--) {
      if (level >= THRESHOLD_DOWN[STATE_ORDER[i]]) return STATE_ORDER[i];
    }

    return STATES.IDLE;
  }
}
