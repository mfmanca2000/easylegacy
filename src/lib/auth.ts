import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

const SESSION_COOKIE = "el_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function verifyOwnerPassword(password: string): Promise<boolean> {
  const hash = process.env.OWNER_PASSWORD_HASH;
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

export async function createSession(): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.authSession.create({ data: { tokenHash, expiresAt } });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export async function getSession(): Promise<{ id: string } | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await prisma.authSession.findUnique({ where: { tokenHash } });

  if (!session || session.expiresAt < new Date()) {
    if (session) {
      await prisma.authSession.delete({ where: { id: session.id } }).catch(() => {});
    }
    return null;
  }

  return { id: session.id };
}

export async function deleteSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const tokenHash = hashToken(token);
    await prisma.authSession.deleteMany({ where: { tokenHash } }).catch(() => {});
  }
  jar.delete(SESSION_COOKIE);
}

export async function requireSession(): Promise<void> {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
