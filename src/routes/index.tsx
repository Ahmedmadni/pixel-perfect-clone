import { createFileRoute, redirect } from "@tanstack/react-router";

/** The browser IS the application. No fake dashboard or sample activity. */
export const Route = createFileRoute("/")({
  beforeLoad: () => { throw redirect({to:"/browser"}); },
});
