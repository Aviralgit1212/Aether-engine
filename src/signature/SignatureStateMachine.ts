/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from "../core/Config";

export type MachineState =
  | "IDLE"
  | "GATHERING"
  | "READY"
  | "HOLDING_FIST"
  | "COMPRESSING"
  | "VIBRATING"
  | "VIBRATION_DECAY"
  | "STILL"
  | "FORMING_TEXT"
  | "TEXT_HOLD"
  | "DISSOLVING";

export class SignatureStateMachine {
  private currentState: MachineState = "IDLE";
  private stateTimer: number = 0.0; // Seconds spent in current state
  private fistHoldTimer: number = 0.0; // Seconds holding fist in READY state
  private debug: boolean = true; // Enabled by default for development

  // Listeners for state transitions (e.g. to sample text or clear targets)
  private onStateChangeCallback: ((from: MachineState, to: MachineState) => void) | null = null;

  public registerOnStateChange(cb: (from: MachineState, to: MachineState) => void) {
    this.onStateChangeCallback = cb;
  }

  public getState(): MachineState {
    return this.currentState;
  }

  public getStateProgress(): number {
    // Returns progress fraction (0 to 1) for timed states, or 0 for interactive states
    switch (this.currentState) {
      case "COMPRESSING":
        return Math.min(1.0, this.stateTimer / Config.STAGE_COMPRESS_DURATION);
      case "VIBRATING":
        return Math.min(1.0, this.stateTimer / Config.STAGE_VIBRATE_DURATION);
      case "VIBRATION_DECAY":
        return Math.min(1.0, this.stateTimer / Config.STAGE_VIBRATE_DECAY_DURATION);
      case "STILL":
        return Math.min(1.0, this.stateTimer / Config.STAGE_STILL_DURATION);
      case "FORMING_TEXT":
        return Math.min(1.0, this.stateTimer / Config.STAGE_FORMING_DURATION);
      case "TEXT_HOLD":
        return Math.min(1.0, this.stateTimer / Config.STAGE_TEXT_HOLD_DURATION);
      case "DISSOLVING":
        return Math.min(1.0, this.stateTimer / Config.STAGE_DISSOLVE_DURATION);
      case "HOLDING_FIST":
        return Math.min(1.0, this.fistHoldTimer / (Config.FIST_HOLD_DURATION_MS / 1000));
      default:
        return 0.0;
    }
  }

