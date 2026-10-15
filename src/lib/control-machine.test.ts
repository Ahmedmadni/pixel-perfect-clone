import { describe, expect, it } from "vitest";
import {
  CONTROL_STATES,
  controlReducer,
  initialControl,
  nextState,
  type ControlEventType,
  type ControlState,
} from "./control-machine";

const EVENTS: ControlEventType[] = [
  "START_AGENT",
  "REQUEST_APPROVAL",
  "APPROVE",
  "REJECT",
  "PAUSE",
  "RESUME",
  "TAKE_OVER",
  "EMERGENCY_STOP",
  "FAIL",
  "RESET",
];

/** Full expected matrix. Anything not listed must be rejected (null). */
const EXPECTED: Record<ControlState, Partial<Record<ControlEventType, ControlState>>> = {
  MANUAL: { START_AGENT: "AGENT_ACTIVE", EMERGENCY_STOP: "STOPPED", FAIL: "ERROR" },
  AGENT_ACTIVE: {
    REQUEST_APPROVAL: "APPROVAL_REQUIRED",
    PAUSE: "PAUSED",
    TAKE_OVER: "MANUAL",
    EMERGENCY_STOP: "STOPPED",
    FAIL: "ERROR",
  },
  APPROVAL_REQUIRED: {
    APPROVE: "AGENT_ACTIVE",
    REJECT: "MANUAL",
    TAKE_OVER: "MANUAL",
    EMERGENCY_STOP: "STOPPED",
    FAIL: "ERROR",
  },
  PAUSED: { RESUME: "AGENT_ACTIVE", TAKE_OVER: "MANUAL", EMERGENCY_STOP: "STOPPED", FAIL: "ERROR" },
  STOPPED: { RESET: "MANUAL" },
  ERROR: { RESET: "MANUAL" },
};

describe("control state machine — full matrix", () => {
  for (const st of CONTROL_STATES) {
    for (const ev of EVENTS) {
      const want = EXPECTED[st][ev] ?? null;
      it(`${st} + ${ev} → ${want ?? "rejected"}`, () => {
        expect(nextState(st, ev)).toBe(want);
      });
    }
  }

  it("STOPPED and ERROR can only exit via RESET", () => {
    for (const st of ["STOPPED", "ERROR"] as const) {
      for (const ev of EVENTS) {
        if (ev !== "RESET") expect(nextState(st, ev)).toBeNull();
      }
    }
  });

  it("emergency stop works from every active/recoverable state", () => {
    for (const st of ["MANUAL", "AGENT_ACTIVE", "APPROVAL_REQUIRED", "PAUSED"] as const) {
      expect(nextState(st, "EMERGENCY_STOP")).toBe("STOPPED");
    }
  });
});

describe("controlReducer", () => {
  it("runs the happy path with an approval", () => {
    let s = controlReducer(initialControl, { type: "START_AGENT" });
    s = controlReducer(s, { type: "REQUEST_APPROVAL", reason: "send message" });
    expect(s.state).toBe("APPROVAL_REQUIRED");
    expect(s.reason).toBe("send message");
    s = controlReducer(s, { type: "APPROVE" });
    expect(s.state).toBe("AGENT_ACTIVE");
    expect(s.history).toHaveLength(3);
  });

  it("returns the same object for invalid transitions", () => {
    expect(controlReducer(initialControl, { type: "APPROVE" })).toBe(initialControl);
    const stopped = controlReducer(initialControl, { type: "EMERGENCY_STOP" });
    expect(controlReducer(stopped, { type: "FAIL", error: "x" })).toBe(stopped);
  });
});
