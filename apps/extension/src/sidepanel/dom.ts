/**
 * Tiny DOM builder. All dynamic values are written with textContent / setAttribute — never innerHTML —
 * so names, subjects or API data containing markup are rendered inert.
 */
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | undefined | null | EventListener>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "value" && "value" in el) (el as HTMLInputElement).value = String(v);
    else if (k === "checked" && "checked" in el) (el as HTMLInputElement).checked = Boolean(v);
    else if (k === "href") el.setAttribute("href", safeHref(String(v)));
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Only http(s) links are rendered as clickable; anything else (javascript:, data:) becomes inert. */
export function safeHref(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : "#";
  } catch {
    return "#";
  }
}

export function mount(root: HTMLElement, ...nodes: Node[]) {
  root.replaceChildren(...nodes);
}

export function link(url: string, label: string) {
  return h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, label);
}

export const STAGE_LABELS: Record<string, string> = {
  sourced: "Sourced",
  qualified: "Qualified",
  engaged: "Engaged",
  nda: "NDA",
  diligence: "Diligence",
  loi: "LOI",
  closing: "Closing",
  won: "Won",
  lost: "Lost",
};

export function stageChip(stage: string) {
  const known = stage in STAGE_LABELS ? stage : "unknown";
  return h("span", { class: `chip stage-${known}`, title: `Deal stage: ${STAGE_LABELS[stage] ?? stage}` }, STAGE_LABELS[stage] ?? stage);
}

export const EMAIL_STATUS: Record<string, { label: string; tone: string }> = {
  provider_verified: { label: "Verified by provider", tone: "ok" },
  manually_verified: { label: "Manually verified", tone: "ok" },
  unverified: { label: "Unverified", tone: "warn" },
  invalid: { label: "Invalid", tone: "bad" },
};

export function badge(text: string, tone: "ok" | "warn" | "bad" | "info" | "muted" = "muted") {
  return h("span", { class: `badge badge-${tone}` }, text);
}

export function emailBadge(status: string | null | undefined) {
  const s = EMAIL_STATUS[status ?? "unverified"] ?? EMAIL_STATUS.unverified!;
  return badge(s.label, s.tone as "ok" | "warn" | "bad");
}

export type StatusTone = "idle" | "loading" | "ok" | "error";
export function statusLine() {
  const el = h("p", { class: "status", role: "status", "aria-live": "polite" });
  return {
    el,
    set(tone: StatusTone, text = "") {
      el.className = `status status-${tone}`;
      el.textContent = text;
    },
  };
}

export function field(label: string, input: HTMLElement, hint?: string) {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), input, hint ? h("span", { class: "field-hint" }, hint) : null);
}

export function input(name: string, value = "", attrs: Attrs = {}) {
  return h("input", { name, value, type: "text", autocomplete: "off", ...attrs });
}

export function card(title: string | Node, ...body: Child[]) {
  return h("section", { class: "card" }, h("h3", { class: "card-title" }, title), ...body);
}

export function button(label: string, onClick: (e: Event) => void, variant: "primary" | "secondary" | "ghost" = "primary", attrs: Attrs = {}) {
  return h("button", { type: "button", class: `btn btn-${variant}`, onclick: onClick as EventListener, ...attrs }, label);
}

/** Disables a button while an async action runs; returns the action's result. */
export async function busy<T>(btn: HTMLButtonElement, label: string, fn: () => Promise<T>): Promise<T> {
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  btn.setAttribute("aria-busy", "true");
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
    btn.removeAttribute("aria-busy");
  }
}
