/**
 * Next.js runs this once per server process, before anything else.
 *
 * Node's default for an unhandled promise rejection is to CRASH the process.
 * In a container that means every user's request dies because one background
 * task hiccuped — a Jupiter timeout should never take the site down. These
 * handlers turn a fatal crash into a logged incident.
 *
 * This is a safety net, not a licence to ignore errors: everything it catches
 * is a bug worth fixing, so it logs loudly with a stack.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  process.on("unhandledRejection", (reason) => {
    console.error(
      "[unhandledRejection] survived — this is a bug, but the server stays up:",
      reason instanceof Error ? reason.stack : reason
    );
  });

  process.on("uncaughtException", (err) => {
    // Deliberately does not exit: an uncaught throw in one request handler
    // must not terminate the process serving everyone else.
    console.error("[uncaughtException] survived — this is a bug:", err?.stack ?? err);
  });

  console.log("[instrumentation] crash guards installed");

  // Start the background engines AT BOOT, not on first page view. They used
  // to start lazily from getPortfolio/invest, which meant a container that
  // restarted overnight ran no exit-rule checks, no mirror syncs and no
  // treasury cycles until a human happened to load a page — a stop-loss that
  // fires only when someone is watching is not a stop-loss.
  import("./src/lib/portfolio")
    .then((m) => m.ensureRulesEngine())
    .catch((e) => console.error("[instrumentation] engine start failed:", e));
}
