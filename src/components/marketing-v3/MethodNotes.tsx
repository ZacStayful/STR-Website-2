// Carries the Market Explorer's methodology voice — "not a black box: we
// show our working" — into the analyser context, where until now the
// reasoning was only visible inside the product.

const STEPS = [
  {
    n: "01",
    title: "Start from the market, not the property.",
    body: "Live comparables near the postcode set the range. This is the same class of data every platform in the category works from, and on its own it is a guess about a property nobody has operated.",
  },
  {
    n: "02",
    title: "Adjust for what the property actually is.",
    body: "Size and efficiency from the EPC register, amenities and location from Google Places, event-driven demand from the calendar. A three-bed on a main road and a three-bed on a green do not earn the same, and comparables alone cannot see the difference.",
  },
  {
    n: "03",
    title: "Cost it the way an operator costs it.",
    body: "Cleaning, turnaround, platform fees and management come off the top using the rates we pay on our own portfolio — not a percentage assumption. This is where a headline revenue figure and an owner-net figure stop resembling each other.",
  },
  {
    n: "04",
    title: "Check it against properties we run.",
    body: "Because we manage short-lets ourselves, a forecast is not the end of the process. Twelve months later we know what the property did, and that variance goes back into the model and onto the ledger below.",
  },
];

export function MethodNotes() {
  return (
    <section className="section-tight" id="method">
      <div className="wrap-narrow">
        <div className="acc-head">
          <div className="eyebrow">How the number is built</div>
          <h2>A figure you can interrogate.</h2>
          <p className="lede">
            Not a black box. Four steps, in order, and you can argue with any
            of them.
          </p>
        </div>
        <div className="meth-list">
          {STEPS.map((s) => (
            <div key={s.n} className="meth-item">
              <span className="meth-num">{s.n}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
