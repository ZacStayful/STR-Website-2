"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { StarterPackOffer } from "@/components/starter-pack/StarterPackOffer";
import type { PackCopy } from "@/lib/starter-pack/rules";
import { skipPackAction } from "./actions";

/** Batch 22f: step 0 — the same pack, the same buy box, back to step 1 after. */
export function PackStep({ copy }: { copy: PackCopy }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <section className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
      <StarterPackOffer
        copy={copy}
        returnTo="/leads/setup"
        variant="screen"
        notNowLabel={pending ? "Working…" : "Not now, set up my form first"}
        onNotNow={() =>
          start(async () => {
            await skipPackAction();
            router.push("/leads/setup/company");
          })
        }
        onContinue={() => router.push("/leads/setup/company")}
        continueLabel="Continue to your company"
      />
    </section>
  );
}
