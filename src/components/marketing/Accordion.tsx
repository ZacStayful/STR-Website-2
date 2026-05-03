import type { ReactNode } from "react";

export function Accordion({
  summary,
  children,
  open,
}: {
  summary: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="sf-accordion" open={open}>
      <summary>{summary}</summary>
      <div className="sf-accordion__body">{children}</div>
    </details>
  );
}
