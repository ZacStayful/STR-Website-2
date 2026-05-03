import type { ReactNode } from "react";

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="sf-bullets">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
