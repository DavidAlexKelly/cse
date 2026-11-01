import { auth } from "@/client";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Component to render at `/auth/callback`
 *
 * `auth` is the getToken function returned by createPublicOauthClient.
 * It has a `.signIn` property attached to it (Object.assign pattern).
 * Calling auth.signIn() explicitly completes the PKCE code exchange and
 * saves the token, then calling auth() on subsequent requests returns
 * the cached token.
 *
 * FIX NOTE: The original code was correct — auth.signIn() is the right call
 * here. If you were seeing 403s after the callback, the cause was elsewhere
 * (missing dataset resource permission or expired token on tile requests),
 * not in this component.
 */
function AuthCallback(): React.ReactElement {
  const [error, setError] = useState<string | undefined>(undefined);
  const navigate = useNavigate();

  // This effect conflicts with React 18 strict mode in development.
  // https://react.dev/learn/synchronizing-with-effects#how-to-handle-the-effect-firing-twice-in-development
  // In dev you may see two signIn() calls; the second is a no-op because the
  // auth code is single-use and the token is cached after the first exchange.
  useEffect(() => {
    auth
      .signIn()
      .then(() => navigate("/", { replace: true }))
      .catch((e: unknown) => {
        if (e instanceof Error) {
          setError(e.message);
        } else {
          setError(String(e));
        }
      });
  }, [navigate]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "#0d1b2a",
        color: "#e0e0e0",
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
      }}
    >
      {error != null ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#ef9a9a", marginBottom: 8 }}>
            Authentication error
          </div>
          <div style={{ color: "#90a4ae", fontSize: 12 }}>{error}</div>
        </div>
      ) : (
        "Authenticating…"
      )}
    </div>
  );
}

export default AuthCallback;
