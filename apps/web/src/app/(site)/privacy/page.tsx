import { Section } from "@/components/site/chrome";

export const metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <Section eyebrow="Legal" title="Privacy policy">
      <div className="prose-tuck muted max-w-3xl text-[15px]">
        <p><em>Last updated: November 2026. This template must be reviewed by counsel before production use.</em></p>
        <p><strong>What we collect.</strong> Information you submit (name, email, company, message), M&amp;A Analyzer inputs (two public website addresses) and, only if you opt in, the resulting analysis. For our advisory work we maintain professional business contact information obtained from public sources, licensed data providers and direct interactions.</p>
        <p><strong>How we use it.</strong> To respond to inquiries, deliver advisory services, operate the analyzer and — where you have subscribed — send our newsletter. We do not sell personal information.</p>
        <p><strong>AI processing.</strong> Analyzer requests are processed by third-party AI and research providers under contract to retrieve and summarise public information. We do not use your inputs to train models.</p>
        <p><strong>Retention.</strong> Saved analyses are deleted after 180 days. Unsaved analyses are not stored. Inquiries are retained for as long as needed to manage the relationship.</p>
        <p><strong>Your choices.</strong> You can unsubscribe from any email using the link it contains, and request access, correction or deletion by contacting privacy@tuckadvisors.example.</p>
        <p><strong>Security.</strong> Data is encrypted in transit, access is restricted by role and organisation, and administrative actions are audit-logged.</p>
      </div>
    </Section>
  );
}
