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
    this._time       = 0;    // frame counter for orbit + spin animations
    this._orbitals   = [];   // additional geometric shapes orbiting in rear-camera mode
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

    // Create the geometric orbiting companion shapes.
    this._setupOrbitals();
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

    this._time++;
    const ar     = this._arState;
    const aspect = window.innerWidth / window.innerHeight;
    const t      = this._time / 60; // time in seconds at 60 fps
    const level  = this._audioState?.level ?? 0;

    // ── Audio + state-driven material tint on the GLB mask ───────────────
    // Palette matches the pitch site exactly per state.
    //   idle → aqua #44FFD1 · emergence → blue #304FFE
    //   distortion → pink #FF1D89 · collapse → yellow #FFEC00
    if (this._audioState && this._materials.length) {
      const audioFactor = Math.min(Math.pow(level * 8, 0.4), 1);
      const opacity     = 0.85 - audioFactor * 0.75; // 0.85 quiet → 0.10 loud
      const stateName   = this._stateStore?.current ?? 'idle';
      const tintColor   = ThreeSetup.STATE_COLORS[stateName];
      const emissiveInt = 0.3 + audioFactor * 0.55;

      this._materials.forEach((mat) => {
        mat.opacity = opacity;
        if ('emissive' in mat) {
          mat.emissive.copy(tintColor);
          mat.emissiveIntensity = emissiveInt;
        }
      });
    }

    const isRear = ar.facingMode === 'environment';

    if (isRear) {
      // ── REAR-CAMERA / ORBIT MODE ─────────────────────────────────────────
      // Main GLB mask orbits the screen centre. Geometric companions also orbit.
      // No face tracking — camera is looking at the world, not the user.
      this._object.visible = true;

      const ORBIT_SPEED  = 0.4;
      const ORBIT_X      = aspect * 0.45;
      const ORBIT_Y      = 0.45;
      const ORBIT_SCALE  = 0.35;
      const scalePulse   = 1 + level * 0.8;

      this._object.position.x = Math.cos(t * ORBIT_SPEED) * ORBIT_X;
      this._object.position.y = Math.sin(t * ORBIT_SPEED) * ORBIT_Y;
      this._object.position.z = 0;
      this._object.scale.setScalar(this._normScale * ORBIT_SCALE * scalePulse);
      this._object.rotation.x += 0.010;
      this._object.rotation.y += 0.018;
      this._object.rotation.z += 0.005;

      this._updateOrbitals(t, aspect, level, true);

    } else {
      // ── SELFIE / FACE-TRACKING MODE ──────────────────────────────────────
      // Geometric orbitals are hidden — camera is looking at the user's face.
      this._updateOrbitals(t, aspect, level, false);

      if (ar.faceDetected) {
        // Face anchor: GLB mask maps to detected face keypoints
        this._object.visible = true;

        const SCALE_FACTOR = 2.0;

        // Position from bounding-box centre (faceX/faceY) — the same reference
        // the Hydra CSS mask uses, so the model sits directly over the face oval.
        this._object.position.x = (ar.faceX * 2 - 1) * aspect;
        this._object.position.y = -(ar.faceY * 2 - 1);
        this._object.position.z = 0;
        this._object.scale.setScalar(this._normScale * ar.faceSize * SCALE_FACTOR);

        // Z rotation mirrors head tilt; no accumulated spin in face-tracking mode
        this._object.rotation.z = -ar.headTilt * 0.4;

      } else {
        // No face in selfie mode — hide the mask; don't orbit it
        this._object.visible = false;
      }
    }
  }

  // ── Static palette shared between GLB material tint and orbital emissive ──
  static get STATE_COLORS() {
    return {
      idle:       new THREE.Color(0x44FFD1),
      emergence:  new THREE.Color(0x304FFE),
      distortion: new THREE.Color(0xFF1D89),
      collapse:   new THREE.Color(0xFFEC00),
    };
  }

  /**
   * _setupOrbitals()
   * ─────────────────
   * Creates four geometric Three.js meshes — icosahedron, torus, octahedron,
   * and tetrahedron — each tinted with one of the four pitch-site state colors.
   * They are added to the scene hidden; _updateOrbitals() positions and shows
   * them in rear-camera mode and hides them in selfie mode.
   *
   * Shape → Color mapping mirrors the state palette so the scene always uses
   * all four hues simultaneously regardless of the current audio state:
   *   Icosahedron → aqua  #44FFD1   (idle)
   *   Torus       → pink  #FF1D89   (distortion) — ring reads as "signal loop"
   *   Octahedron  → blue  #304FFE   (emergence)
   *   Tetrahedron → yellow #FFEC00  (collapse)
   *
   * Each orbital stores its own spin rates and orbit parameters so they move
   * independently and never perfectly align (creating a constantly evolving
   * composition).
   */
  _setupOrbitals() {
    const defs = [
      {
        geom:  new THREE.IcosahedronGeometry(0.065, 1),
        color: 0x44FFD1,
        rx: 0.32,   // orbit x-radius multiplied by aspect in _update
        ry: 0.55,   // orbit y-radius
        speed: 0.62,
        phase: 0,
        spin: [0.014, 0.022, 0.007],
      },
      {
        geom:  new THREE.TorusGeometry(0.055, 0.018, 8, 24),
        color: 0xFF1D89,
        rx: 0.50,
        ry: 0.26,
        speed: 0.37,
        phase: Math.PI * 0.5,
        spin: [0.020, 0.009, 0.017],
      },
      {
        geom:  new THREE.OctahedronGeometry(0.075, 0),
        color: 0x304FFE,
        rx: 0.20,
        ry: 0.62,
        speed: 0.80,
        phase: Math.PI,
        spin: [0.017, 0.026, 0.011],
      },
      {
        geom:  new THREE.TetrahedronGeometry(0.070, 0),
        color: 0xFFEC00,
        rx: 0.48,
        ry: 0.40,
        speed: 0.45,
        phase: Math.PI * 1.5,
        spin: [0.024, 0.013, 0.019],
      },
    ];

    this._orbitals = defs.map(def => {
      const mat = new THREE.MeshStandardMaterial({
        color:            new THREE.Color(def.color),
        emissive:         new THREE.Color(def.color),
        emissiveIntensity: 0.9,
        transparent:      true,
        opacity:          0.92,
        roughness:        0.15,
        metalness:        0.65,
      });
      const mesh = new THREE.Mesh(def.geom, mat);
      mesh.visible = false;
      this._scene.add(mesh);
      return { mesh, mat, ...def };
    });
  }

  /**
   * _updateOrbitals(t, aspect, level, visible)
   * ───────────────────────────────────────────
   * Positions each orbital on its elliptical path and updates its emissive
   * intensity with the audio level. Pass visible=false to hide all orbitals
   * (selfie mode).
   *
   * Orbit formula:
   *   x = cos(t * speed + phase) * rx * aspect
   *   y = sin(t * speed + phase) * ry
   * Each shape also has independent spin on all three axes.
   *
   * Audio pulse: scale inflates by up to 40% at peak level so each shape
   * "breathes" with the sound independently of its orbital position.
   */
  _updateOrbitals(t, aspect, level, visible) {
    const scalePulse = 1 + level * 0.6;

    this._orbitals.forEach((o) => {
      if (!visible) {
        o.mesh.visible = false;
        return;
      }

      o.mesh.visible = true;
      const theta = t * o.speed + o.phase;

      o.mesh.position.x = Math.cos(theta) * o.rx * aspect;
      o.mesh.position.y = Math.sin(theta) * o.ry;
      o.mesh.position.z = Math.sin(theta * 0.7 + o.phase) * 0.3; // subtle Z depth

      o.mesh.scale.setScalar(scalePulse);

      o.mesh.rotation.x += o.spin[0];
      o.mesh.rotation.y += o.spin[1];
      o.mesh.rotation.z += o.spin[2];

      // Emissive intensity pulses with audio — always clearly visible (min 0.6)
      o.mat.emissiveIntensity = 0.6 + level * 0.8;
      // Opacity stays high so shapes read against the camera feed and Hydra
      o.mat.opacity = 0.85 - level * 0.25;
    });
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
