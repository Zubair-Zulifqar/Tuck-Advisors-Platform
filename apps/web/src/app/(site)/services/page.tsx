import Link from "next/link";
import { Section } from "@/components/site/chrome";

export const metadata = { title: "Advisory services" };

const services = [
  ["Sell-side advisory", "/services/sell-side", "Full-process representation for founders and shareholders exploring a sale, recapitalisation or strategic partnership."],
  ["Buy-side advisory", "/services/buy-side", "Proactive target sourcing, screening and execution support for strategic acquirers and sponsors."],
  ["Strategic readiness", "/contact", "Pre-transaction diagnostics: positioning, KPI hygiene and buyer perception work 12–24 months before a process."],
  ["Valuation perspectives", "/contact", "Market-informed views on value drivers and deal structures. Not a formal valuation or fairness opinion."],
];

export default function ServicesPage() {
  return (
    <Section eyebrow="Advisory services" title="Focused mandates, senior execution" intro="We take on a limited number of engagements at a time so every client gets partner-level attention.">
      <div className="grid gap-5 md:grid-cols-2">
        {services.map(([t, h, b]) => (
          <Link key={t} href={h!} className="surface group rounded-lg p-6 transition hover:border-brass/60">
            <h3 className="font-serif text-xl font-semibold group-hover:text-brass-600">{t}</h3>
            <p className="muted mt-2 leading-relaxed">{b}</p>
          </Link>
        ))}
      </div>
    </Section>
  );
}
