"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type {
  ChapterState,
  IncomeData,
  MarketData,
  PropertyInput,
  RiskData,
} from "./_lib/types";
import { applySelfManaged, calculateIncome, ltlEstimate, setupCost } from "./_lib/calculations";
import { marketData } from "./_lib/market";
import { calculateRisk } from "./_lib/risk";
import { buildVerdict } from "./_lib/verdict";
import { ProgressBar } from "./_components/ProgressBar";
import { NavButtons } from "./_components/ui/NavButtons";
import { InputChapter } from "./_components/chapters/InputChapter";
import { ScanChapter } from "./_components/chapters/ScanChapter";
import { MarketChapter } from "./_components/chapters/MarketChapter";
import { LocationChapter } from "./_components/chapters/LocationChapter";
import { IncomeChapter } from "./_components/chapters/IncomeChapter";
import { CompareChapter } from "./_components/chapters/CompareChapter";
import { RiskChapter } from "./_components/chapters/RiskChapter";
import { VerdictChapter } from "./_components/chapters/VerdictChapter";

export default function StrReportPage() {
  const [chapter, setChapter] = useState<ChapterState>(0);
  const [input, setInput] = useState<PropertyInput | null>(null);
  const [market, setMarket] = useState<MarketData | null>(null);
  const [income, setIncome] = useState<IncomeData | null>(null);
  const [risk, setRisk] = useState<RiskData | null>(null);
  const [selfManaged, setSelfManaged] = useState(false);

  // Self-managing folds the management fee back into net; the compare and
  // verdict chapters reflect the same adjusted figure.
  const adjustedIncome = useMemo(
    () => (income ? applySelfManaged(income, selfManaged) : null),
    [income, selfManaged],
  );

  const verdict = useMemo(
    () => (input && adjustedIncome && risk ? buildVerdict(input, adjustedIncome, risk) : null),
    [input, adjustedIncome, risk],
  );

  function handleSubmit(next: PropertyInput) {
    const m = marketData(next);
    const inc = calculateIncome(next.beds);
    const r = calculateRisk(next, inc, m);
    setInput(next);
    setMarket(m);
    setIncome(inc);
    setRisk(r);
    setSelfManaged(false);
    setChapter(1);
  }

  function reset() {
    setChapter(0);
    setInput(null);
    setMarket(null);
    setIncome(null);
    setRisk(null);
    setSelfManaged(false);
  }

  const goContinue = () => setChapter((c) => (Math.min(7, c + 1) as ChapterState));
  const goBack = () => setChapter((c) => (Math.max(2, c - 1) as ChapterState));

  return (
    <main
      style={{
        maxWidth: 600,
        margin: "0 auto",
        padding: "1.75rem 1.5rem 4rem",
      }}
    >
      {/* Stayful branding */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
        <Image src="/assets/stayful-logo.png" alt="Stayful" width={47} height={28} priority />
      </div>

      <ProgressBar chapter={chapter} />

      <div key={chapter}>
        {chapter === 0 && <InputChapter onSubmit={handleSubmit} />}

        {chapter === 1 && input && market && (
          <ScanChapter input={input} market={market} onDone={() => setChapter(2)} />
        )}

        {chapter === 2 && input && market && <MarketChapter input={input} market={market} />}

        {chapter === 3 && input && market && <LocationChapter input={input} market={market} />}

        {chapter === 4 && income && adjustedIncome && (
          <IncomeChapter
            income={adjustedIncome}
            baseManagement={income.management}
            selfManaged={selfManaged}
            onToggle={setSelfManaged}
          />
        )}

        {chapter === 5 && input && adjustedIncome && verdict && (
          <CompareChapter
            strNet={adjustedIncome.net}
            ltlNet={ltlEstimate(input.beds)}
            setupCostValue={setupCost(input.beds)}
            verdict={verdict}
          />
        )}

        {chapter === 6 && risk && <RiskChapter risk={risk} />}

        {chapter === 7 && input && adjustedIncome && risk && verdict && (
          <VerdictChapter
            input={input}
            income={adjustedIncome}
            risk={risk}
            verdict={verdict}
            onReset={reset}
          />
        )}
      </div>

      {chapter >= 2 && chapter <= 6 && (
        <NavButtons chapter={chapter} onBack={goBack} onContinue={goContinue} />
      )}
    </main>
  );
}
