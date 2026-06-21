import { NextResponse } from "next/server";
import { currentUser } from "../../lib/session";
import { publicUser } from "../../lib/data";

export async function GET() {
  const user = await currentUser();
  return NextResponse.json({ user: user ? publicUser(user) : null });
}
