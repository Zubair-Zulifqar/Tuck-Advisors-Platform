import { Section } from "@/components/site/chrome";

export const metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <Section eyebrow="About the firm" title="We built the advisory firm we wanted to hire." intro="Tuck Advisors was founded by operators and bankers who believed founder-led companies deserved the same rigour large corporates get — without the bureaucracy." />
      <section className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 md:grid-cols-3">
        {[
          ["Independent", "We are not affiliated with any buyer or fund. Our only incentive is the best outcome for the client we represent."],
          ["Evidence-led", "Our research platform cites its sources and flags what it does not know. We never present an AI guess as a fact."],
          ["Discreet", "Confidentiality is designed into our tools and our process — from need-to-know access controls to reviewed outreach."],
        ].map(([t, b]) => (
          <div key={t}>
            <h3 className="font-serif text-xl font-semibold">{t}</h3>
            <p className="muted mt-2 leading-relaxed">{b}</p>
          </div>
        ))}
      </section>
      <Section eyebrow="Our platform" title="Technology in service of judgement">
        <div className="muted max-w-3xl space-y-4 leading-relaxed">
          <p>Behind every Tuck engagement is a proprietary platform: an AI research engine that assembles sourced company profiles, a configurable M&amp;A Matrix that scores buyer–target fit with full explanations, a CRM tuned for deal work and an automation layer that keeps follow-ups from slipping.</p>
          <p>Automation prepares; people decide. Every client-facing message, campaign and data export requires a human approval.</p>
        </div>
      </Section>
    </>
  );
}
