"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function HomePage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"choose" | "owner" | "spouse">("choose");

  async function handleOwnerLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username || undefined, password }),
      });
      if (res.ok) {
        router.push("/vault");
      } else {
        const data = await res.json();
        setError(data.error ?? "Login failed");
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "choose") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <Shield className="h-12 w-12 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">EasyLegacy</h1>
            <p className="text-sm text-muted-foreground">
              Encrypted vault — your legacy, secured
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <Button size="lg" onClick={() => setMode("owner")}>
              <Lock className="mr-2 h-4 w-4" />
              Owner — access my vault
            </Button>
            <Button size="lg" variant="outline" onClick={() => setMode("spouse")}>
              Request access (spouse)
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (mode === "owner") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Owner Login</CardTitle>
            <CardDescription>Enter your vault password to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleOwnerLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="optional"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Verifying…" : "Unlock vault"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => { setMode("choose"); setError(""); setPassword(""); }}
              >
                Back
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  // spouse mode — placeholder for Week 2
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Request Vault Access</CardTitle>
          <CardDescription>
            This will notify the vault owner. If they do not block the request within the
            configured waiting period, you will receive an email with access instructions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Trust transfer flow — coming in a future release.
          </p>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setMode("choose")}
          >
            Back
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
