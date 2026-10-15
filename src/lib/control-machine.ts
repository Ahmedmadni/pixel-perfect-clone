/**
 * Agent control state machine. Pure and framework-free so the local runtime
 * (Fastify) can share the exact same transition table.
 */
export const CONTROL_STATES = [
  "MANUAL",
  "AGENT_ACTIVE",
  "APPROVAL_REQUIRED",
  "PAUSED",
  "STOPPED",
  "ERROR",
] as const;
export type ControlState = (typeof CONTROL_STATES)[number];

export type ControlEvent =
  | { type: "START_AGENT" }
  | { type: "REQUEST_APPROVAL"; reason: string }
  | { type: "APPROVE" }
  | { type: "REJECT" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "TAKE_OVER" }
  | { type: "EMERGENCY_STOP" }
  | { type: "FAIL"; error: string }
  | { type: "RESET" };

export type ControlEventType = ControlEvent["type"];

const TABLE: Record<ControlState, Partial<Record<ControlEventType, ControlState>>> = {
  MANUAL: { START_AGENT: "AGENT_ACTIVE" },
  AGENT_ACTIVE: {
    REQUEST_APPROVAL: "APPROVAL_REQUIRED",
    PAUSE: "PAUSED",
    TAKE_OVER: "MANUAL",
  },
  APPROVAL_REQUIRED: { APPROVE: "AGENT_ACTIVE", REJECT: "MANUAL", TAKE_OVER: "MANUAL" },
  PAUSED: { RESUME: "AGENT_ACTIVE", TAKE_OVER: "MANUAL" },
  STOPPED: { RESET: "MANUAL" },
  ERROR: { RESET: "MANUAL" },
};

/** Terminal-until-reset states: the ONLY way out is RESET. */
export const LOCKED_STATES: readonly ControlState[] = ["STOPPED", "ERROR"];

/** Events valid from every non-locked (active or recoverable) state. */
const GLOBAL: Partial<Record<ControlEventType, ControlState>> = {
  EMERGENCY_STOP: "STOPPED",
  FAIL: "ERROR",
};

export function nextState(state: ControlState, event: ControlEventType): ControlState | null {
  const local = TABLE[state][event];
  if (local) return local;
  if (LOCKED_STATES.includes(state)) return null;
  return GLOBAL[event] ?? null;
}

export function canSend(state: ControlState, event: ControlEventType) {
  return nextState(state, event) !== null;
}

export interface ControlSnapshot {
  state: ControlState;
  reason: string | null;
  history: { at: string; from: ControlState; to: ControlState; event: ControlEventType | "STARTUP_RESET" }[];
}

export const initialControl: ControlSnapshot = { state: "MANUAL", reason: null, history: [] };

export function controlReducer(snap: ControlSnapshot, event: ControlEvent): ControlSnapshot {
  const to = nextState(snap.state, event.type);
  if (!to) return snap;
  const reason =
    event.type === "REQUEST_APPROVAL" ? event.reason : event.type === "FAIL" ? event.error : null;
  return {
    state: to,
    reason,
    history: [
      { at: new Date().toISOString(), from: snap.state, to, event: event.type },
      ...snap.history,
    ].slice(0, 100),
  };
}
