import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const blobSchema = z.object({
  entryId: z.string().uuid(),
  category: z.string().min(1),
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  aad: z.string().min(1),
});

const schema = z.object({
  blobs: z.array(blobSchema).min(1).max(500),
});

export async function POST(req: NextRequest) {
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const results = await Promise.all(
    parsed.data.blobs.map(({ entryId, category, ciphertext, iv, aad }) =>
      prisma.vaultBlob.upsert({
        where: { entryId },
        update: { category, ciphertext, iv, aad },
        create: { entryId, category, ciphertext, iv, aad },
        select: { id: true, entryId: true, updatedAt: true },
      })
    )
  );

  return NextResponse.json({ ok: true, blobs: results });
}