  /**
   * Forces a transition to a new state and logs details
   */
  private transitionTo(nextState: MachineState, context: { energy: number; grip: number; stability: number }) {
    const prevState = this.currentState;
    if (prevState === nextState) return;

    this.currentState = nextState;
    this.stateTimer = 0.0;
    
    if (nextState !== "HOLDING_FIST") {
      this.fistHoldTimer = 0.0;
    }

    if (this.debug) {
      console.log(
        `%c[STATE TRANSITION] ${prevState} ➔ ${nextState} | Time: ${new Date().toLocaleTimeString()} | Energy: ${context.energy.toFixed(1)}% | Grip: ${context.grip.toFixed(2)} | Stability: ${context.stability.toFixed(3)}`,
        "color: #D4AF37; font-weight: bold; background: #111; padding: 2px 5px; border-radius: 3px;"
      );
    }

    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(prevState, nextState);
    }
  }

  /**
   * Core state updates. Evaluates transitions based on inputs and state timers.
   * Runs inside Engine update step.
   * @param dt delta time in seconds
   */
  public update(
    dt: number,
    handDetected: boolean,
    energyLevel: number, // 0 to 100
    gripValue: number, // 0 to 1
    stability: number // lower is more stable. Epsilon is Config.STABILITY_EPSILON
  ) {
    this.stateTimer += dt;
    const context = { energy: energyLevel, grip: gripValue, stability };

    // Group state behaviors:
    // A. INTERACTIVE STATES (IDLE, GATHERING, READY, HOLDING_FIST)
    // These respond directly to hand tracking input
    if (
      this.currentState === "IDLE" ||
      this.currentState === "GATHERING" ||
      this.currentState === "READY" ||
      this.currentState === "HOLDING_FIST"
    ) {
      if (!handDetected) {
        this.transitionTo("IDLE", context);
        return;
      }

      const hasReadyEnergy = energyLevel >= Config.ENERGY_READY_THRESHOLD * 100.0;
      const isSqueezing = gripValue >= Config.FIST_GRIP_THRESHOLD;
      const isStable = stability <= Config.STABILITY_EPSILON;

      switch (this.currentState) {
        case "IDLE":
          if (handDetected) {
            this.transitionTo("GATHERING", context);
          }
          break;

        case "GATHERING":
          if (hasReadyEnergy) {
            this.transitionTo("READY", context);
          }
          break;

        case "READY":
          if (!hasReadyEnergy) {
            this.transitionTo("GATHERING", context);
          } else if (isSqueezing && isStable) {
            this.fistHoldTimer = 0.0;
            this.transitionTo("HOLDING_FIST", context);
          }
          break;

        case "HOLDING_FIST":
          // CANCELLATION RULES (Section 5.4)
          // Must break out if grip is released, hand moves too fast, or energy drops
          if (!isSqueezing || !isStable || !hasReadyEnergy) {
            if (this.debug) {
              const reason = !isSqueezing ? "grip released" : !isStable ? "hand unstable" : "energy dispersed";
              console.log(`%c[HOLD CANCELLED] Reason: ${reason}`, "color: #ff5555;");
            }
            this.transitionTo(hasReadyEnergy ? "READY" : "GATHERING", context);
          } else {
            // Tick up fist hold timer
            this.fistHoldTimer += dt;
            const targetHoldSec = Config.FIST_HOLD_DURATION_MS / 1000.0;
            if (this.fistHoldTimer >= targetHoldSec) {
              this.transitionTo("COMPRESSING", context);
            }
          }
          break;
      }
    } 
    // B. SEQUENTIAL SIGNATURE SEQUENCE STATES (Section 5.5)
    // These run on fixed timers, ignoring live hand controls until complete
    else {
      switch (this.currentState) {
        case "COMPRESSING":
          if (this.stateTimer >= Config.STAGE_COMPRESS_DURATION) {
            this.transitionTo("VIBRATING", context);
          }
          break;

        case "VIBRATING":
          if (this.stateTimer >= Config.STAGE_VIBRATE_DURATION) {
            this.transitionTo("VIBRATION_DECAY", context);
          }
          break;

        case "VIBRATION_DECAY":
          if (this.stateTimer >= Config.STAGE_VIBRATE_DECAY_DURATION) {
            this.transitionTo("STILL", context);
          }
          break;

        case "STILL":
          if (this.stateTimer >= Config.STAGE_STILL_DURATION) {
            this.transitionTo("FORMING_TEXT", context);
          }
          break;

        case "FORMING_TEXT":
          if (this.stateTimer >= Config.STAGE_FORMING_DURATION) {
            this.transitionTo("TEXT_HOLD", context);
          }
          break;

        case "TEXT_HOLD":
          if (this.stateTimer >= Config.STAGE_TEXT_HOLD_DURATION) {
            this.transitionTo("DISSOLVING", context);
          }
          break;

        case "DISSOLVING":
          if (this.stateTimer >= Config.STAGE_DISSOLVE_DURATION) {
            // Return to appropriate state depending on whether hand is still there
            if (handDetected) {
              const hasReadyEnergy = energyLevel >= Config.ENERGY_READY_THRESHOLD * 100.0;
              this.transitionTo(hasReadyEnergy ? "READY" : "GATHERING", context);
            } else {
              this.transitionTo("IDLE", context);
            }
          }
          break;
      }
    }
  }


  /** Starts the visual signature sequence directly for the Replay button. */
  public replaySignature(): void {
    const fromState = this.currentState;
    this.currentState = "FORMING_TEXT";
    this.stateTimer = 0;
    this.fistHoldTimer = 0;
    this.onStateChangeCallback?.(fromState, "FORMING_TEXT");
  }

  /**
   * Reset state machine completely
   */
  public reset() {
    this.currentState = "IDLE";
    this.stateTimer = 0.0;
    this.fistHoldTimer = 0.0;
  }
}
export default SignatureStateMachine;
