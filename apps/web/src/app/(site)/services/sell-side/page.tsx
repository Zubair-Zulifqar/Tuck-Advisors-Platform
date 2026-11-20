import Link from "next/link";
import { Section } from "@/components/site/chrome";

export const metadata = { title: "Sell-side advisory" };

export default function SellSidePage() {
  return (
    <>
      <Section eyebrow="Sell-side advisory" title="Run a process, not a fire sale." intro="Whether you are planning succession, seeking a growth partner or responding to an unsolicited offer, we help you control the timeline, the narrative and the outcome." />
      <section className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6 md:grid-cols-3">
        {[
          ["Preparation", ["Equity story & positioning statement", "Financial and KPI packaging", "Diligence readiness review", "Confidential information memorandum"]],
          ["Marketing", ["Scored buyer universe with rationale", "Partner-reviewed, personalised outreach", "NDA and data-room management", "Weekly pipeline reporting"]],
          ["Execution", ["IOI / LOI comparison and negotiation", "Structure: earn-outs, rollover, escrow", "Diligence coordination", "Signing and close support"]],
        ].map(([t, items]) => (
          <div key={t as string} className="surface rounded-lg p-6">
            <h3 className="font-serif text-xl font-semibold">{t}</h3>
            <ul className="muted mt-4 space-y-2 text-sm">
              {(items as string[]).map((i) => (
                <li key={i} className="flex gap-2"><span className="text-brass">—</span>{i}</li>
              ))}
            </ul>
          </div>
        ))}
      </section>
      <div className="mx-auto mt-12 max-w-6xl px-4 sm:px-6">
        <Link href="/contact?interest=sell_side" className="inline-flex rounded-md bg-navy px-5 py-3 text-sm font-medium text-ivory dark:bg-ivory dark:text-navy">Start a confidential conversation</Link>
      </div>
    </>
  );
}
