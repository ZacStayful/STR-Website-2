import type { SchemaItem } from "@/lib/schema";

export function Schema({ items }: { items: SchemaItem[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(items) }}
    />
  );
}
