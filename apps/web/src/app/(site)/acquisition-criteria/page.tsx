import Link from "next/link";
import { Section } from "@/components/site/chrome";

export const metadata = { title: "Acquisition criteria" };

export default function CriteriaPage() {
  return (
    <Section eyebrow="Acquisition criteria" title="What our buyer network is looking for" intro="Our active buyers span strategic acquirers, independent sponsors and family offices. Typical characteristics of companies we represent:">
      <div className="grid gap-6 md:grid-cols-2">
        <div className="surface rounded-lg p-6">
          <h3 className="font-serif text-xl font-semibold">Profile</h3>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
            <dt className="muted">Revenue</dt><dd>$3M – $75M</dd>
            <dt className="muted">EBITDA</dt><dd>$1M – $15M (profitable or clear path)</dd>
            <dt className="muted">Revenue quality</dt><dd>Recurring or re-occurring; low customer concentration</dd>
            <dt className="muted">Geography</dt><dd>North America; selective UK &amp; Europe</dd>
            <dt className="muted">Ownership</dt><dd>Founder, family or management owned</dd>
          </dl>
        </div>
        <div className="surface rounded-lg p-6">
          <h3 className="font-serif text-xl font-semibold">Sectors of focus</h3>
          <ul className="muted mt-4 grid grid-cols-2 gap-2 text-sm">
            {["Vertical SaaS", "Healthcare IT", "Fintech infrastructure", "Tech-enabled services", "Facility & field services", "Education technology", "Compliance & security", "Specialty distribution"].map((s) => (
              <li key={s} className="flex gap-2"><span className="text-brass">—</span>{s}</li>
            ))}
          </ul>
          <p className="muted mt-6 text-xs">We generally do not take on early-stage pre-revenue companies, distressed situations or regulated financial institutions.</p>
        </div>
      </div>
      <p className="mt-8 text-sm">Not sure if you fit? <Link className="text-brass-600 underline" href="/contact">Ask us</Link> — we reply to every inquiry.</p>
    </Section>
  );
}
