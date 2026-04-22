/**
 * app.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates the startup sequence and connects all subsystems.
 *
 * Responsibilities:
 *   1. Wait for first tap → run startup sequence inside the gesture handler.
 *   2. Initialize ToneEngine, audio, motion, AR, Three.js in correct order.
 *   3. Switch Hydra from idle → reactive patch.
 *   4. Run the blend loop: Hydra opacity, face mask, state HUD, auto-demo.
 *   5. Detect state changes → notify ToneEngine + fire collapse flash.
 *   6. Wire UI buttons: camera flip, state cycle, orbital toggle.
 *   7. Surface errors back to the overlay.
 *
 * iOS PERMISSION ORDER
 * ─────────────────────
 * DeviceMotionEvent.requestPermission() must fire FIRST, synchronously inside
 * the gesture handler. The mic init (AudioAnalyzer.init) breaks the gesture
 * context — once it's awaited, motion permission requests will silently fail.
 */

import { ToneEngine } from '../audio/toneEngine.js';

export class App {
  /**
   * @param {AudioAnalyzer} audioAnalyzer
   * @param {HydraSetup}    hydraSetup
   * @param {StateStore}    stateStore
   * @param {MotionSensor}  motionSensor
   * @param {ARSystem}      arSystem
   * @param {ThreeSetup}    threeSetup
   */
  constructor(audioAnalyzer, hydraSetup, stateStore, motionSensor, arSystem, threeSetup) {
    this._audioAnalyzer = audioAnalyzer;
    this._hydraSetup    = hydraSetup;
    this._stateStore    = stateStore;
    this._motionSensor  = motionSensor;
    this._arSystem      = arSystem;
    this._threeSetup    = threeSetup;
    this._toneEngine    = null;

    this._overlay     = document.getElementById('overlay');
    this._errorMsg    = document.getElementById('error-msg');
    this._flipBtn     = document.getElementById('camera-flip');
    this._hydraCanvas = document.getElementById('hydra-canvas');
    this._flashState  = null;
    this._blendRaf    = null;
    this._flashRaf    = null;
  }

