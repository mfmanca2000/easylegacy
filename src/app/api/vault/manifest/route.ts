import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const putSchema = z.object({
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  hmac: z.string().min(1),
});

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const manifest = await prisma.vaultManifest.findFirst({
    orderBy: { updatedAt: "desc" },
    select: { id: true, ciphertext: true, iv: true, hmac: true, updatedAt: true },
  });

  if (!manifest) {
    return NextResponse.json({ manifest: null });
  }

  return NextResponse.json({ manifest });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { ciphertext, iv, hmac } = parsed.data;

  // Upsert: there is only ever one manifest row.
  const existing = await prisma.vaultManifest.findFirst({ select: { id: true } });

  const manifest = existing
    ? await prisma.vaultManifest.update({
        where: { id: existing.id },
        data: { ciphertext, iv, hmac },
        select: { id: true, updatedAt: true },
      })
    : await prisma.vaultManifest.create({
        data: { ciphertext, iv, hmac },
        select: { id: true, updatedAt: true },
      });

  return NextResponse.json({ ok: true, manifest });
}
