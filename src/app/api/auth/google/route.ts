import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { googleAuthUrl, googleEnabled } from "@/lib/google";

export async function GET(req: Request) {
  if (!googleEnabled()) {
    return NextResponse.redirect(new URL("/login?error=google-unconfigured", req.url));
  }
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("mb_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(googleAuthUrl(state));
}
