"use client";

import { useRouter } from "next/navigation";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function VaultPage() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 p-4">
      <Shield className="h-16 w-16 text-primary" />
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">Vault</h1>
        <p className="text-muted-foreground text-sm">
          Week 1 scaffold — vault UI coming in Week 2.
        </p>
      </div>
      <Button variant="outline" onClick={handleLogout}>
        Lock vault &amp; sign out
      </Button>
    </main>
  );
}
