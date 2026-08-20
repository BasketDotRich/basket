// Google OAuth (authorization-code flow, server-side only).
// Enabled when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set in .env.local.
// Redirect URI defaults to http://localhost:3000/api/auth/google/callback —
// it must be registered in the Google Cloud console for the OAuth client.

export function googleEnabled(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

function redirectUri(): string {
  return process.env.GOOGLE_REDIRECT_URI ?? "http://localhost:3000/api/auth/google/callback";
}

export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function googleExchangeCode(code: string): Promise<{
  email: string;
  emailVerified: boolean;
  name: string | null;
} | null> {
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return null;
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) return null;

    const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!infoRes.ok) return null;
    const info = (await infoRes.json()) as {
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    if (!info.email) return null;
    return {
      email: info.email.toLowerCase(),
      emailVerified: !!info.email_verified,
      name: info.name ?? null,
    };
  } catch {
    return null;
  }
}
