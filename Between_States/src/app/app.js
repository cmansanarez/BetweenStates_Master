/**
 * app.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestrates the startup sequence.
 *
 * Responsibilities:
 *   1. Listen for the user's first tap/click on the overlay.
 *   2. On tap: initialize the microphone (requires user gesture on mobile).
 *   3. Hand the live audioState reference to Hydra so the patch can react.
 *   4. Fade out the overlay.
 *   5. Surface any errors (mic denied, etc.) back to the overlay UI.
 */

export class App {
  /**
   * @param {AudioAnalyzer} audioAnalyzer  — audio capture + FFT module
   * @param {HydraSetup}    hydraSetup     — Hydra canvas + patch module
   * @param {StateStore}    stateStore     — live system state container
   * @param {MotionSensor}  motionSensor   — device motion + orientation module
   * @param {ARSystem}      arSystem       — camera feed + face tracking module
   * @param {ThreeSetup}    threeSetup     — Three.js 3D object layer
   */
  constructor(audioAnalyzer, hydraSetup, stateStore, motionSensor, arSystem, threeSetup) {
    this._audioAnalyzer = audioAnalyzer;
    this._hydraSetup    = hydraSetup;
    this._stateStore    = stateStore;
    this._motionSensor  = motionSensor;
    this._arSystem      = arSystem;
    this._threeSetup    = threeSetup;

    this._overlay     = document.getElementById('overlay');
    this._errorMsg    = document.getElementById('error-msg');
    this._flipBtn     = document.getElementById('camera-flip');
    this._hydraCanvas = document.getElementById('hydra-canvas');
  }

  /**
   * init()
   * ──────
   * Attaches the tap/click listener to the overlay.
   * Uses { once: true } so the handler auto-removes after the first trigger —
   * prevents double-init if the user somehow taps twice very fast.
   *
   * We listen for both 'click' (desktop / mouse) and 'touchend' (mobile).
   * 'touchstart' is intentionally avoided to prevent accidental triggers
   * from scroll gestures on mobile.
   */
  init() {
    let started = false;
    const startHandler = (e) => {
      if (started) return;
      started = true;
      // Prevent the ~300 ms synthesized click that follows touchend on iOS,
      // which would otherwise call _start() a second time.
      e.preventDefault();
      this._start();
    };
    this._overlay.addEventListener('click',    startHandler, { once: true });
    this._overlay.addEventListener('touchend', startHandler, { once: true });
  }

