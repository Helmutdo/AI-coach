// Google Cloud Console setup:
// 1. console.cloud.google.com → New Project → APIs & Services → Credentials
// 2. Create OAuth 2.0 Client ID → Web Application
// 3. Authorized redirect URIs:
//    - http://localhost:3001/api/auth/callback/google  (dev)
//    - https://your-app.vercel.app/api/auth/callback/google  (prod)

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

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
    if (!res.ok) return undefined;
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
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
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
