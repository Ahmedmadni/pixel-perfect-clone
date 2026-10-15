import { createContext, useContext, useReducer, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "./api/client";
import {
  canSend,
  controlReducer,
  initialControl,
  type ControlEvent,
  type ControlSnapshot,
} from "./control-machine";

const Ctx = createContext<{ snap: ControlSnapshot; send: (e: ControlEvent) => void } | null>(null);

export function ControlProvider({ children }: { children: ReactNode }) {
  const [snap, dispatch] = useReducer(controlReducer, initialControl);
  const send = (e: ControlEvent) => {
    if (!canSend(snap.state, e.type)) {
      toast.error(`انتقال غير مسموح: ${snap.state} ← ${e.type}`);
      return;
    }
    dispatch(e);
    api.sendControl(e.type).catch(() => {
      toast.error("تعذر إبلاغ الخادم المحلي بتغيير الحالة");
    });
  };
  return <Ctx.Provider value={{ snap, send }}>{children}</Ctx.Provider>;
}

export function useControl() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useControl outside ControlProvider");
  return c;
}
