"use client";

import { useState } from "react";
import { ActionButton, ApiForm, str } from "./actions";

export function ConvertOpportunity({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      {!open && <button className="text-xs underline" onClick={() => setOpen(true)}>Convert to deal</button>}
      <ActionButton path={`/api/v1/opportunities/${id}`} body={{ action: "dismiss" }} variant="ghost">Dismiss</ActionButton>
      {open && (
        <ApiForm path={`/api/v1/opportunities/${id}`} submitLabel="Create company + deal" className="flex w-full flex-wrap gap-2" toBody={(f) => ({ action: "convert", companyName: str(f, "name"), website: str(f, "website") })}>
          <input name="name" required placeholder="Company name (once identified)" className="field flex-1" />
          <input name="website" type="url" placeholder="https://" className="field flex-1" />
        </ApiForm>
      )}
    </div>
  );
}
