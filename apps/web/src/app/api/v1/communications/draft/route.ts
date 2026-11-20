import { z } from "zod";
import { getContact, listActivities } from "@tuck/db";
import { route } from "@/server/api";
import { getDeps } from "@/server/db";

const body = z.object({ contactId: z.string().uuid(), intent: z.enum(["intro", "follow_up", "meeting_request", "thank_you", "custom"]), notes: z.string().max(2000).optional() });
const out = z.object({ subject: z.string().max(200), body: z.string().max(5000), followUpSuggestions: z.array(z.string().max(300)).max(5) });

/** AI-assisted email draft. Returned to the user for editing — never sent automatically. */
export const POST = route({ permission: "outreach:draft", body, rate: [30, 60_000] }, async ({ body, tx, auth }) => {
  const { contact, history } = await tx(async (t) => ({ contact: await getContact(t, auth.organizationId, body.contactId), history: await listActivities(t, auth.organizationId, { contactId: body.contactId, limit: 10 }) }));
  const deps = await getDeps();
  const first = contact.first_name;
  const draft = await deps.llm.completeJson(
    out,
    {
      task: "email_draft",
      system: "You draft concise, warm, professional emails for an M&A advisor. No hype, no false urgency, no claims you cannot support. Sign off with the sender's name.",
      user: JSON.stringify({ intent: body.intent, notes: body.notes, recipient: { firstName: first, title: contact.title, company: contact.company_name }, sender: auth.name, recentTimeline: history.map((h) => `${h.occurred_at.slice(0, 10)} ${h.type}: ${h.subject}`) }),
    },
    () => {
      const lines: Record<string, [string, string]> = {
        intro: ["Introduction — Tuck Advisors", `I lead M&A advisory work at Tuck Advisors${contact.company_name ? ` and wanted to introduce myself to the ${contact.company_name} team` : ""}. Would you be open to a brief, confidential conversation about your long-term plans?`],
        follow_up: ["Following up", "I wanted to follow up on our recent conversation and see whether you had any questions or thoughts on next steps."],
        meeting_request: ["Time for a quick call?", "Would you have 20–30 minutes in the next week or two for a call? Happy to work around your schedule."],
        thank_you: ["Thank you", "Thank you for taking the time to speak with me. I appreciated the conversation and will follow up with the materials we discussed."],
        custom: ["Quick note", body.notes ?? ""],
      };
      const [subject, text] = lines[body.intent]!;
      return { subject, body: `Hi ${first},\n\n${text}\n\nBest regards,\n${auth.name ?? ""}`, followUpSuggestions: ["Create a follow-up task for 5 business days from now"] };
    },
  );
  return { ...draft, provider: deps.llm.name, mock: deps.llm.mock, sendsAutomatically: false };
});
