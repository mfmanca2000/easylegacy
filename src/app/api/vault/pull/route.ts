import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const blobType = searchParams.get("type");

  const blobs = await prisma.vaultBlob.findMany({
    where: blobType ? { blobType } : undefined,
    select: { id: true, ciphertext: true, iv: true, blobType: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ blobs });
}
