import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyOwnerCredentials, createSession } from "@/lib/auth";

const schema = z.object({
  username: z.string().min(1).optional(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const valid = await verifyOwnerCredentials(
    parsed.data.username ?? "",
    parsed.data.password
  );

  if (!valid) {
    await new Promise((r) => setTimeout(r, 400));
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  await createSession();
  return NextResponse.json({ ok: true });
}