  /**
   * _start()
   * ────────
   * Async startup sequence. Called once, inside the user gesture callback.
   *
   * Must remain inside the gesture stack for Web Audio to initialize on iOS.
   * If called outside a gesture (e.g. from a setTimeout), the AudioContext
   * will be suspended and mic access will silently fail on Safari.
   */
  async _start() {
    try {
      // Initialize microphone and FFT.
      // This call triggers the browser's mic-permission dialog on first run.
      // On iOS/Safari the AudioContext is only allowed to start here because
      // we are synchronously inside the user-gesture event handler.
      // Request motion permission FIRST — iOS requires this within the
      // synchronous gesture stack, before any other awaited operation.
      // The mic init below triggers a separate permission dialog which
      // breaks the gesture context, so motion must be requested before it.
      // Non-fatal: if denied or unavailable, visuals still work via audio.
      try {
        await this._motionSensor.requestPermission();
      } catch (motionErr) {
        console.warn('[Between States] Motion permission unavailable:', motionErr.message ?? motionErr);
      }

      await this._audioAnalyzer.init();

      // Now start the motion listeners (permission already granted above).
      try {
        await this._motionSensor.init();
      } catch (motionErr) {
        console.warn('[Between States] Motion sensor unavailable:', motionErr.message ?? motionErr);
      }

      // Start AR face tracking. Camera permission dialog fires here.
      // Non-fatal: if camera is denied the experience continues without AR.
      try {
        await this._arSystem.init('user');
      } catch (arErr) {
        console.warn('[Between States] AR unavailable:', arErr.message ?? arErr);
      }

      // Begin the Three.js render loop with live references to arState and
      // audioState. Opacity is driven by audio level each frame.
      this._threeSetup.start(this._arSystem.arState, this._audioAnalyzer.state, this._stateStore);

      // flashState is read by the Hydra patch every tick via arrow functions.
      // pixelate: 1 = no visible effect (1px blocks = passthrough).
      // A tap sets it to 100 and _startFlashDecay() exponentially returns it to 1.
      this._flashState = { pixelate: 1 };

      // Switch the Hydra patch from idle → reactive.
      // All state objects are passed as live references so Hydra's
      // arrow functions always read the current frame's values.
      this._hydraSetup.setReactivePatch(
        this._audioAnalyzer.state,
        this._stateStore,
        this._motionSensor.state,
        this._flashState,
        this._arSystem.arState
      );

      // Fade out the overlay. The CSS transition handles the animation;
      // we just add the class. The overlay is pointer-events: none after fade.
      this._overlay.classList.add('hidden');

      // Attach the in-experience tap listener now that the overlay is gone.
      this._setupTapFlash();

      // Start audio-driven blend loop: Hydra canvas opacity tracks audio level.
      this._startBlendLoop();

      // Show and wire the camera flip button.
      this._setupFlipButton();

    } catch (err) {
      // Mic access was denied or the AudioContext failed.
      // Show the error inline so the user knows what happened.
      console.error('[Between States] Audio init failed:', err);

      const msg = err?.message?.toLowerCase().includes('denied')
        ? 'microphone access was denied — please allow access and refresh'
        : 'could not start audio — please try again';

      this._errorMsg.textContent = msg;
      this._errorMsg.style.display = 'block';

      // Re-attach the tap listener so the user can try again.
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
   * Attaches a document-level tap listener that triggers a pixelate flash
   * on the o1 Hydra buffer. Called once the overlay has faded out.
   *
   * The overlay becomes pointer-events: none after fade, so all taps on the
   * canvas reach the document and trigger this handler.
   */
  _setupTapFlash() {
    const onTap = () => {
      this._flashState.pixelate = 100;
      this._startFlashDecay();
    };
    document.addEventListener('click',    onTap);
    document.addEventListener('touchend', onTap);
  }

  /**
   * _startFlashDecay()
   * ───────────────────
   * Exponentially decays flashState.pixelate from 100 back to 1 using
   * requestAnimationFrame. Each frame pulls the value 10% closer to 1,
   * giving a fast initial drop that slows as it settles — ~0.75 s total.
   */
  /**
   * _startBlendLoop()
   * ──────────────────
   * Each frame:
   *   1. Sets Hydra canvas opacity from audio level (silence=0, loud=1).
   *   2. When a face is detected, applies a CSS radial-gradient mask on the
   *      Hydra canvas so it is fully opaque at the face centre and fades to
   *      a low base opacity (~20%) at the edges — "face becomes glitch".
   *      Without a face, the mask is removed and opacity applies uniformly.
   *
   * The mask is a radial-gradient from black (opaque) at centre to a
   * semi-transparent grey at the edges. CSS mask-image uses luminance —
   * black = fully masked (hidden), white = fully visible.
   * We invert this: white at centre (show Hydra), dark at edges (show camera).
   *
   * Face mask radius is 1.5× faceSize so it generously covers the whole
   * head rather than just the bounding box centre.
   */
  _startBlendLoop() {
    const arState  = this._arSystem.arState;

    // State HUD elements
    const hud      = document.getElementById('state-hud');
    const hudState = hud.querySelector('.hud-state');
    const hudFace  = hud.querySelector('.hud-face');
    const hudFill  = hud.querySelector('.hud-bar-fill');
    hud.style.display = 'flex';

    // HUD color per state — mirrors the pitch site palette
    const STATE_COLOR = {
      idle:       'rgba(68,255,209,0.7)',
      emergence:  'rgba(48,79,254,0.9)',
      distortion: 'rgba(255,29,137,0.9)',
      collapse:   'rgba(255,236,0,0.9)',
    };

    const update = () => {
      const level = this._audioAnalyzer.state.level;

      // When a face is detected, guarantee a minimum opacity of 0.6 so the
      // mask effect is always visible — even in near-silence the glitch shows
      // on the face. Audio still pushes it to 1 for full domination.
      const audioOpacity = Math.min(Math.pow(level * 8, 0.4), 1);
      const opacity      = arState.faceDetected
        ? Math.max(audioOpacity, 0.6)
        : audioOpacity;

      this._hydraCanvas.style.opacity = opacity;

      if (arState.faceDetected) {
        const cx = (arState.faceX * 100).toFixed(1) + '%';
        const cy = (arState.faceY * 100).toFixed(1) + '%';
        // Radius sized to cover from face centre to just past the head.
        // faceSize * 120vw at typical selfie distance covers well.
        const radius = (arState.faceSize * 120).toFixed(1) + 'vw';

        // Hard centre: white 0%→40% = fully visible glitch on face
        // Sharp falloff: 40%→70% transition
        // Edge: transparent (black) = camera shows through cleanly
        const mask = `radial-gradient(ellipse ${radius} ${radius} at ${cx} ${cy}, white 40%, transparent 70%)`;
        this._hydraCanvas.style.webkitMaskImage = mask;
        this._hydraCanvas.style.maskImage       = mask;
      } else {
        this._hydraCanvas.style.webkitMaskImage = 'none';
        this._hydraCanvas.style.maskImage       = 'none';
      }

      // Update state HUD
      const stateName = this._stateStore.current ?? 'idle';
      hudState.textContent = stateName.toUpperCase();
      hudState.style.color = STATE_COLOR[stateName] ?? STATE_COLOR.idle;
      hudFill.style.background = STATE_COLOR[stateName] ?? STATE_COLOR.idle;
      hudFace.textContent  = arState.faceDetected ? 'face ◈' : 'no face';
      hudFill.style.width  = Math.round(level * 100) + '%';

      this._blendRaf = requestAnimationFrame(update);
    };
    this._blendRaf = requestAnimationFrame(update);
  }

  /**
   * _setupFlipButton()
   * ───────────────────
   * Shows the camera flip button and wires its click handler.
   * stopPropagation() prevents the tap from bubbling to the document
   * tap-flash listener and triggering a pixelate burst.
   */
  _setupFlipButton() {
    this._flipBtn.style.display = 'block';
    this._flipBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      this._flipBtn.textContent = '...';
      this._flipBtn.disabled = true;
      try {
        await this._arSystem.switchCamera();
      } catch (err) {
        console.warn('[Between States] Camera switch failed:', err.message);
      }
      this._flipBtn.textContent = 'flip cam';
      this._flipBtn.disabled = false;
    });
  }

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
