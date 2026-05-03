import type { ReactNode } from "react";

export function Callout({ children }: { children: ReactNode }) {
  return <div className="sf-callout">{children}</div>;
}
