import { createContext, useCallback, useContext, useEffect, useReducer, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, MOCK_MODE } from "./api/client";
import {
  canSend,
  controlReducer,
  initialControl,
  type ControlEvent,
  type ControlSnapshot,
} from "./control-machine";

type Sync = "mock" | "syncing" | "online" | "offline";
const Ctx = createContext<{ snap: ControlSnapshot; send: (e: ControlEvent) => void; sync: Sync } | null>(null);

type Action = { kind: "event"; e: ControlEvent } | { kind: "replace"; snap: ControlSnapshot };
function reducer(s: ControlSnapshot, a: Action) {
  return a.kind === "replace" ? a.snap : controlReducer(s, a.e);
}

/**
 * Mock mode: local reducer (clearly labeled mock).
 * Real mode: the runtime is authoritative — UI only shows states the server returned.
 * If the runtime is unreachable we display STOPPED (fail-closed), never an active agent.
 */
export function ControlProvider({ children }: { children: ReactNode }) {
  const [snap, dispatch] = useReducer(reducer, initialControl);
  const [sync, setSync] = useState<Sync>(MOCK_MODE ? "mock" : "syncing");

  const failClosed = useCallback(() => {
    setSync("offline");
    dispatch({ kind: "replace", snap: { state: "STOPPED", reason: "الخادم المحلي غير متاح", history: [] } });
  }, []);

  useEffect(() => {
    if (MOCK_MODE) return;
    let alive = true;
    const poll = async () => {
      try {
        const st = await api.agentStatus();
        if (!alive) return;
        if (!st.snapshot) throw new Error("no snapshot");
        dispatch({ kind: "replace", snap: st.snapshot });
        setSync("online");
      } catch {
        if (alive) failClosed();
      }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [failClosed]);

  const send = (e: ControlEvent) => {
    if (MOCK_MODE) {
      if (!canSend(snap.state, e.type)) {
        toast.error(`انتقال غير مسموح: ${snap.state} ← ${e.type}`);
        return;
      }
      dispatch({ kind: "event", e });
      return;
    }
    api
      .sendControl(e)
      .then((r) => dispatch({ kind: "replace", snap: r.snapshot }))
      .catch((err: { status?: number }) => {
        if (err.status === 409) toast.error(`رفض الخادم الانتقال: ${e.type}`);
        else {
          toast.error("تعذر إبلاغ الخادم المحلي بتغيير الحالة");
          failClosed();
        }
      });
  };
  return <Ctx.Provider value={{ snap, send, sync }}>{children}</Ctx.Provider>;
}

export function useControl() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useControl outside ControlProvider");
  return c;
}
