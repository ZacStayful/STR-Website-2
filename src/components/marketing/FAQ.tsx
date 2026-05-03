export type FAQItem = { q: string; a: string };

export function FAQ({ items }: { items: FAQItem[] }) {
  return (
    <div>
      {items.map((item) => (
        <details key={item.q} className="sf-faq">
          <summary className="sf-faq__q">{item.q}</summary>
          <div className="sf-faq__a">
            <p>{item.a}</p>
          </div>
        </details>
      ))}
    </div>
  );
}
