import { NextResponse } from "next/server";

import { auth } from "@/auth";

const APP_PREFIXES = ["/dashboard", "/settings", "/coach", "/activities", "/onboarding"];

function isAppRoute(pathname: string): boolean {
  return APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default auth(async (req) => {
  const { pathname } = req.nextUrl;

  /* Google OAuth usa el host de la URL actual como redirect_uri. Si abres 127.0.0.1 pero en
   * Google Console solo está localhost (o al revés), obtienes redirect_uri_mismatch. */
  if (process.env.NODE_ENV === "development" && req.nextUrl.hostname === "127.0.0.1") {
    const url = req.nextUrl.clone();
    url.hostname = "localhost";
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/api/auth")) {
    return;
  }
  if (pathname === "/") {
    return;
  }
  if (!req.auth?.user) {
    return Response.redirect(new URL("/", req.url));
  }

  const backendUserId = req.auth.user.backendUserId;
  if (!backendUserId) {
    if (isAppRoute(pathname) && pathname !== "/onboarding") {
      return Response.redirect(new URL("/onboarding", req.url));
    }
    return;
  }

  const base = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

  try {
    const [gRes, aiRes, stRes] = await Promise.all([
      fetch(`${base}/api/auth/garmin/status`, {
        headers: { "X-User-Id": backendUserId },
        cache: "no-store",
      }),
      fetch(`${base}/api/auth/ai/status`, {
        headers: { "X-User-Id": backendUserId },
        cache: "no-store",
      }),
      fetch(`${base}/api/strava/status`, {
        headers: { "X-User-Id": backendUserId },
        cache: "no-store",
      }),
    ]);

    const g = (await gRes.json()) as { active?: boolean };
    const ai = (await aiRes.json()) as { configured?: boolean };
    const st = (await stRes.json()) as { connected?: boolean };

    const aiOk = ai.configured === true;
    const onboardingDone = aiOk;

    if (!onboardingDone) {
      if (isAppRoute(pathname) && pathname !== "/onboarding") {
        return Response.redirect(new URL("/onboarding", req.url));
      }
      return;
    }

    if (onboardingDone && pathname === "/onboarding") {
      return Response.redirect(new URL("/dashboard", req.url));
    }
  } catch {
    // Backend unreachable — don't know the user's config status.
    // Let the request through rather than redirecting to onboarding on every
    // transient server error. The UI will show its own "unavailable" state.
  }
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
