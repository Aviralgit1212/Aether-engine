# Aether Engine V2

A local-first, real-time hand-controlled particle simulation built with React 19, TypeScript, Vite, WebGL2, and MediaPipe HandLandmarker. V2 upgrades the supplied V1 in place; it keeps the original signature state machine and CPU-based particle physics.

## Requirements

- Node.js 20.19+ or 22.12+
- A modern browser with WebGL2 and camera support
- Camera access is available on `localhost` or an HTTPS origin

## Run locally

```bash
npm install
npm run dev
```

Open the local URL Vite prints in the terminal (the configured port is `3000`). Allow camera access. MediaPipe's WASM assets and hand-landmarker model are downloaded from their configured CDNs on first startup; the camera frames are processed locally in the browser and this project does not upload them to a backend.

## Production build and type-check

```bash
npm run lint
npm run build
npm run preview
```

`npm run lint` is `tsc --noEmit`. No new npm dependency was added. `@mediapipe/tasks-vision` is pinned to `0.10.35`, matching the WASM asset URL.

## Controls

- **Engage Camera & Launch**: request webcam access and start the engine.
- **Move hand**: the particle field follows the palm with a spring-damped anchor.
- **Move quickly**: emits an expanding radial ring wave (limited to four active waves).
- **Open palm**: expands the particle cloud and increases fluid drift.
- **Pinch thumb and index finger**: attracts particles toward the pinch midpoint.
- **Stable fist**: the original signature sequence remains: `IDLE → GATHERING → READY → HOLDING_FIST → COMPRESSING → VIBRATING → VIBRATION_DECAY → STILL → FORMING_TEXT → TEXT_HOLD → DISSOLVING`.
- **Signature text field**: change the reveal text (maximum 12 characters, uppercased and saved in `localStorage`). Default: `AVIRAL`.
- **Reset particles**: reset the field, energy estimate and signature state to their starting state.
- **Replay signature**: replay the formation/hold/dissolve sequence without the fist trigger.
- **Bloom / Trails**: toggle visual post-processing.
- **Run benchmark**: test 5,000, 10,000, and 20,000 particles for five seconds each. Results appear in the diagnostics table and in `console.table`.
- **URL benchmark**: append `?bench=1` to the app URL to start the benchmark after the engine starts.

## Particle quality and performance

- The maximum preallocated particle capacity is 20,000; the default active count is 20,000.
- Adaptive levels are `20,000`, `14,000`, `9,000`, and `5,000`.
- The engine steps down when a one-second average is below 45 FPS for two consecutive seconds; it steps up above 58 FPS for five consecutive seconds. A three-second cooldown separates changes.
- Bloom and trails are suppressed at the lowest adaptive quality level.
- Particle positions/velocities/forces are simulated on the CPU. WebGL2 draws particles and runs the offscreen trail/bloom pipeline. This is **not GPU physics**. Stop cleans GL resources and requests context loss; the mounted canvas waits for context restoration before a restart.
- The physics hot loop uses preallocated typed arrays and a shared 64×64 noise flow field. Position, color, size, and depth buffers are allocated up front and updated with `bufferSubData`.

## Telemetry

- **FPS**: render-loop frame count over measured elapsed time.
- **Inference EMA**: exponential moving average of the measured duration of `HandLandmarker.detectForVideo()`.
- **Physics ms**: CPU time spent in energy estimation, state updates, and particle simulation for a frame.
- **Render submit ms**: JavaScript time spent issuing WebGL rendering commands, not a GPU timer-query measurement.
- **Frame p95**: 95th percentile of recent measured requestAnimationFrame intervals.
- **Active particles / quality**: live simulation configuration and current adaptive level.

A displayed zero/emdash before the first measurement means the metric has not yet been measured; the UI does not estimate inference latency from FPS.

## Configuration

`src/core/Config.ts` is the central place for particle capacity, force strengths, gesture thresholds, state timings, flow-grid size, trail fade, bloom strength/threshold, wave lifetime, and burst force. Runtime signature text is stored in browser local storage.

## Main modules

- `src/App.tsx`: React UI, signature input, live telemetry controls.
- `src/components/AetherEngine.tsx`: start/stop/retry lifecycle and canvas ownership.
- `src/core/EngineLoop.ts`: coordinates camera tracking, state transitions, simulation, timing, adaptive quality, and benchmarking.
- `src/hand-tracking/HandTracker.ts`: camera lifecycle, MediaPipe model lifecycle, and actual inference timing.
- `src/hand-tracking/HandGeometry.ts`: converts 21 landmarks into palm, grip, finger extension, movement, pinch, open-palm, and stability values.
- `src/signature/SignatureStateMachine.ts`: retains the V1 trigger/sequence flow and adds replay.
- `src/signature/EnergyEstimator.ts`: particle density estimate and explicit no-hand decay.
- `src/signature/TextTargetSampler.ts`: high-resolution signature rasterization and low-crossing particle-to-target assignment.
- `src/particles/ParticleSystem.ts`: CPU particle forces and integration using preallocated arrays.
- `src/physics/NoiseField.ts`: validated canonical Perlin permutation plus a shared coarse flow field.
- `src/rendering/WebGLRenderer.ts`: video background, persistent particle-only trails, soft point sprites, bloom and additive composite.
- `src/components/DebugOverlay.tsx`: measured diagnostics, quality status and benchmark results.

## Notes

- On systems that do not support floating-point framebuffer attachments, the offscreen pipeline falls back to RGBA8 targets.
- The render timing is the JavaScript-side WebGL submission duration because this implementation does not use the asynchronous GPU timer-query extension.
- Camera permissions and MediaPipe model/WASM network access must be available for the interactive demo. The particle rendering and simulation are local once the app is running.
