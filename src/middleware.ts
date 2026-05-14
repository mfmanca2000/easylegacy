import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "el_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Fast cookie presence check only — route handlers do the full DB validation.
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/";
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/vault/:path*", "/api/auth/logout", "/vault/:path*"],
};
