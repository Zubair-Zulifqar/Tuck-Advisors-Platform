import { Section } from "@/components/site/chrome";
import { UnsubscribeButton } from "@/components/site/unsubscribe";

export const metadata = { title: "Unsubscribe", robots: { index: false } };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string; e?: string; o?: string }> }) {
  const sp = await searchParams;
  return (
    <Section title="Unsubscribe" intro="Confirm below and we'll stop sending you these emails. It can take a few minutes to take effect.">
      <UnsubscribeButton token={sp.t} email={sp.e} organizationId={sp.o} />
    </Section>
  );
}
