import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, signOut } from "@/lib/auth";

export async function POST(req: Request) {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) signOut(token);
  jar.delete(SESSION_COOKIE);
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
