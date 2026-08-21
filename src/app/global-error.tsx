"use client";

import { useEffect } from "react";

/**
 * Last line of defence — catches errors thrown by the root layout itself,
 * where the normal error boundary cannot run. Ships its own <html>/<body>
 * and inline styles because no layout (and therefore no CSS) is guaranteed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#07090d",
          color: "#f4f6fa",
          fontFamily: "system-ui, -apple-system, sans-serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 460 }}>
          <div style={{ fontSize: 13, letterSpacing: "0.14em", color: "#6f7889" }}>BASKET</div>
          <h1 style={{ fontSize: 30, margin: "14px 0 0", letterSpacing: "-0.03em" }}>
            The app failed to load
          </h1>
          <p style={{ color: "#aab3c2", fontSize: 14, lineHeight: 1.6, marginTop: 12 }}>
            Your funds and positions are safe — this is a front-end failure. Reloading usually
            fixes it.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 26,
              background: "#3d7dff",
              color: "#fff",
              border: 0,
              borderRadius: 12,
              padding: "11px 22px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
