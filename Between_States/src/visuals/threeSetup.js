/**
 * threeSetup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Three.js renderer for the 3D object that tracks the detected face.
 *
 * LAYER POSITION
 * ──────────────
 * This renderer sits on #three-canvas at z-index 1 — above the camera feed
 * (z-index 0) and below the Hydra canvas (z-index 2). The canvas uses
 * alpha: true so both the camera and Hydra show through when no object
 * is rendered, and pointer-events: none so taps fall through to the document.
 *
 * COORDINATE SYSTEM
 * ─────────────────
 * An OrthographicCamera maps face coords directly to screen space:
 *   left/right = ±aspect,  top/bottom = ±1
 *
 * arState.faceX (0–1, 0=left)  → Three.js x = (faceX * 2 − 1) * aspect
 * arState.faceY (0–1, 0=top)   → Three.js y = −(faceY * 2 − 1)
 * arState.faceSize (0–1)       → uniform scale, tuned so a typical selfie
 *                                  face (faceSize ≈ 0.3) fills the face oval
 * arState.headTilt (−1 to 1)   → Z rotation, mirrors the head angle
 *
 * MODEL LOADING
 * ─────────────
 * Expects a GLB file served from /public (referenced as '/model.glb').
 * On load the model is normalised to a 1-unit bounding box so the scale
 * factor above is predictable regardless of the source asset's original size.
 *
 * The object is hidden when no face is detected and shown once one appears.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class ThreeSetup {
  /**
   * @param {string} canvasId  — id of the <canvas> element in index.html
   */
  constructor(canvasId) {
    this._canvas   = document.getElementById(canvasId);
    this._renderer = null;
    this._scene    = null;
    this._camera     = null;
    this._object     = null;  // the loaded GLB scene root
    this._normScale  = null;  // 1 / model's native bounding box max dimension
    this._materials  = [];    // flat list of all mesh materials — updated each frame for opacity
    this._raf        = null;
    this._arState    = null;
    this._audioState = null;
    this._stateStore = null;
  }

  /**
   * init()
   * ──────
   * Creates the Three.js renderer and scene. Call once on page load before
   * any user gesture — no permissions required.
   */
  init() {
    this._renderer = new THREE.WebGLRenderer({
      canvas:    this._canvas,
      alpha:     true,   // transparent background — camera + Hydra show through
      antialias: true,
    });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.setClearColor(0x000000, 0); // fully transparent clear

    // OrthographicCamera: world-space x spans ±aspect, y spans ±1.
    // This lets us map normalised face coords to world coords with simple math.
    const aspect = window.innerWidth / window.innerHeight;
    this._camera = new THREE.OrthographicCamera(
      -aspect, aspect,  // left, right
       1,      -1,      // top, bottom
       0.1,    100      // near, far
    );
    this._camera.position.z = 5;

    this._scene = new THREE.Scene();

    // Soft ambient fill + directional key light so the model reads clearly
    // against both the camera feed and the Hydra glitch layer.
    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    this._scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1, 2, 3);
    this._scene.add(key);

    window.addEventListener('resize', () => this._onResize());
  }

  /**
   * loadModel(path, opacity)
   * ────────────────────────
   * Loads a GLB asset from `path` (e.g. '/model.glb').
   * The model is normalised to a 1-unit bounding box on load so scaling
   * by eyeDistance gives consistent, predictable results.
   *
   * opacity (0–1) is applied to every mesh material so the camera feed
   * (z-index 0) shows through the 3D object. 0 = invisible, 1 = fully opaque.
   * Tune this value to control how much of the user's face is visible beneath
   * the mask.
   *
   * The object is added to the scene but hidden until a face is detected.
   * Opacity is set dynamically in _update() from audioState.level — this
   * method just enables transparency on all materials so the camera feed
   * (z-index 0) can show through. Quiet = opaque, loud = translucent.
   *
   * @param {string} path  — URL of the .glb file (place in /public)
   */
  loadModel(path) {
    const loader = new GLTFLoader();

    loader.load(
      path,
      (gltf) => {
        this._object = gltf.scene;

        // Compute bounding box of the whole model.
        const box    = new THREE.Box3().setFromObject(this._object);
        const size   = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        // Normalise: scale so the longest axis = 1 unit.
        // Store normScale so _update() can incorporate it — without this,
        // _update()'s setScalar call would overwrite the normalisation and
        // the model would render at its raw native size every frame.
        const maxDim = Math.max(size.x, size.y, size.z);
        this._normScale = 1 / maxDim;
        this._object.scale.setScalar(this._normScale);

        // Re-centre at origin after normalisation.
        this._object.position.copy(center).multiplyScalar(-this._normScale);

        // Collect all mesh materials and enable transparency so opacity can
        // be driven by audio each frame in _update().
        this._materials = [];
        this._object.traverse((child) => {
          if (!child.isMesh) return;
          const mats = Array.isArray(child.material)
            ? child.material
            : [child.material];
          mats.forEach((mat) => {
            mat.transparent = true;
            // Enable emissive channel for state-driven color tinting.
            // emissiveIntensity is driven each frame in _update().
            if ('emissive' in mat) {
              mat.emissive          = new THREE.Color(0x000000);
              mat.emissiveIntensity = 0;
            }
            this._materials.push(mat);
          });
        });

        this._object.visible = false; // hidden until face detected
        this._scene.add(this._object);

        console.log(`[Three] Model loaded: ${path}`);
      },
      undefined,
      (err) => console.error('[Three] Model load error:', err)
    );
  }

  /**
   * start(arState)
   * ───────────────
   * Begins the render loop and starts reading face data each frame.
   * Call after the user gesture (inside app.js _start()) so we have a
   * live arState reference.
   *
   * @param {object} arState    — live reference from ARSystem.arState
   * @param {object} audioState — live reference from AudioAnalyzer.state
   */
  start(arState, audioState, stateStore) {
    this._arState    = arState;
    this._audioState = audioState;
    this._stateStore = stateStore;
    this._loop();
  }

  /**
   * stop()
   * ───────
   * Cancels the render loop (e.g. on camera switch).
   */
  stop() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    this._update();
    this._renderer.render(this._scene, this._camera);
  }

  /**
   * _update()
   * ──────────
   * Runs every frame. Maps arState face keypoint values to the 3D object's
   * position, scale, and rotation in orthographic world space.
   *
   * ANCHOR POINT
   * ────────────
   * faceAnchorX/Y is the midpoint between the two eye corners — a stable
   * point that tracks the face without drifting with hair or chin movement.
   * The eye line sits at roughly the upper-third of the face, so we shift
   * the object down by one eye-distance to land it at the face centre.
   * Adjust EYE_OFFSET_Y to move the object up (smaller) or down (larger).
   *
   * SCALE
   * ─────
   * eyeDistance is the eye-corner span normalised by video width (0–1).
   * At a typical selfie distance this is ~0.13–0.18. Multiplying by
   * SCALE_FACTOR maps that to an object size in ortho world units.
   * Adjust SCALE_FACTOR to make the object fill more or less of the face.
   */
  _update() {
    if (!this._object || !this._arState || !this._normScale) return;

    const ar     = this._arState;
    const aspect = window.innerWidth / window.innerHeight;

    // ── Audio-reactive opacity + state-driven material color tint ───────────
    // Quiet  (level→0) → opacity near MAX_OPACITY: mask is solid, identity hidden.
    // Loud   (level→1) → opacity near MIN_OPACITY: mask fades, face emerges.
    // emissive color shifts with state — mirrors pitch site palette so the
    // 3D object reads clearly as belonging to the current behavioral phase.
    //   idle        → aqua   #44FFD1
    //   emergence   → blue   #304FFE
    //   distortion  → pink   #FF1D89
    //   collapse    → yellow #FFEC00
    // emissiveIntensity is driven by audio level so the tint pulses with sound.
    if (this._audioState && this._materials.length) {
      const level       = this._audioState.level ?? 0;
      const audioFactor = Math.min(Math.pow(level * 8, 0.4), 1); // 0→1
      const opacity     = 0.85 - audioFactor * 0.75;             // 0.85 quiet → 0.10 loud

      const STATE_COLORS = {
        idle:       new THREE.Color(0x44FFD1),
        emergence:  new THREE.Color(0x304FFE),
        distortion: new THREE.Color(0xFF1D89),
        collapse:   new THREE.Color(0xFFEC00),
      };
      const stateName   = this._stateStore?.current ?? 'idle';
      const tintColor   = STATE_COLORS[stateName] ?? STATE_COLORS.idle;
      const emissiveInt = audioFactor * 0.55; // max emissive at peak audio

      this._materials.forEach((mat) => {
        mat.opacity = opacity;
        if ('emissive' in mat) {
          mat.emissive.copy(tintColor);
          mat.emissiveIntensity = emissiveInt;
        }
      });
    }

    if (ar.faceDetected) {
      this._object.visible = true;

      // ── Tuning constants ──────────────────────────────────────────────────
      // EYE_OFFSET_Y: downward shift from eye midpoint toward face centre.
      //   The anchor (faceAnchorY) sits at the eye-corner line. Increase this
      //   to push the mask down if the model's eyes are sitting too high.
      const EYE_OFFSET_Y = 1.5;
      // SCALE_FACTOR: final size = normScale × faceSize × SCALE_FACTOR.
      //   1.0 = model fills roughly the face bounding box width.
      //   Increase to make the object larger, decrease to shrink it.
      const SCALE_FACTOR = 5.0;

      // ── Position ──────────────────────────────────────────────────────────
      // Map eye-midpoint from normalised video coords to ortho world coords:
      //   normX 0→1 : left (−aspect) to right (+aspect)
      //   normY 0→1 : top (+1) to bottom (−1)  [Three.js y-up, CSS y-down]
      //
      // The Y offset shifts the anchor down from the eye line toward the face
      // centre. eyeDistance is normalised by vw; divide by aspect to convert
      // to the same scale as the ortho camera's vertical (±1) range.
      this._object.position.x = (ar.faceAnchorX * 2 - 1) * aspect;
      this._object.position.y = -(ar.faceAnchorY * 2 - 1)
                                 - (ar.eyeDistance / aspect) * EYE_OFFSET_Y;
      this._object.position.z = 0;

      // ── Scale ─────────────────────────────────────────────────────────────
      // normScale cancels out the model's native bounding box size so the
      // multiplier is always relative to 1 world unit, not the raw geometry.
      // faceSize (bbox width / video width) uses the same reference as the
      // Hydra CSS mask so both layers scale together.
      this._object.scale.setScalar(this._normScale * ar.faceSize * SCALE_FACTOR);

      // ── Head tilt → Z rotation ────────────────────────────────────────────
      // headTilt −1…1 maps to roughly ±23° (0.4 rad).
      this._object.rotation.z = -ar.headTilt * 0.4;

    } else {
      this._object.visible = false;
    }
  }

  _onResize() {
    const w      = window.innerWidth;
    const h      = window.innerHeight;
    const aspect = w / h;

    this._renderer.setSize(w, h);

    this._camera.left  = -aspect;
    this._camera.right =  aspect;
    this._camera.updateProjectionMatrix();
  }
}
