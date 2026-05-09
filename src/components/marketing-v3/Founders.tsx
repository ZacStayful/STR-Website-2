const FOUNDERS = [
  {
    id: "zac",
    name: "Zac Harrison",
    role: "Co-founder",
    img: "/assets/founder-zac.png",
    bio: "Zac started his Airbnb journey in late 2019 at 21, with little money and a strong will to succeed. Three years later he runs a 7-figure Airbnb business with 30+ rent-to-rent properties across the country — and an Airbnb-focused interior design studio that fits out properties for other operators.",
  },
  {
    id: "martyn",
    name: "Martyn Butler",
    role: "Co-founder",
    img: "/assets/founder-martyn.png",
    bio: "Martyn started in 2020 with a passion for property but without the deposits to buy. He took the rent-to-rent route, self-managed his own portfolio for several years, and founded Stayful — an Airbnb management company built on operator experience and focused on hands-off profitability for its customers.",
  },
] as const;

export function Founders() {
  return (
    <section className="founders section">
      <div className="wrap">
        <div className="founders-head">
          <div className="eyebrow">The founders</div>
          <h2>Built by people who run the model.</h2>
        </div>
        <div className="founders-grid">
          {FOUNDERS.map((f) => (
            <article key={f.id} className="founder-card">
              <div
                className="founder-img"
                style={{ backgroundImage: `url(${f.img})` }}
                role="img"
                aria-label={`Portrait of ${f.name}`}
              />
              <div className="founder-meta">
                <h3 className="founder-name">{f.name}</h3>
                <div className="founder-role">{f.role}</div>
                <p className="founder-bio">{f.bio}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
