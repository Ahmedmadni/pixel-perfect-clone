import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, MOCK_MODE } from "./api/client";
import {
  canSend,
  initialControl,
  type ControlEvent,
  type ControlSnapshot,
} from "./control-machine";

/**
 * The runtime is authoritative in real mode.
 * Never publish a local transition until the server confirms it.
 */
type ControlContextValue = {
  snap: ControlSnapshot;
  send: (event: ControlEvent) => Promise<void>;
  connected: boolean;
  pending: boolean;
};

const Ctx = createContext<ControlContextValue | null>(null);

export function ControlProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<ControlSnapshot>(initialControl);
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const requestEpoch = useRef(0);

  const refresh = useCallback(async () => {
    if (MOCK_MODE || pendingRef.current) return;
    const epoch = ++requestEpoch.current;
    try {
      const status = await api.agentStatus();
      if (!status.snapshot) throw new Error("Missing authoritative control snapshot");
      if (epoch !== requestEpoch.current || pendingRef.current) return;
      setSnap(status.snapshot);
      setConnected(true);
    } catch {
      if (epoch === requestEpoch.current && !pendingRef.current) setConnected(false);
    }
  }, []);

  useEffect(() => {
    if (MOCK_MODE) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("paw-token-updated", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("paw-token-updated", onFocus);
      requestEpoch.current++;
    };
  }, [refresh]);

  const send = useCallback(async (event: ControlEvent) => {
    if (pendingRef.current) return;
    if (MOCK_MODE) { toast.error("المعاينة غير متصلة بالمتصفح الحقيقي"); return; }
    if (!MOCK_MODE && !connected) {
      toast.error("لا يمكن تغيير التحكم دون اتصال مؤكد بالخادم المحلي");
      return;
    }
    if (!canSend(snap.state, event.type)) {
      toast.error(`انتقال غير مسموح: ${snap.state} ← ${event.type}`);
      return;
    }
    pendingRef.current = true;
    setPending(true);
    requestEpoch.current++; // Invalidate an in-flight poll.
    try {
      const result = await api.sendControl(event);
      if (!result.snapshot) throw new Error("Missing authoritative control response");
      setSnap(result.snapshot);
      setConnected(true);
    } catch {
      setConnected(false); // Fail closed; never show an unconfirmed transition.
      toast.error("لم يؤكد الخادم انتقال التحكم. تحقق من الاتصال ثم حاول مجددًا.");
    } finally {
      pendingRef.current = false;
      setPending(false);
      void refresh();
    }
  }, [connected, snap.state, refresh]);

  return <Ctx.Provider value={{ snap, send, connected, pending }}>{children}</Ctx.Provider>;
}

export function useControl() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useControl outside ControlProvider");
  return c;
}
