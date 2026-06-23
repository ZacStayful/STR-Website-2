import { C } from "../../_lib/brand";

export function Divider({ className }: { className?: string }) {
  return <hr className={className} style={{ border: 0, borderTop: `1px solid ${C.gray200}`, margin: "1rem 0" }} />;
}
