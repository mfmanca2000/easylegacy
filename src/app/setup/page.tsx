"use client";

import { Shield } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

// First-time setup wizard — Week 2+ implementation.
// Step 1: Create master password → Argon2id KDF → VEK / MAK / KWK
// Step 2: Configure trust transfer (email addresses, waiting period, Spouse PIN)
// Step 3: Generate VST → encrypt VEK shard → upload to server
// Step 4: Print Emergency Card (QR code + instructions)
// Step 5: Confirm setup checklist
export default function SetupPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <CardTitle>First-Time Setup</CardTitle>
          </div>
          <CardDescription>
            Configure your encrypted vault and trust transfer settings. This takes about 10
            minutes and only needs to be done once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Create master password (Argon2id KDF)</li>
            <li>Configure trust transfer (emails, waiting period, Spouse PIN)</li>
            <li>Generate Vault Share Token &amp; encrypt VEK shard</li>
            <li>Print Emergency Card (QR code)</li>
            <li>Confirm setup checklist</li>
          </ol>
          <p className="text-sm text-muted-foreground border-l-2 border-muted pl-3">
            Setup wizard — coming in Week 2.
          </p>
          <Button variant="outline" className="w-full" onClick={() => router.push("/")}>
            Back to home
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
