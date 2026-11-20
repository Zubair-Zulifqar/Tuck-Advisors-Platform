import { Section } from "@/components/site/chrome";
import { LeadForm } from "@/components/site/lead-form";

export const metadata = { title: "Contact" };

export default async function ContactPage({ searchParams }: { searchParams: Promise<{ interest?: string }> }) {
  const { interest } = await searchParams;
  return (
    <Section eyebrow="Contact" title="Start a confidential conversation" intro="Tell us a little about your situation. A partner will reply within one business day. We never share inquiries with buyers without your written consent.">
      <div className="grid gap-10 md:grid-cols-[1.4fr_1fr]">
        <LeadForm defaultInterest={interest} />
        <aside className="muted space-y-4 text-sm leading-relaxed">
          <p><strong className="text-[var(--text)]">What happens next?</strong><br />We'll schedule a 30-minute call to understand your goals, timing and questions. No obligation, no pitch deck.</p>
          <p><strong className="text-[var(--text)]">Prefer to start with data?</strong><br />Our free M&amp;A Analyzer gives a preliminary, sourced view of strategic fit between two companies.</p>
        </aside>
      </div>
    </Section>
  );
}
