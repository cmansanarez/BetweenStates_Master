/**
 * threeSetup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Three.js renderer for the 3D object layer.
 *
 * FEATURES
 * ─────────
 * • GLB face mask — tracks detected face in selfie mode, orbits screen in rear mode
 * • Dynamic PointLight — color and intensity driven by state + audio every frame
 * • 4 geometric orbitals — icosahedron, torus, octahedron, tetrahedron
 * • Particle system — 80 points emitted from face/mask position, audio-reactive
 * • Raycaster — tap any orbital or mask for a scale-burst effect
 * • Collapse burst — all orbitals scale up on entering 'collapse' state
 * • Orbital visibility toggle — public toggleOrbitals() for the UI button
 *
 * LAYER POSITION
 * ──────────────
 * Sits on #three-canvas at z-index 2 — above the Hydra canvas and camera feed.
 * alpha: true keeps the canvas transparent where nothing is rendered.
 * pointer-events: none lets taps fall through to the document.
 *
 * COORDINATE SYSTEM
 * ─────────────────
 * OrthographicCamera: world-space x spans ±aspect, y spans ±1.
 * arState face coords (0–1) map directly to world space with simple arithmetic.
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
    this._camera   = null;

    // GLB model
    this._object     = null;
    this._normScale  = null;
    this._materials  = [];
    this._modelMeshes = [];    // flat list of Mesh children for raycasting

    // Render loop
    this._raf        = null;
    this._time       = 0;

    // Live state references set by start()
    this._arState    = null;
    this._audioState = null;
    this._stateStore = null;

    // Geometric orbital shapes
    this._orbitals        = [];
    this._orbitalsVisible = true;   // toggled by UI button via toggleOrbitals()

    // Dynamic light
    this._pointLight = null;

    // Raycaster for tap-to-burst
    this._raycaster = new THREE.Raycaster();
    this._burstMap  = new Map();    // mesh.uuid → burst scale (>1, decays to 1)

    // Collapse state burst — applied to all orbitals when entering 'collapse'
    this._collapseBurstScale = 1.0;
    this._prevState          = 'idle';

    // Particle system
    this._particles         = null;
    this._particleMat       = null;
    this._particleCount     = 80;
    this._particlePositions = null;
    this._particleVelocities = null;
    this._particleLives     = null;
    this._particleMaxLives  = null;
    this._nextParticle      = 0;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * init()
   * ──────
   * Creates renderer, camera, scene, lights, orbitals, and particles.
   * Call once on page load — no permissions required.
   */
  init() {
    this._renderer = new THREE.WebGLRenderer({
      canvas:    this._canvas,
      alpha:     true,
      antialias: true,
    });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.setClearColor(0x000000, 0);

    const aspect = window.innerWidth / window.innerHeight;
    this._camera = new THREE.OrthographicCamera(
      -aspect, aspect,
       1,      -1,
       0.1,    100
    );
    this._camera.position.z = 5;

    this._scene = new THREE.Scene();

    // Reduced static lights — PointLight does most of the dramatic work
    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this._scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(1, 2, 3);
    this._scene.add(key);

    // Dynamic PointLight — color matches current state, intensity tracks audio
    this._pointLight = new THREE.PointLight(0x44FFD1, 2.0, 8);
    this._pointLight.position.set(0, 0, 3);
    this._scene.add(this._pointLight);

    window.addEventListener('resize', () => this._onResize());

    this._setupOrbitals();
    this._setupParticles();
  }

  /**
   * loadModel(path)
   * ────────────────
   * Loads a GLB asset. The model is normalised to a 1-unit bounding box on
   * load so scale calculations are predictable regardless of source asset size.
   */
  loadModel(path) {
    const loader = new GLTFLoader();
    loader.load(
      path,
      (gltf) => {
        this._object = gltf.scene;

        const box    = new THREE.Box3().setFromObject(this._object);
        const size   = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        const maxDim = Math.max(size.x, size.y, size.z);
        this._normScale = 1 / maxDim;
        this._object.scale.setScalar(this._normScale);
        this._object.position.copy(center).multiplyScalar(-this._normScale);

        this._materials   = [];
        this._modelMeshes = [];

        this._object.traverse((child) => {
          if (!child.isMesh) return;
          this._modelMeshes.push(child);
          const mats = Array.isArray(child.material)
            ? child.material
            : [child.material];
          mats.forEach((mat) => {
            mat.transparent = true;
            if ('emissive' in mat) {
              mat.emissive          = new THREE.Color(0x000000);
              mat.emissiveIntensity = 0;
            }
            this._materials.push(mat);
          });
        });

        this._object.visible = false;
        this._scene.add(this._object);
        console.log(`[Three] Model loaded: ${path}`);
      },
      undefined,
      (err) => console.error('[Three] Model load error:', err)
    );
  }

  /**
   * start(arState, audioState, stateStore)
   * ────────────────────────────────────────
   * Begins the render loop. Call after user gesture, inside app.js _start().
   */
  start(arState, audioState, stateStore) {
    this._arState    = arState;
    this._audioState = audioState;
    this._stateStore = stateStore;
    this._loop();
  }

  /** stop() — cancels the render loop (e.g. during camera switch) */
  stop() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }

  /**
   * handleTap(clientX, clientY)
   * ────────────────────────────
   * Converts screen coords to NDC, raycasts against visible orbitals and the
   * GLB mask, and triggers a scale-burst on whatever is hit.
   * Called from app.js tap handler with the event's client coordinates.
   */
  handleTap(clientX, clientY) {
    const ndcX =  (clientX / window.innerWidth)  * 2 - 1;
    const ndcY = -(clientY / window.innerHeight) * 2 + 1;
    this._raycaster.setFromCamera({ x: ndcX, y: ndcY }, this._camera);

    // Orbital meshes
    const orbitalMeshes = this._orbitals
      .filter(o => o.mesh.visible)
      .map(o => o.mesh);
    const orbitalHits = this._raycaster.intersectObjects(orbitalMeshes);

    if (orbitalHits.length > 0) {
      // Find which orbital group was hit and burst its root mesh
      const hitMesh = orbitalHits[0].object;
      const orbital = this._orbitals.find(o => o.mesh === hitMesh);
      if (orbital) this._burstMap.set(orbital.mesh.uuid, 3.5);
      return;
    }

    // GLTF model (recursive — model may have nested mesh children)
    if (this._object?.visible && this._modelMeshes.length) {
      const modelHits = this._raycaster.intersectObjects(this._modelMeshes);
      if (modelHits.length > 0) {
        this._burstMap.set('_model_', 3.5);
      }
    }
  }

  /**
   * toggleOrbitals()
   * ─────────────────
   * Flips orbital visibility. Returns the new state (true = visible).
   * Only affects rear-camera mode — selfie mode always hides orbitals.
   */
  toggleOrbitals() {
    this._orbitalsVisible = !this._orbitalsVisible;
    return this._orbitalsVisible;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    this._update();
    this._renderer.render(this._scene, this._camera);
  }

  _update() {
    if (!this._object || !this._arState || !this._normScale) return;

    this._time++;
    const ar     = this._arState;
    const aspect = window.innerWidth / window.innerHeight;
    const t      = this._time / 60;
    const level  = this._audioState?.level ?? 0;
    const bass   = this._audioState?.bass  ?? 0;
    const state  = this._stateStore?.current ?? 'idle';
    const tint   = ThreeSetup.STATE_COLORS[state] ?? ThreeSetup.STATE_COLORS.idle;

    // ── State change detection ───────────────────────────────────────────────
    if (state !== this._prevState) {
      if (state === 'collapse') {
        // Burst all orbitals on entering collapse — unmissable visual event
        this._collapseBurstScale = 3.0;
        this._orbitals.forEach(o => this._burstMap.set(o.mesh.uuid, 3.5));
      }
      this._prevState = state;
    }

    // Decay collapse burst (exponential, ~20 frames to settle)
    if (this._collapseBurstScale > 1.001) {
      this._collapseBurstScale = 1 + (this._collapseBurstScale - 1) * 0.92;
      if (this._collapseBurstScale < 1.001) this._collapseBurstScale = 1.0;
    }

    // Decay individual tap bursts
    for (const [uuid, scale] of this._burstMap) {
      const next = 1 + (scale - 1) * 0.88;
      if (next < 1.05) this._burstMap.delete(uuid);
      else this._burstMap.set(uuid, next);
    }

    // ── Dynamic PointLight ───────────────────────────────────────────────────
    this._pointLight.color.copy(tint);
    this._pointLight.intensity = 1.0 + level * 3.0 + bass * 1.5;

    // Light follows the face in selfie mode, the orbiting mask in rear mode
    const isRear = ar.facingMode === 'environment';
    if (isRear && this._object) {
      this._pointLight.position.x = this._object.position.x;
      this._pointLight.position.y = this._object.position.y;
    } else if (ar.faceDetected) {
      this._pointLight.position.x = (ar.faceAnchorX * 2 - 1) * aspect;
      this._pointLight.position.y = -(ar.faceAnchorY * 2 - 1);
    }

    // ── GLB mask material ────────────────────────────────────────────────────
    if (this._materials.length) {
      const audioFactor = Math.min(Math.pow(level * 8, 0.4), 1);
      // FIXED: loud audio = MORE opaque (was 0.85→0.10, now 0.55→1.0)
      const opacity     = 0.55 + audioFactor * 0.45;
      const emissiveInt = 0.3 + audioFactor * 0.55;

      this._materials.forEach((mat) => {
        mat.opacity = opacity;
        if ('emissive' in mat) {
          mat.emissive.copy(tint);
          mat.emissiveIntensity = emissiveInt;
        }
      });
    }

    // ── Object placement ─────────────────────────────────────────────────────
    if (isRear) {
      // REAR-CAMERA: mask orbits screen centre; companions also orbit
      this._object.visible = true;

      const ORBIT_SPEED = 0.4;
      const ORBIT_X     = aspect * 0.45;
      const ORBIT_Y     = 0.45;
      const ORBIT_SCALE = 0.35;
      const scalePulse  = 1 + level * 0.8;
      const modelBurst  = this._burstMap.get('_model_') ?? 1.0;

      this._object.position.x = Math.cos(t * ORBIT_SPEED) * ORBIT_X;
      this._object.position.y = Math.sin(t * ORBIT_SPEED) * ORBIT_Y;
      this._object.position.z = 0;
      this._object.scale.setScalar(
        this._normScale * ORBIT_SCALE * scalePulse * modelBurst * this._collapseBurstScale
      );
      this._object.rotation.x += 0.010;
      this._object.rotation.y += 0.018;
      this._object.rotation.z += 0.005;

      this._updateOrbitals(t, aspect, level, true);

    } else {
      // SELFIE: mask tracks detected face; orbitals hidden
      this._updateOrbitals(t, aspect, level, false);

      if (ar.faceDetected) {
        this._object.visible = true;
        const modelBurst = this._burstMap.get('_model_') ?? 1.0;
        this._object.position.x = (ar.faceX * 2 - 1) * aspect;
        this._object.position.y = -(ar.faceY * 2 - 1);
        this._object.position.z = 0;
        this._object.scale.setScalar(
          this._normScale * ar.faceSize * 2.0 * modelBurst
        );
        this._object.rotation.z = -ar.headTilt * 0.4;
      } else {
        this._object.visible = false;
      }
    }

    // ── Particles ────────────────────────────────────────────────────────────
    this._updateParticles(t, aspect);
  }

  // ── Static palette — shared between GLB material tint, orbitals, particles ─
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
   * Creates four geometric meshes. Shape→color map mirrors the state palette
   * so all four hues are always visible simultaneously in rear-camera mode.
   *   Icosahedron → aqua  (idle)
   *   Torus       → pink  (distortion)
   *   Octahedron  → blue  (emergence)
   *   Tetrahedron → yellow (collapse)
   */
  _setupOrbitals() {
    const defs = [
      {
        geom:  new THREE.IcosahedronGeometry(0.065, 1),
        color: 0x44FFD1,
        rx: 0.32, ry: 0.55, speed: 0.62, phase: 0,
        spin: [0.014, 0.022, 0.007],
      },
      {
        geom:  new THREE.TorusGeometry(0.055, 0.018, 8, 24),
        color: 0xFF1D89,
        rx: 0.50, ry: 0.26, speed: 0.37, phase: Math.PI * 0.5,
        spin: [0.020, 0.009, 0.017],
      },
      {
        geom:  new THREE.OctahedronGeometry(0.075, 0),
        color: 0x304FFE,
        rx: 0.20, ry: 0.62, speed: 0.80, phase: Math.PI,
        spin: [0.017, 0.026, 0.011],
      },
      {
        geom:  new THREE.TetrahedronGeometry(0.070, 0),
        color: 0xFFEC00,
        rx: 0.48, ry: 0.40, speed: 0.45, phase: Math.PI * 1.5,
        spin: [0.024, 0.013, 0.019],
      },
    ];

    this._orbitals = defs.map(def => {
      const mat = new THREE.MeshStandardMaterial({
        color:             new THREE.Color(def.color),
        emissive:          new THREE.Color(def.color),
        emissiveIntensity: 0.9,
        transparent:       true,
        opacity:           0.92,
        roughness:         0.15,
        metalness:         0.65,
      });
      const mesh = new THREE.Mesh(def.geom, mat);
      mesh.visible = false;
      this._scene.add(mesh);
      return { mesh, mat, ...def };
    });
  }

  /**
   * _setupParticles()
   * ──────────────────
   * Creates a THREE.Points system backed by a BufferGeometry whose position
   * array is updated every frame. Dead particles are pushed to z=-100 so
   * they are behind the camera and not rendered.
   */
  _setupParticles() {
    const COUNT = this._particleCount;

    this._particlePositions  = new Float32Array(COUNT * 3);
    this._particleVelocities = new Float32Array(COUNT * 3);
    this._particleLives      = new Float32Array(COUNT);
    this._particleMaxLives   = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
      this._particlePositions[i * 3 + 2] = -100;  // off-screen until spawned
      this._particleLives[i] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(this._particlePositions, 3)
    );

    this._particleMat = new THREE.PointsMaterial({
      color:       0x44FFD1,
      size:        0.032,
      transparent: true,
      opacity:     0.85,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
    });

    this._particles = new THREE.Points(geo, this._particleMat);
    this._scene.add(this._particles);
  }

  /**
   * _updateParticles(t, aspect)
   * ────────────────────────────
   * Spawns new particles at the face anchor (selfie) or orbiting mask (rear).
   * Emission rate scales with bass energy. Each particle drifts outward and
   * fades by decrementing its life counter. Dead particles are parked off-screen.
   */
  _updateParticles(t, aspect) {
    if (!this._particles) return;

    const level  = this._audioState?.level ?? 0;
    const bass   = this._audioState?.bass  ?? 0;
    const state  = this._stateStore?.current ?? 'idle';
    const ar     = this._arState;
    const isRear = ar?.facingMode === 'environment';

    // Color + opacity track state
    this._particleMat.color.copy(ThreeSetup.STATE_COLORS[state]);
    this._particleMat.opacity = 0.55 + level * 0.40;

    // Determine emitter position
    let emitX = 0, emitY = 0, shouldEmit = false;

    if (!isRear && ar?.faceDetected) {
      emitX = (ar.faceAnchorX * 2 - 1) * aspect;
      emitY = -(ar.faceAnchorY * 2 - 1);
      shouldEmit = true;
    } else if (isRear && this._object?.visible) {
      emitX = this._object.position.x;
      emitY = this._object.position.y;
      shouldEmit = true;
    }

    // Spawn particles — burst rate driven by bass + overall level
    if (shouldEmit) {
      const emitCount = Math.floor(bass * 5 + level * 2);
      for (let e = 0; e < emitCount; e++) {
        const idx   = this._nextParticle;
        this._nextParticle = (this._nextParticle + 1) % this._particleCount;

        const angle = Math.random() * Math.PI * 2;
        const speed = 0.004 + bass * 0.024;

        this._particlePositions[idx * 3]     = emitX;
        this._particlePositions[idx * 3 + 1] = emitY;
        this._particlePositions[idx * 3 + 2] = 0.1;

        this._particleVelocities[idx * 3]     = Math.cos(angle) * speed;
        this._particleVelocities[idx * 3 + 1] = Math.sin(angle) * speed;
        this._particleVelocities[idx * 3 + 2] = (Math.random() - 0.5) * 0.003;

        this._particleLives[idx]    = 1.0;
        this._particleMaxLives[idx] = 35 + Math.random() * 65;   // 35–100 frames
      }
    }

    // Advance all live particles; park dead ones off-screen
    for (let i = 0; i < this._particleCount; i++) {
      if (this._particleLives[i] <= 0) {
        this._particlePositions[i * 3 + 2] = -100;
        continue;
      }
      this._particlePositions[i * 3]     += this._particleVelocities[i * 3];
      this._particlePositions[i * 3 + 1] += this._particleVelocities[i * 3 + 1];
      this._particlePositions[i * 3 + 2] += this._particleVelocities[i * 3 + 2];

      this._particleLives[i] -= 1.0 / this._particleMaxLives[i];
      if (this._particleLives[i] < 0) this._particleLives[i] = 0;
    }

    // Signal Three.js to re-upload the updated positions to the GPU
    this._particles.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * _updateOrbitals(t, aspect, level, visible)
   * ───────────────────────────────────────────
   * Positions each orbital on its elliptical path and updates emissive + scale.
   * visible = false in selfie mode (camera facing user). _orbitalsVisible toggle
   * applies on top of the mode-based visibility.
   *
   * Scale multiplication order:
   *   audioScalePulse × collapseBurstScale × perMeshBurstFromRaycaster
   */
  _updateOrbitals(t, aspect, level, visible) {
    const effectiveVisible = visible && this._orbitalsVisible;
    const scalePulse = (1 + level * 0.6) * this._collapseBurstScale;

    this._orbitals.forEach((o) => {
      if (!effectiveVisible) {
        o.mesh.visible = false;
        return;
      }

      o.mesh.visible = true;
      const theta = t * o.speed + o.phase;

      o.mesh.position.x = Math.cos(theta) * o.rx * aspect;
      o.mesh.position.y = Math.sin(theta) * o.ry;
      o.mesh.position.z = Math.sin(theta * 0.7 + o.phase) * 0.3;

      // Apply per-mesh tap-burst on top of collapse + audio pulse
      const tapBurst = this._burstMap.get(o.mesh.uuid) ?? 1.0;
      o.mesh.scale.setScalar(scalePulse * tapBurst);

      o.mesh.rotation.x += o.spin[0];
      o.mesh.rotation.y += o.spin[1];
      o.mesh.rotation.z += o.spin[2];

      o.mat.emissiveIntensity = 0.6 + level * 0.8;
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
