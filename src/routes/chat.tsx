import { createFileRoute, redirect } from "@tanstack/react-router";

/** One instruction box lives beside the actual browser. */
export const Route = createFileRoute("/chat")({
  beforeLoad: () => { throw redirect({ to: "/browser" }); },
});
