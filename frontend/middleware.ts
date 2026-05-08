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

  // backendUserId present = user completed onboarding. Skip backend calls to
  // avoid Middleware timeout when Render cold-starts (free tier sleeps).
  if (pathname === "/onboarding") {
    return Response.redirect(new URL("/dashboard", req.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
