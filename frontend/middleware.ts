import { auth } from "@/auth";

const APP_PREFIXES = ["/dashboard", "/settings", "/coach", "/activities", "/onboarding"];

function isAppRoute(pathname: string): boolean {
  return APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default auth(async (req) => {
  const { pathname } = req.nextUrl;

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
    const [gRes, aiRes] = await Promise.all([
      fetch(`${base}/api/auth/garmin/status`, {
        headers: { "X-User-Id": backendUserId },
        cache: "no-store",
      }),
      fetch(`${base}/api/auth/ai/status`, {
        headers: { "X-User-Id": backendUserId },
        cache: "no-store",
      }),
    ]);

    const g = (await gRes.json()) as { active?: boolean };
    const ai = (await aiRes.json()) as { configured?: boolean };

    const garminOk = g.active === true;
    const aiOk = ai.configured === true;
    const onboardingDone = garminOk && aiOk;

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
    if (isAppRoute(pathname) && pathname !== "/onboarding") {
      return Response.redirect(new URL("/onboarding", req.url));
    }
  }
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
