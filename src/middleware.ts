import { NextResponse, type NextRequest } from "next/server";
import { CSRF_COOKIE } from "@/lib/auth/constants";

/**
 * Issues the CSRF cookie. Server Components cannot set cookies during render,
 * so the double-submit token is minted here and read (never written) by pages.
 * The matching value is embedded in every form and compared server-side in
 * `assertCsrf`.
 */
export function middleware(request: NextRequest) {
  // Expose the path to Server Components so the shell can mark the active nav
  // item without turning the whole layout into a client component.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  if (!request.cookies.get(CSRF_COOKIE)) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    response.cookies.set(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
