// Google Cloud Console setup:
// 1. console.cloud.google.com → New Project → APIs & Services → Credentials
// 2. Create OAuth 2.0 Client ID → Web Application
// 3. Authorized JavaScript origins (Web client):
//    - http://localhost:3000  (y el puerto que uses, ej. :3001)
//    - http://127.0.0.1:3000  (mejor usa solo localhost; el middleware redirige 127.0.0.1→localhost)
// 4. Authorized redirect URIs:
//    - http://localhost:3000/api/auth/callback/google
//    - https://your-app.vercel.app/api/auth/callback/google  (prod)
// Si la app OAuth está en modo "Testing", añade tu Gmail en "Test users".

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * OAuth Client ID es público; aceptamos GOOGLE_CLIENT_ID o NEXT_PUBLIC_GOOGLE_CLIENT_ID
 * (algunos tutoriales solo ponen el prefijo NEXT_PUBLIC_*).
 * El secret nunca debe ser NEXT_PUBLIC_*.
 */
function googleClientId(): string {
  return (
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ||
    ""
  );
}

function googleClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
}

const _googleId = googleClientId();
const _googleSecret = googleClientSecret();
if (process.env.NODE_ENV === "development" && (!_googleId || !_googleSecret)) {
  console.error(
    "[auth] Falta GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET en frontend/.env.local — " +
      "sin client_id Google responde 400 invalid_request. Reinicia `npm run dev` tras guardar."
  );
}

/** Auth.js requires a non-empty secret; env wins, dev-only fallback for local `next dev`. */
function authSecret(): string | undefined {
  const fromEnv =
    process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "development") {
    return "dev-only-insecure-secret-set-AUTH_SECRET-for-production";
  }
  return undefined;
}

async function syncBackendUser(token: {
  id?: string;
  sub?: string;
  email?: string | null;
  name?: string | null;
  picture?: string | null;
}): Promise<string | undefined> {
  const googleId = (token.id as string) || (token.sub as string);
  if (!googleId) return undefined;
  const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/users/me`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        google_id: googleId,
        email: String(token.email ?? ""),
        name: String(token.name ?? ""),
        avatar_url: token.picture ?? null,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(
        "[auth] syncBackendUser failed:",
        res.status,
        errText.slice(0, 500),
        "— is the API running at",
        base,
        "?"
      );
      return undefined;
    }
    const data = (await res.json()) as { id: string };
    return data.id;
  } catch {
    return undefined;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: _googleId,
      clientSecret: _googleSecret,
    }),
  ],
  session: { strategy: "jwt" },
  secret: authSecret(),
  callbacks: {
    async jwt({ token, user, account, profile }) {
      if (user) {
        token.id = user.id ?? token.sub ?? "";
        token.email = user.email ?? token.email;
        token.name = user.name ?? token.name;
        token.picture = user.image ?? token.picture;
      }
      if (account?.provider === "google" && profile && typeof profile === "object") {
        const p = profile as {
          sub?: string;
          email?: string | null;
          name?: string | null;
          picture?: string | null;
        };
        if (p.sub) token.id = p.sub;
        if (p.email !== undefined) token.email = p.email;
        if (p.name !== undefined) token.name = p.name;
        if (p.picture !== undefined) token.picture = p.picture;
      }
      if (!token.backendUserId) {
        const id = await syncBackendUser(token);
        if (id) token.backendUserId = id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? (token.sub as string) ?? "";
        session.user.email = (token.email as string | null | undefined) ?? session.user.email;
        session.user.name = (token.name as string | null | undefined) ?? session.user.name;
        session.user.image = (token.picture as string | null | undefined) ?? session.user.image;
        session.user.backendUserId = token.backendUserId as string | undefined;
      }
      return session;
    },
  },
});
