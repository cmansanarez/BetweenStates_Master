# Between States
### A Queer XR Glitch System

---

## 1. Concept

“Between States” is a mobile-based augmented reality experience that explores identity as fluid, unstable, and resistant to fixed definition.

The project emerges from a tension: identity, particularly queer identity, is often expected to resolve into something stable, legible, and defined. In practice, identity behaves differently. It shifts across contexts, environments, and time.

This work uses glitch not just as an aesthetic, but as a behavioral system.

Glitch becomes:
- a refusal to stabilize
- a disruption of clean form
- a visual language of fragmentation, emergence, and collapse

Instead of rendering identity as a fixed object, the system treats identity as **interference**:
- something that appears through distortion
- something that never fully resolves
- something that exists in continuous transformation

**Core Question:**
What does identity look like when it is allowed to remain unresolved?

---

## 2. User Experience Framework

### Overview

The experience is accessed via a mobile device in the browser.

The user:
1. Opens the experience
2. Grants microphone + motion permissions
3. Points their camera into physical space

At this point, a **glitch-based visual entity begins to emerge**.

---

### Experience States

#### 1. WORLD IN CONTEXT
- Camera shows real-world environment
- No or minimal visual intervention
- System is in a latent state

#### 2. GLITCH EMERGENCE
- A subtle visual disturbance appears
- Abstract forms begin to gather
- Visuals hint at structure, but do not resolve

#### 3. REACTION / DISTORTION
- Audio input (FFT) drives transformation
- Device motion introduces instability
- Visuals respond but resist predictability
- Forms oscillate between body-like and abstract

#### 4. COLLAPSE / BECOMING
- Visual structure breaks down
- Fragmentation increases
- Identity dissolves into glitch abstraction
- No stable form is achieved

---

### Interaction Model

Inputs:
- Microphone (audio levels + frequency bands)
- Device motion (acceleration / orientation)
- Optional: face or image tracking

Behavior:
- System reacts to input, but does not obey it
- Visuals resist control and clarity
- User presence influences the system, but cannot stabilize it

---

### Spatial Orientation

- Visuals are layered over the camera feed
- Initially screen-based overlay (Phase 1)
- Later anchored to:
  - face (identity-focused)
  - image targets or surfaces (environmental extension)

The system should feel like:
- something leaking into reality
- not fully belonging to the physical world
- unstable and reactive

---

## 3. Technical + Artistic Process

### Core Stack

- **Hydra (hydra-synth)**
  - Real-time generative visual engine
  - Enables live-coded, audio-reactive visuals
  - Central to the glitch aesthetic

- **p5.js + p5.sound**
  - Microphone input
  - FFT analysis (bass, mid, treble)
  - Signal processing for interaction

- **MindAR (WebAR)**
  - Face tracking (Phase 1–2)
  - Image tracking (Phase 3+)
  - Anchors visuals in physical space

- **Vite**
  - Development environment
  - Fast iteration and mobile testing

---

### Why This Stack

Hydra:
- Designed for live visuals and performance
- Aligns with artistic practice
- Produces fluid, unstable visual systems

p5:
- Easy access to audio input + FFT
- Lightweight and flexible
- Ideal for mapping input to behavior

MindAR:
- Works in mobile browsers
- No headset required
- Supports identity-focused tracking (face)

Vite:
- Minimal overhead
- Fast dev loop
- Clean modular structure

---

### System Architecture

#### Input Layer
- microphone → FFT (bass, mid, treble)
- device motion → energy values
- tracking → presence detection

#### State Layer
- normalized values (0–1)
- system modes:
  - idle
  - emergence
  - distortion
  - collapse

#### Visual Layer
- Hydra generates visuals
- parameters driven by state

#### AR Layer
- overlays or anchors visuals
- begins as full-screen overlay
- evolves into spatial anchoring

---

## 4. Context & Relevance

This project sits at the intersection of:

### XR / Spatial Computing
- Mobile-based AR as accessible immersive media
- Exploration of space as a canvas for identity

### Live Audiovisual Performance
- Hydra-based visual language
- Audio-reactive systems as expressive medium
- Translation of VJ practice into XR

### Glitch Art
- Glitch as disruption, not decoration
- Refusal of clean rendering
- Embrace of fragmentation and error

### Queer Identity Theory
- Identity as fluid and constructed
- Resistance to binary classification
- Instability as truth, not failure

---

### Contemporary Relevance

The project responds to:
- pressure for identity legibility
- algorithmic classification of bodies and identity
- the expectation of coherence in digital systems

It proposes instead:
- ambiguity
- transformation
- unresolved states as valid existence

---

## 5. Project Scaffold

### Directory Structure
between-states/
├─ src/
│  ├─ main.js
│  ├─ app/
│  ├─ audio/
│  ├─ motion/
│  ├─ state/
│  ├─ visuals/
│  ├─ ar/
│  └─ utils/
├─ index.html
├─ package.json

---

## 6. Development Roadmap

### Milestone 1 — Core Visual + Audio System

Goal:
Establish a working generative system driven by audio

Tasks:
- Setup Vite project
- Integrate Hydra canvas
- Capture microphone input (p5.AudioIn)
- Implement FFT analysis
- Map:
  - bass → scale
  - mid → distortion
  - treble → color/flicker

Output:
- Full-screen Hydra visual responding to sound

---

### Milestone 2 — State System

Goal:
Introduce structured behavior

Tasks:
- Create state store
- Implement state machine
- Define thresholds for:
  - emergence
  - distortion
  - collapse

Output:
- Visual changes tied to system states

---

### Milestone 3 — Motion Interaction

Goal:
Introduce embodiment

Tasks:
- Capture device motion
- Map motion energy to:
  - distortion intensity
  - modulation depth

Output:
- Movement destabilizes visuals

---

### Milestone 4 — AR Integration (Face Tracking)

Goal:
Anchor visuals to identity

Tasks:
- Integrate MindAR face tracking
- Detect face presence
- Trigger emergence state when face detected
- Position visuals relative to face

Output:
- Identity-linked glitch behavior

---

### Milestone 5 — Visual Language Refinement

Goal:
Align visuals with artistic intent

Tasks:
- Introduce:
  - body-like silhouettes
  - fragmentation blocks
  - chromatic aberration
- Refine Hydra patches

Output:
- Cohesive glitch identity aesthetic

---

### MVP Definition

A successful MVP includes:

- Mobile browser experience
- Audio-reactive Hydra visuals
- State-based behavior transitions
- Device motion affecting visuals
- Face tracking influencing system state
- Clear progression:
  idle → emergence → distortion → collapse

---

## 7. Key Principles for Implementation

- Do not aim for realism
- Prioritize behavior over polish
- System should feel unstable, not broken
- Visuals should resist clean interpretation
- Interaction should influence, not control

---

## 8. Future Extensions (Optional)

- Multi-user shared AR state
- Networked audio influence
- Projection + AR hybrid installation
- Performance mode (live-coded Hydra input)

---

## End of Spec