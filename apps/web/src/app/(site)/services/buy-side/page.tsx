import Link from "next/link";
import { Section } from "@/components/site/chrome";

export const metadata = { title: "Buy-side advisory" };

export default function BuySidePage() {
  return (
    <>
      <Section eyebrow="Buy-side advisory" title="Find the companies that aren't for sale — yet." intro="We turn your acquisition thesis into a living target list, scored against your criteria, and open doors with owners who have never spoken to a banker." />
      <section className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 md:grid-cols-2">
        {[
          ["Thesis to criteria", "We translate strategy into explicit, weighted acquisition criteria and exclusions in our M&A Matrix — so every target is scored the same way."],
          ["Proprietary sourcing", "Research across company websites, news, filings and owner communities surfaces off-market targets with documented signals and sources."],
          ["Owner engagement", "Thoughtful, human-reviewed outreach that respects founders' time and builds trust before any numbers are discussed."],
          ["Diligence & integration planning", "From first meeting through LOI, we coordinate diligence and help shape a credible integration story."],
        ].map(([t, b]) => (
          <div key={t} className="surface rounded-lg p-6">
            <h3 className="font-serif text-xl font-semibold">{t}</h3>
            <p className="muted mt-2 leading-relaxed">{b}</p>
          </div>
        ))}
      </section>
      <div className="mx-auto mt-12 max-w-6xl px-4 sm:px-6">
        <Link href="/contact?interest=buy_side" className="inline-flex rounded-md bg-navy px-5 py-3 text-sm font-medium text-ivory dark:bg-ivory dark:text-navy">Discuss your acquisition strategy</Link>
      </div>
    </>
  );
}