  /**
   * init()
   * ──────
   * Attaches tap/click listener to the overlay.
   * { once: true } auto-removes after first trigger.
   */
  init() {
    let started = false;
    const startHandler = (e) => {
      if (started) return;
      started = true;
      e.preventDefault();
      this._start();
    };
    this._overlay.addEventListener('click',    startHandler, { once: true });
    this._overlay.addEventListener('touchend', startHandler, { once: true });
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * _start()
   * ────────
   * Async startup inside the user-gesture handler.
   *
   * CRITICAL ordering on iOS:
   *   1. motionSensor.requestPermission() — synchronous, must be before any await
   *   2. audioAnalyzer.init()            — triggers mic dialog, breaks gesture context
   *   3. ToneEngine.init()               — reuses p5's AudioContext (post-mic-init)
   *   4. motionSensor.init()             — attaches event listeners
   *   5. arSystem.init()                 — triggers camera dialog
   */
  async _start() {
    try {
      // ── Motion permission (iOS must be FIRST within synchronous gesture stack) ─
      try {
        await this._motionSensor.requestPermission();
      } catch (motionErr) {
        console.warn('[Between States] Motion permission unavailable:', motionErr.message ?? motionErr);
      }

      // ── Microphone + FFT ──────────────────────────────────────────────────
      await this._audioAnalyzer.init();

      // ── Tone engine — reuse p5's AudioContext to avoid iOS context limit ──
      // p5.sound exposes getAudioContext() globally after mic init resolves.
      try {
        const p5Ctx = typeof getAudioContext === 'function' ? getAudioContext() : null;
        this._toneEngine = new ToneEngine();
        this._toneEngine.init(p5Ctx);
      } catch (toneErr) {
        console.warn('[Between States] Tone engine unavailable:', toneErr.message ?? toneErr);
      }

      // ── Motion sensor listeners ───────────────────────────────────────────
      try {
        await this._motionSensor.init();
      } catch (motionErr) {
        console.warn('[Between States] Motion sensor unavailable:', motionErr.message ?? motionErr);
      }

      // ── AR face tracking + camera ─────────────────────────────────────────
      try {
        await this._arSystem.init('user');
      } catch (arErr) {
        console.warn('[Between States] AR unavailable:', arErr.message ?? arErr);
      }

      // ── Three.js render loop ──────────────────────────────────────────────
      this._threeSetup.start(
        this._arSystem.arState,
        this._audioAnalyzer.state,
        this._stateStore
      );

      // flashState: read by Hydra every tick; tap sets pixelate → decays back to 1
      this._flashState = { pixelate: 1 };

      // ── Switch Hydra to reactive patch ────────────────────────────────────
      this._hydraSetup.setReactivePatch(
        this._audioAnalyzer.state,
        this._stateStore,
        this._motionSensor.state,
        this._flashState,
        this._arSystem.arState
      );

      // ── Fade overlay out ──────────────────────────────────────────────────
      this._overlay.classList.add('hidden');

      // ── Wire UI ───────────────────────────────────────────────────────────
      this._setupTapFlash();
      this._startBlendLoop();
      this._setupFlipButton();
      this._setupStateCycleButton();
      this._setupToggleOrbitalsButton();

    } catch (err) {
      console.error('[Between States] Audio init failed:', err);

      const isDenied = err?.message?.toLowerCase().includes('denied')
                    || err?.name === 'NotAllowedError';
      const isSecure = err?.name === 'SecurityError'
                    || err?.message?.toLowerCase().includes('insecure')
                    || err?.message?.toLowerCase().includes('secure');
      const msg = isDenied
        ? 'microphone access was denied — please allow access and refresh'
        : isSecure
          ? 'requires https — open via https or localhost'
          : `could not start audio — ${err?.name ?? ''}: ${err?.message ?? 'unknown'}`;

      this._errorMsg.textContent = msg;
      this._errorMsg.style.display = 'block';

      // Allow retry
      let retrying = false;
      const retryHandler = (e) => {
        if (retrying) return;
        retrying = true;
        e.preventDefault();
        this._start();
      };
      this._overlay.addEventListener('click',    retryHandler, { once: true });
      this._overlay.addEventListener('touchend', retryHandler, { once: true });
    }
  }

  /**
   * _setupTapFlash()
   * ─────────────────
   * Document-level tap handler that:
   *   1. Triggers a Hydra pixelate burst (decays over ~0.75 s).
   *   2. Raycasts the tap into the Three.js scene for orbital/mask bursts.
   *
   * Buttons use stopPropagation() so their taps don't reach this handler.
   */
  _setupTapFlash() {
    const onTap = (e) => {
      // Hydra pixelate flash
      this._flashState.pixelate = 100;
      this._startFlashDecay();

      // 3D raycaster — trigger scale burst on hit objects
      const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
      const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;
      this._threeSetup.handleTap(clientX, clientY);
    };
    document.addEventListener('click',    onTap);
    document.addEventListener('touchend', onTap);
  }

  /**
   * _startBlendLoop()
   * ──────────────────
   * 60 fps RAF loop that:
   *   • Sets Hydra canvas opacity from audio level
   *   • Applies CSS face-mask to Hydra when face is detected
   *   • Updates state HUD (name, description, audio bar, face indicator)
   *   • Detects state changes → calls ToneEngine.setState() + fires collapse flash
   *   • Runs auto-demo: if silence > 10 s, cycles all four states automatically
   */
  _startBlendLoop() {
    const arState = this._arSystem.arState;

    // HUD elements
    const hud      = document.getElementById('state-hud');
    const hudState = hud.querySelector('.hud-state');
    const hudDesc  = hud.querySelector('.hud-desc');
    const hudFace  = hud.querySelector('.hud-face');
    const hudFill  = hud.querySelector('.hud-bar-fill');
    hud.style.display = 'flex';

    // State flash overlay (brief yellow/colored flash on collapse entry)
    const stateFlashEl = document.getElementById('state-flash');

    // Per-state color and description for HUD
    const STATE_COLOR = {
      idle:       'rgba(68,255,209,0.7)',
      emergence:  'rgba(48,79,254,0.9)',
      distortion: 'rgba(255,29,137,0.9)',
      collapse:   'rgba(255,236,0,0.9)',
    };
    const STATE_DESC = {
      idle:       'mic live · waiting',
      emergence:  'face-track · 3D overlay · tones',
      distortion: 'glitch · particles · tones',
      collapse:   'burst · orbitals · full overload',
    };

    // State change tracking (for tone engine + flash)
    let prevState = 'idle';

    // Auto-demo: cycle states if silence persists for 10 s (~600 frames at 60 fps)
    let silenceFrames  = 0;
    let autoDemoActive = false;
    let autoDemoStep   = 0;
    let autoDemoNextAt = 0;
    const AUTO_STATES  = ['idle', 'emergence', 'distortion', 'collapse'];

    const update = () => {
      const level    = this._audioAnalyzer.state.level;
      const stateName = this._stateStore.current ?? 'idle';

      // ── Hydra opacity driven by audio level ─────────────────────────────
      const audioOpacity = 0.85 + Math.min(Math.pow(level * 8, 0.4), 1) * 0.15;
      this._hydraCanvas.style.opacity = audioOpacity;

      // ── Face mask on Hydra canvas ────────────────────────────────────────
      if (arState.faceDetected) {
        const cx     = (arState.faceX * 100).toFixed(1) + '%';
        const cy     = (arState.faceY * 100).toFixed(1) + '%';
        const radius = (arState.faceSize * 120).toFixed(1) + 'vw';
        const mask   = `radial-gradient(ellipse ${radius} ${radius} at ${cx} ${cy}, white 40%, transparent 70%)`;
        this._hydraCanvas.style.webkitMaskImage = mask;
        this._hydraCanvas.style.maskImage       = mask;
      } else {
        this._hydraCanvas.style.webkitMaskImage = 'none';
        this._hydraCanvas.style.maskImage       = 'none';
      }

      // ── State change detection ───────────────────────────────────────────
      if (stateName !== prevState) {
        // Notify tone engine — drone glides to new frequency/gain
        this._toneEngine?.setState(stateName);

        // Fire full-screen color flash when entering collapse
        if (stateName === 'collapse' && stateFlashEl) {
          stateFlashEl.classList.remove('flash');
          void stateFlashEl.offsetWidth;   // force reflow to restart animation
          stateFlashEl.classList.add('flash');
        }

        prevState = stateName;
      }

      // ── Auto-demo: silence detection ─────────────────────────────────────
      if (level >= 0.04) {
        // Audio activity — cancel any running auto-demo
        silenceFrames = 0;
        if (autoDemoActive) {
          autoDemoActive = false;
          autoDemoStep   = 0;
          // Release state lock so audio resumes control
          if (this._stateStore.lockedUntil > Date.now()) {
            this._stateStore.lockedUntil = 0;
          }
        }
      } else {
        silenceFrames++;
        // Trigger auto-demo after 10 s of silence
        if (silenceFrames >= 600 && !autoDemoActive) {
          autoDemoActive = true;
          autoDemoStep   = 0;
          autoDemoNextAt = 0;   // fire immediately on next frame
        }
      }

      // Advance auto-demo sequence
      if (autoDemoActive && Date.now() >= autoDemoNextAt) {
        if (autoDemoStep < AUTO_STATES.length) {
          this._stateStore.current     = AUTO_STATES[autoDemoStep];
          this._stateStore.lockedUntil = Date.now() + 2800;
          autoDemoNextAt               = Date.now() + 3200;
          autoDemoStep++;
        } else {
          // Sequence complete — reset and allow another cycle after fresh silence
          autoDemoActive = false;
          autoDemoStep   = 0;
          silenceFrames  = 0;
        }
      }

      // ── State HUD ────────────────────────────────────────────────────────
      hudState.textContent = stateName.toUpperCase();
      hudState.style.color = STATE_COLOR[stateName] ?? STATE_COLOR.idle;
      hudFill.style.background = STATE_COLOR[stateName] ?? STATE_COLOR.idle;
      hudFace.textContent  = arState.faceDetected ? 'face ◈' : 'no face';
      hudFill.style.width  = Math.round(level * 100) + '%';
      if (hudDesc) hudDesc.textContent = STATE_DESC[stateName] ?? '';

      this._blendRaf = requestAnimationFrame(update);
    };

    this._blendRaf = requestAnimationFrame(update);
  }

  /**
   * _setupFlipButton()
   * ───────────────────
   * Shows and wires the camera flip button (top-right).
   */
  _setupFlipButton() {
    this._flipBtn.style.display = 'block';
    this._flipBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      this._flipBtn.textContent = '...';
      this._flipBtn.disabled    = true;
      try {
        await this._arSystem.switchCamera();
      } catch (err) {
        console.warn('[Between States] Camera switch failed:', err.message);
      }
      this._flipBtn.textContent = 'flip cam';
      this._flipBtn.disabled    = false;
    });
  }

  /**
   * _setupStateCycleButton()
   * ─────────────────────────
   * Shows the demo cycle button (bottom-right). Each tap advances the state
   * and locks it for 4 s before audio resumes control.
   */
  _setupStateCycleButton() {
    const btn    = document.getElementById('state-cycle');
    const STATES = ['idle', 'emergence', 'distortion', 'collapse'];

    btn.style.display = 'block';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const current = this._stateStore.current;
      const nextIdx = (STATES.indexOf(current) + 1) % STATES.length;
      const next    = STATES[nextIdx];

      this._stateStore.current     = next;
      this._stateStore.lockedUntil = Date.now() + 4000;

      btn.textContent = next + ' →';
      setTimeout(() => { btn.textContent = 'cycle →'; }, 1200);
    });
    btn.addEventListener('touchend', (e) => {
      e.stopPropagation();
      e.preventDefault();
      btn.click();
    });
  }

  /**
   * _setupToggleOrbitalsButton()
   * ─────────────────────────────
   * Shows and wires the orbital visibility toggle button (top-left).
   * Demonstrates "visibility toggles" as an explicit basic feature.
   * Only has visible effect in rear-camera mode where orbitals are shown.
   */
  _setupToggleOrbitalsButton() {
    const btn = document.getElementById('toggle-orbitals');
    if (!btn) return;

    btn.style.display = 'block';

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowVisible = this._threeSetup.toggleOrbitals();
      btn.textContent  = nowVisible ? 'orbitals: on' : 'orbitals: off';
    });
    btn.addEventListener('touchend', (e) => {
      e.stopPropagation();
      e.preventDefault();
      btn.click();
    });
  }

  /**
   * _startFlashDecay()
   * ───────────────────
   * Exponentially decays flashState.pixelate from 100 → 1 over ~0.75 s.
   * Each frame pulls 10% of the remaining distance toward 1.
   */
  _startFlashDecay() {
    if (this._flashRaf) cancelAnimationFrame(this._flashRaf);

    const decay = () => {
      this._flashState.pixelate += (1 - this._flashState.pixelate) * 0.1;
      if (this._flashState.pixelate > 1.5) {
        this._flashRaf = requestAnimationFrame(decay);
      } else {
        this._flashState.pixelate = 1;
        this._flashRaf = null;
      }
    };

    this._flashRaf = requestAnimationFrame(decay);
  }
}
