import Link from "next/link";
import { ArrowRight, LineChart, Search, ShieldCheck, Workflow } from "lucide-react";
import { Section } from "@/components/site/chrome";

const pillars = [
  { icon: Search, title: "Research at institutional depth", body: "Every engagement starts with a sourced, citation-backed view of your market, competitors and the buyers most likely to pay for what you've built." },
  { icon: LineChart, title: "A defensible buyer universe", body: "Our M&A Matrix scores strategic fit across industry, product, customers and geography — with the reasoning shown, not hidden in a black box." },
  { icon: Workflow, title: "Process discipline", body: "Structured outreach, tight data-room hygiene and weekly pipeline reporting keep momentum high and surprises low." },
  { icon: ShieldCheck, title: "Senior attention, always", body: "A partner leads every mandate end-to-end. Technology removes busywork; judgement stays with people who have closed deals." },
];

const steps = [
  ["01", "Positioning", "We distil what makes your company valuable into a clear equity story and identify the proof points buyers will test."],
  ["02", "Buyer mapping", "We build and score a buyer universe — strategics, sponsors and family offices — and prioritise the best-fit conversations."],
  ["03", "Confidential outreach", "Outreach is personalised, reviewed by a partner and sequenced to create competitive tension without leaking your name."],
  ["04", "Negotiation & close", "We manage diligence, structure and negotiation through to signing, keeping you focused on running the business."],
];

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b hairline">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,rgba(176,141,87,0.16),transparent_55%)]" />
        <div className="mx-auto grid max-w-6xl gap-12 px-4 pb-20 pt-16 sm:px-6 md:grid-cols-[1.25fr_1fr] md:pt-24">
          <div>
            <p className="eyebrow">Boutique M&amp;A advisory</p>
            <h1 className="mt-4 font-serif text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
              The right buyer is rarely the obvious one.
            </h1>
            <p className="muted mt-6 max-w-xl text-lg leading-relaxed">
              Tuck Advisors helps founder-led companies and strategic acquirers find each other — pairing senior bankers with an AI research platform that maps
              markets, scores strategic fit and keeps every deal moving.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/analyzer" className="inline-flex items-center gap-2 rounded-md bg-brass px-5 py-3 text-sm font-medium text-white hover:bg-brass-600">
                Try the M&amp;A Analyzer <ArrowRight size={16} />
              </Link>
              <Link href="/contact" className="surface inline-flex items-center gap-2 rounded-md px-5 py-3 text-sm font-medium hover:border-brass/60">
                Book a confidential call
              </Link>
            </div>
          </div>
          <div className="surface self-center rounded-xl p-6 shadow-card">
            <p className="eyebrow">Sample fit assessment</p>
            <p className="mt-3 font-serif text-lg">Clinic scheduling SaaS × Healthcare platform</p>
            <div className="mt-5 space-y-3 text-sm">
              {[
                ["Industry overlap", 92],
                ["Product synergy", 78],
                ["Customer overlap", 71],
                ["Geographic synergy", 55],
              ].map(([l, v]) => (
                <div key={l as string}>
                  <div className="flex justify-between"><span>{l}</span><span className="tabular-nums muted">{v}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-black/5 dark:bg-white/10"><div className="h-1.5 rounded-full bg-brass" style={{ width: `${v}%` }} /></div>
                </div>
              ))}
            </div>
            <p className="muted mt-5 text-xs">Illustrative example. Every live score shows its evidence, missing data and confidence.</p>
          </div>
        </div>
      </section>

      <Section eyebrow="Why Tuck" title="Modern tools. Old-fashioned judgement." intro="We built our own research and deal platform so our partners spend their time where it matters: on your outcome.">
        <div className="grid gap-5 sm:grid-cols-2">
          {pillars.map(({ icon: Icon, title, body }) => (
            <div key={title} className="surface rounded-lg p-6">
              <Icon className="text-brass" size={22} />
              <h3 className="mt-4 font-serif text-xl font-semibold">{title}</h3>
              <p className="muted mt-2 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      <section className="bg-navy py-20 text-ivory">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="eyebrow !text-brass-400">How we work</p>
          <h2 className="mt-2 max-w-2xl font-serif text-3xl font-semibold sm:text-4xl">A sell-side process built for founders</h2>
          <ol className="mt-12 grid gap-8 md:grid-cols-4">
            {steps.map(([n, t, b]) => (
              <li key={n} className="border-t border-white/15 pt-5">
                <span className="font-serif text-3xl text-brass-400">{n}</span>
                <h3 className="mt-3 font-semibold">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ivory/70">{b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <Section eyebrow="Who we serve" title="Lower middle-market companies with something rare">
        <div className="grid gap-5 md:grid-cols-3">
          {[
            ["Vertical software", "Mission-critical SaaS with sticky customers in healthcare, financial services, trades and education."],
            ["Tech-enabled services", "Recurring-revenue service businesses where technology creates a durable operating edge."],
            ["Specialist products", "Niche manufacturers and distributors with defensible customer relationships."],
          ].map(([t, b]) => (
            <div key={t} className="rounded-lg border hairline p-6">
              <h3 className="font-serif text-lg font-semibold">{t}</h3>
              <p className="muted mt-2 text-sm leading-relaxed">{b}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-brass-50 p-6 dark:bg-brass-700/20">
          <p className="font-serif text-xl">Curious how a buyer might see your company?</p>
          <Link href="/analyzer" className="inline-flex items-center gap-2 rounded-md bg-navy px-4 py-2.5 text-sm font-medium text-ivory dark:bg-ivory dark:text-navy">
            Run a free preliminary analysis <ArrowRight size={16} />
          </Link>
        </div>
      </Section>
    </>
  );
}
