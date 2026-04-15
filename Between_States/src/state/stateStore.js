/**
 * stateStore.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Holds the single source of truth for the current system state.
 *
 * States (ordered by intensity):
 *   idle       — mic is live but environment is quiet; system is latent
 *   emergence  — audio activity detected; forms begin to gather
 *   distortion — sustained audio input; full reactivity
 *   collapse   — peak audio energy; structure breaks down into glitch
 *
 * StateStore is a plain object container — no logic lives here.
 * StateMachine owns all transition logic and writes to store.current.
 * HydraSetup reads store.current via arrow functions on every render tick.
 */

export const STATES = Object.freeze({
  IDLE:       'idle',
  EMERGENCE:  'emergence',
  DISTORTION: 'distortion',
  COLLAPSE:   'collapse',
});

export class StateStore {
  constructor() {
    /** @type {'idle'|'emergence'|'distortion'|'collapse'} */
    this.current = STATES.IDLE;
  }
}
