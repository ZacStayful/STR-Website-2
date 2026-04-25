"use client";

import { useState } from "react";
import Image from "next/image";
import { Mail, FileText, Loader2, AlertCircle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ReportPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ leadName: string; fileUrl: string; fileName: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/get-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      setResult(data);
    } catch {
      setError("Could not connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-background">
      {/* Hero */}
      <section className="relative overflow-hidden bg-primary py-12 sm:py-16">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center text-center">
            <Image
              alt="Stayful"
              width={180}
              height={60}
              className="mb-6 h-12 w-auto sm:h-14"
              src="/images/stayful-logo.png"
              priority
            />
            <h1 className="mb-4 text-3xl font-bold tracking-tight text-primary-foreground sm:text-4xl">
              Your Stayful Property Report
            </h1>
            <p className="max-w-2xl text-lg text-primary-foreground/80">
              Enter the email address you used when requesting your income estimate to access your personalised report.
            </p>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="relative z-10 -mt-8 pb-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <Card className="mx-auto max-w-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Access Your Report
              </CardTitle>
              <CardDescription>
                Enter your email address below to retrieve your Stayful Analyser PDF.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!result ? (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Email Address
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="your@email.com"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>

                  {error && (
                    <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      {error}
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Looking up your report...
                      </>
                    ) : (
                      <>
                        <FileText className="mr-2 h-4 w-4" />
                        Get My Report
                      </>
                    )}
                  </Button>
                </form>
              ) : (
                <div className="flex flex-col items-center gap-6 py-4 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
                    <FileText className="h-8 w-8 text-success" />
                  </div>
                  <div>
                    <p className="text-lg font-bold text-foreground">Report Ready</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Hi {result.leadName}, your Stayful Analyser is ready to view.
                    </p>
                  </div>
                  <a
                    href={result.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full"
                  >
                    <Button className="w-full" size="lg">
                      <FileText className="mr-2 h-5 w-5" />
                      Open My Stayful Report
                    </Button>
                  </a>
                  <button
                    onClick={() => { setResult(null); setEmail(""); }}
                    className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Use a different email
                  </button>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            {`Don't have a report yet? `}
            <a href="/" className="font-medium text-primary underline underline-offset-2">
              Run your free property analysis
            </a>
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/30 py-8">
        <div className="mx-auto max-w-7xl px-4 text-center text-sm text-muted-foreground">
          <Image
            alt="Stayful"
            loading="lazy"
            width={100}
            height={35}
            className="mx-auto mb-4 h-8 w-auto opacity-60"
            src="/images/stayful-logo.png"
          />
          <p>&copy; 2026 Stayful. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
