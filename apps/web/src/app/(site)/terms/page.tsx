import { Section } from "@/components/site/chrome";

export const metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <Section eyebrow="Legal" title="Terms of service">
      <div className="prose-tuck muted max-w-3xl text-[15px]">
        <p><em>Last updated: November 2026. This template must be reviewed by counsel before production use.</em></p>
        <p><strong>No advice.</strong> Content on this website, including the M&amp;A Analyzer, is general information. It is not financial, legal, tax, investment or valuation advice and does not create an advisory relationship. Engagements are governed solely by a signed engagement letter.</p>
        <p><strong>Analyzer output.</strong> Results are preliminary, generated automatically from public information and AI interpretation, and may be incomplete or inaccurate. Items labelled &quot;AI assessment&quot; are opinions, and items labelled &quot;Unknown&quot; could not be verified. Do not rely on the output for any transaction decision.</p>
        <p><strong>Acceptable use.</strong> Do not submit confidential, non-public or personal information to the analyzer, attempt to circumvent rate limits, or use the service to analyse companies for unlawful purposes.</p>
        <p><strong>Securities.</strong> Nothing on this site is an offer to buy or sell any security. Where required, securities transactions are conducted through appropriately registered entities.</p>
        <p><strong>Liability.</strong> The website is provided &quot;as is&quot; without warranties to the fullest extent permitted by law.</p>
      </div>
    </Section>
  );
}
