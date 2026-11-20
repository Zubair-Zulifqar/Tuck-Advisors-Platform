import Link from "next/link";

const nav = [
  ["Services", "/services"],
  ["Sell-side", "/services/sell-side"],
  ["Buy-side", "/services/buy-side"],
  ["Criteria", "/acquisition-criteria"],
  ["About", "/about"],
];

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2 ${className}`} aria-label="Tuck Advisors home">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="6" fill="#0F1B2D" />
        <path d="M8 10h16M16 10v13" stroke="#B08D57" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M11 23h10" stroke="#F7F4EE" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span className="font-serif text-lg font-semibold tracking-tight">Tuck Advisors</span>
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b hairline bg-[var(--bg)]/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-6 text-sm md:flex">
          {nav.map(([l, h]) => (
            <Link key={h} href={h!} className="muted transition hover:text-[var(--text)]">
              {l}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/analyzer" className="hidden rounded-md bg-brass px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brass-600 sm:inline-flex">
            M&amp;A Analyzer
          </Link>
          <Link href="/contact" className="rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-ivory transition hover:bg-navy-600 dark:bg-ivory dark:text-navy">
            Talk to us
          </Link>
        </div>
      </div>
      <nav className="flex gap-4 overflow-x-auto px-4 pb-2 text-sm md:hidden">
        {[...nav, ["Analyzer", "/analyzer"]].map(([l, h]) => (
          <Link key={h} href={h!} className="muted whitespace-nowrap">
            {l}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t hairline bg-navy text-ivory">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="font-serif text-xl">Tuck Advisors</p>
          <p className="mt-3 max-w-sm text-sm text-ivory/70">Boutique M&amp;A advisory for founder-led companies and the strategic buyers who want to grow with them.</p>
        </div>
        <div className="text-sm">
          <p className="mb-3 font-semibold text-brass-400">Advisory</p>
          <ul className="space-y-2 text-ivory/80">
            <li><Link href="/services/sell-side">Sell-side</Link></li>
            <li><Link href="/services/buy-side">Buy-side</Link></li>
            <li><Link href="/acquisition-criteria">Acquisition criteria</Link></li>
            <li><Link href="/analyzer">M&amp;A Analyzer</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <p className="mb-3 font-semibold text-brass-400">Firm</p>
          <ul className="space-y-2 text-ivory/80">
            <li><Link href="/about">About</Link></li>
            <li><Link href="/contact">Contact</Link></li>
            <li><Link href="/privacy">Privacy</Link></li>
            <li><Link href="/terms">Terms</Link></li>
            <li><Link href="/login">Team sign-in</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10 py-5 text-center text-xs text-ivory/50">
        © {new Date().getFullYear()} Tuck Advisors. Nothing on this site is an offer to buy or sell securities or investment advice.
      </div>
    </footer>
  );
}

export function Section({ eyebrow, title, intro, children, className = "" }: { eyebrow?: string; title: string; intro?: string; children?: React.ReactNode; className?: string }) {
  return (
    <section className={`mx-auto max-w-6xl px-4 py-16 sm:px-6 ${className}`}>
      {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
      <h2 className="max-w-3xl font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      {intro && <p className="muted mt-4 max-w-2xl text-lg leading-relaxed">{intro}</p>}
      {children && <div className="mt-10">{children}</div>}
    </section>
  );
}
