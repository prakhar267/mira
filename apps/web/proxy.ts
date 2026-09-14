import { type NextRequest, NextResponse } from "next/server";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' blob: https://api.openai.com https://huggingface.co https://*.huggingface.co https://*.hf.co",
  "font-src 'self' data:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
].join("; ");

const securityHeaders = {
  "Content-Security-Policy": contentSecurityPolicy,
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(), payment=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export function proxy(request: NextRequest) {
  // Onboarding is a public form, not an authenticated account. Every account
  // API still enforces its own session; this query flag grants no API access.
  if (request.nextUrl.pathname === "/app" && request.nextUrl.searchParams.get("onboarding") !== "1" && !request.cookies.has("__Host-companaro_session")) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    return NextResponse.redirect(login);
  }

  const response = NextResponse.next();
  for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|assets/|favicon.ico).*)"],
};
