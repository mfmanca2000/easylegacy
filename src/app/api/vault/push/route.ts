import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const blobSchema = z.object({
  id: z.string().uuid().optional(),
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  blobType: z.enum(["manifest", "entry", "attachment"]).default("entry"),
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
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const { blobs } = parsed.data;

  const results = await Promise.all(
    blobs.map(async (blob) => {
      if (blob.id) {
        return prisma.vaultBlob.upsert({
          where: { id: blob.id },
          update: { ciphertext: blob.ciphertext, iv: blob.iv, blobType: blob.blobType },
          create: { id: blob.id, ciphertext: blob.ciphertext, iv: blob.iv, blobType: blob.blobType },
          select: { id: true, updatedAt: true },
        });
      }
      return prisma.vaultBlob.create({
        data: { ciphertext: blob.ciphertext, iv: blob.iv, blobType: blob.blobType },
        select: { id: true, updatedAt: true },
      });
    })
  );

  return NextResponse.json({ ok: true, blobs: results });
}
