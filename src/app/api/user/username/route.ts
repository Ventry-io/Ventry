import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma/prisma";
import { getSession } from "@/lib/auth/session";
import { usernameSchema } from "@/types/schemas/signup";
import { isUsernameAvailable } from "@/lib/user/unique-name";
import { changeUsername } from "@/lib/user/change-username";

const schema = z.object({
  username: usernameSchema,
});

export async function GET(req: NextRequest) {
  const parsed = schema.safeParse({ username: req.nextUrl.searchParams.get("username") });
  if (!parsed.success) return NextResponse.json({ available: false }, { status: 400 });
  return NextResponse.json({ available: await isUsernameAvailable(parsed.data.username) }, { headers: { "Cache-Control": "no-store" } });
}

// PATCH: Change the current user's username. Kept separate from the general
// PATCH /api/user route since a username change has side effects (uniqueness
// check, 90-day reservation of the old handle via changeUsername()) that
// shouldn't silently ride along with unrelated profile field edits.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Invalid content type" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.treeifyError(parsed.error) }, { status: 400 });
  }

  const userId = session.user.id;
  const { username } = parsed.data;

  const currentUser = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  if (currentUser?.username === username) {
    return NextResponse.json({ success: true }, { status: 200 });
  }

  if (!(await isUsernameAvailable(username, userId))) {
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  await changeUsername(userId, username);

  return NextResponse.json({ success: true }, { status: 200 });
}
