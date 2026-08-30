import { EntryForm } from "../components/EntryForm";

export default function Home() {
  return (
    <main className="entry-shell">
      <div className="entry-grid" aria-hidden="true" />
      <section className="entry-card" aria-labelledby="page-title">
        <div className="eyebrow brand-lockup">
          <span className="eyebrow-mark" />
          <strong>Pulse</strong>
          <small>by Digia</small>
        </div>

        <div className="entry-copy">
          <h1 id="page-title">
            Know what to
            <br />
            act on next.
          </h1>
          <p>
            Pulse helps product teams understand what users are struggling
            with and what to act on next.
          </p>
        </div>

        <EntryForm />
        <p className="privacy-note">No sign-in yet. Anyone with an audit link can view it.</p>

        <div className="entry-footnote">
          <span className="footnote-dot" />
          Real reviews in. Grounded opportunities out.
        </div>
      </section>

      <aside className="signal-card" aria-label="Audit principle">
        <div className="signal-label">The audit principle</div>
        <p>
          Every finding must point back to what a real user said.
        </p>
        <div className="signal-rule" />
        <span>01 / evidence before opinion</span>
      </aside>
    </main>
  );
}
