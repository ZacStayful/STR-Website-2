import Link from "next/link";

export type RelatedLink = { href: string; label: string; description?: string };

export function RelatedLinks({ items, title }: { items: RelatedLink[]; title?: string }) {
  return (
    <div>
      {title ? <h3>{title}</h3> : null}
      <div className="sf-related-links">
        {items.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
            {item.description ? <small>{item.description}</small> : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
