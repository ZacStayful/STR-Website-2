export function TeamStrip() {
  return (
    <section className="team-strip">
      <div className="wrap">
        <div className="ts-grid">
          <div
            className="ts-img"
            style={{ backgroundImage: "url('/assets/team.png')" }}
          />
          <div className="ts-copy">
            <div className="eyebrow">Built in the UK</div>
            <h2>By a team that&rsquo;s actually run short-lets.</h2>
            <p className="lede">
              Stayful is built by operators, not analysts. We&rsquo;ve run UK
              short-let portfolios across York, Bath, Edinburgh and Manchester
              — and we built the Analyser because the tool we needed
              didn&rsquo;t exist.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
