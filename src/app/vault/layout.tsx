import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// Server-side session guard for all /vault/* routes.
// Equivalent to the (owner)/layout.tsx described in the spec (Section 4.1).
// VEK unlock is handled client-side in Week 2.
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/");
  }
  return <>{children}</>;
}
