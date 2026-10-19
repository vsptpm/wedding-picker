import { cookies } from "next/headers";
import { SESSION_COOKIE, signOut } from "@/lib/auth";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) signOut(token);
  jar.delete(SESSION_COOKIE);
  // Relative redirect: behind nginx the request URL is the internal 127.0.0.1:3000, so never build an absolute one.
  return new Response(null, { status: 303, headers: { Location: "/login" } });
}
