import { NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { SESSION_OPTIONS } from "@/lib/auth";

export async function GET(request) {
  const cookieStore = await cookies();
  const session = await getIronSession(cookieStore, SESSION_OPTIONS);
  session.destroy();
  return NextResponse.redirect(new URL("/", request.url));
}
