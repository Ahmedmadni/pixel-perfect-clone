import { describe, expect, it } from "vitest";
import { CONTROL_STATES, controlReducer, initialControl, nextState } from "./control-machine";

describe("control state machine", () => {
  it("runs the happy path with an approval", () => {
    let s = controlReducer(initialControl, { type: "START_AGENT" });
    expect(s.state).toBe("AGENT_ACTIVE");
    s = controlReducer(s, { type: "REQUEST_APPROVAL", reason: "send message" });
    expect(s.state).toBe("APPROVAL_REQUIRED");
    expect(s.reason).toBe("send message");
    s = controlReducer(s, { type: "APPROVE" });
    expect(s.state).toBe("AGENT_ACTIVE");
    expect(s.history).toHaveLength(3);
  });

  it("emergency stop works from every non-stopped state", () => {
    for (const st of CONTROL_STATES) {
      expect(nextState(st, "EMERGENCY_STOP")).toBe(st === "STOPPED" ? null : "STOPPED");
    }
  });

  it("rejects invalid transitions without changing state", () => {
    const s = controlReducer(initialControl, { type: "APPROVE" });
    expect(s).toBe(initialControl);
    expect(nextState("STOPPED", "START_AGENT")).toBeNull();
  });

  it("recovers from error and stop only via RESET", () => {
    expect(nextState("ERROR", "RESUME")).toBeNull();
    expect(nextState("ERROR", "RESET")).toBe("MANUAL");
    expect(nextState("STOPPED", "RESET")).toBe("MANUAL");
  });

  it("allows manual takeover while agent works", () => {
    expect(nextState("AGENT_ACTIVE", "TAKE_OVER")).toBe("MANUAL");
    expect(nextState("PAUSED", "TAKE_OVER")).toBe("MANUAL");
  });
});
