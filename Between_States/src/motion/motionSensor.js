/**
 * motionSensor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Captures device motion and orientation and exposes normalized 0–1 values
 * that the Hydra patch reads on every render tick.
 *
 * TWO INPUT EVENTS
 * ────────────────
 * DeviceMotionEvent — fires ~60 fps with acceleration data (m/s²).
 *   We use e.acceleration (gravity-subtracted) when available, falling back
 *   to e.accelerationIncludingGravity on devices that don't separate them.
 *   Magnitude of the acceleration vector → motionState.energy.
 *
 * DeviceOrientationEvent — fires ~60 fps with tilt angles (degrees).
 *   gamma: left–right tilt  (−90 to 90°, 0 = flat)
 *   beta:  front–back tilt  (−180 to 180°, 0 = flat)
 *   Combined tilt angle magnitude → motionState.tilt.
 *
 * SMOOTHING
 * ─────────
 * Raw accelerometer data is noisy. An exponential moving average (EMA) with
 * α = 0.15 smooths the signal while still responding quickly to real movement.
 * Tilt is less noisy and uses a lighter smoothing (α = 0.25).
 *
 * iOS PERMISSION
 * ──────────────
 * iOS 13+ gates DeviceMotionEvent behind a user-gesture permission dialog.
 * init() calls DeviceMotionEvent.requestPermission() when the API exists.
 * This MUST be called from inside a user gesture (tap) — same requirement
 * as the Web Audio API. app.js calls both in the same _start() handler.
 *
 * EXPOSED STATE
 * ─────────────
 *   motionState.energy  0–1  overall shake / acceleration intensity
 *   motionState.tilt    0–1  how far the device is tilted from flat
 */

export class MotionSensor {
  constructor() {
    /**
     * state — the shared live motion data object.
     * Passed by reference to HydraSetup so arrow functions always
     * read the current frame's values without any polling.
     */
    this.state = {
      energy: 0,   // smoothed acceleration magnitude, normalized 0–1
      tilt:   0,   // smoothed tilt angle magnitude, normalized 0–1
    };

    this._smoothedEnergy   = 0;
    this._smoothedTilt     = 0;
    this._permissionGranted = false;
  }

  /**
   * requestPermission()
   * ───────────────────
   * Requests the iOS motion permission ONLY — does not start listeners.
   * Must be the first async call inside a user-gesture handler, before any
   * other awaited operation (e.g. mic init) that would break the gesture
   * context iOS requires for this permission.
   *
   * On Android and desktop the API doesn't exist — resolves immediately.
   */
  async requestPermission() {
    if (typeof DeviceMotionEvent?.requestPermission === 'function') {
      const permission = await DeviceMotionEvent.requestPermission();
      if (permission !== 'granted') {
        throw new Error('motion permission denied');
      }
    }
    this._permissionGranted = true;
  }

  /**
   * init()
   * ──────
   * Attaches event listeners and starts logging.
   * Call this after requestPermission() has resolved and after audio init.
   * On non-iOS devices, handles the permission check itself since no
   * gesture context restriction applies.
   */
  async init() {
    if (!this._permissionGranted) {
      await this.requestPermission();
    }

    window.addEventListener('devicemotion',      (e) => this._onMotion(e));
    window.addEventListener('deviceorientation', (e) => this._onOrientation(e));

  }

  /**
   * _onMotion(e)
   * ────────────
   * Computes acceleration magnitude and applies EMA smoothing.
   *
   * Normalization:
   *   e.acceleration values are in m/s². At rest: ~0. Active shake: 5–20.
   *   We divide by 15 and clamp to 0–1, so a vigorous shake saturates the signal.
   *   Falls back to accelerationIncludingGravity (gravity ≈ 9.8 on the z-axis
   *   when flat) — in that case we subtract 9.8 as a rough gravity estimate.
   */
  _onMotion(e) {
    let x, y, z;

    if (e.acceleration?.x != null) {
      // Gravity-subtracted — most accurate
      ({ x, y, z } = e.acceleration);
    } else if (e.accelerationIncludingGravity?.x != null) {
      // Gravity included — subtract rough estimate
      x = e.accelerationIncludingGravity.x;
      y = e.accelerationIncludingGravity.y;
      z = e.accelerationIncludingGravity.z - 9.8;
    } else {
      return;
    }

    const magnitude  = Math.sqrt(x * x + y * y + z * z);
    const normalized = Math.min(magnitude / 15, 1);

    // EMA: α = 0.15 — smooths noise while preserving real movement
    this._smoothedEnergy = this._smoothedEnergy * 0.85 + normalized * 0.15;
    this.state.energy    = this._smoothedEnergy;
  }

  /**
   * _onOrientation(e)
   * ──────────────────
   * Tracks the device moving from perpendicular to parallel to the ground —
   * i.e. from upright portrait hold to lying flat.
   *
   * Normalization via beta (front–back tilt, −180 to 180°):
   *   beta ≈ 90°  — held upright in portrait  → tilt = 0  (no effect)
   *   beta ≈ 0°   — lying flat, screen up      → tilt = 1  (full effect)
   *   beta ≈ 45°  — halfway                    → tilt = 0.5
   *
   * This means the tilt-driven Hydra effects are inactive during normal use
   * and activate progressively as the device is laid flat.
   */
  _onOrientation(e) {
    const beta = e.beta ?? 0;

    // 1 − (|beta| / 90) inverts the metric: upright=0, flat=1
    const magnitude = 1 - Math.min(Math.abs(beta) / 90, 1);

    // EMA: α = 0.25 — tilt signal is smooth, responds quickly
    this._smoothedTilt = this._smoothedTilt * 0.75 + magnitude * 0.25;
    this.state.tilt    = this._smoothedTilt;
  }
}
