import { Section } from "@/components/site/chrome";
import { Analyzer } from "@/components/site/analyzer";
import { Providers } from "@/components/providers";

export const metadata = { title: "M&A Analyzer", description: "Free preliminary assessment of strategic fit between a target company and a potential acquirer." };

export default function AnalyzerPage() {
  return (
    <Section eyebrow="M&A Analyzer" title="How well do two companies fit?" intro="Enter a target company and a potential buyer. We retrieve public information, structure it with AI, and score strategic fit with our M&A Matrix — showing sources, assumptions and what we couldn't verify.">
      <Providers>
        <Analyzer />
      </Providers>
    </Section>
  );
}
