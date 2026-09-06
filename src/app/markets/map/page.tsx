import { redirect } from "next/navigation";

// The map is now the explorer's main view; the old standalone map page
// simply lands on it.
export default function MarketsMapPage() {
  redirect("/markets");
}
