import type { PageContext } from "@tuck/shared";
import type { AuthStatus, User } from "../lib/auth";
import { normalizeBaseUrl, originPattern } from "../lib/config";
import { rpc, type Broadcast } from "../lib/messages";
import { h, mount } from "./dom";
import { renderCrm, renderGmail, renderLinkedinCompany, renderLinkedinPerson, renderLogin, renderUnsupported, type PanelDeps } from "./views";

const root = document.getElementById("view")!;
const connection = document.getElementById("connection")!;
const signOut = document.getElementById("sign-out") as HTMLButtonElement;
const refresh = document.getElementById("refresh") as HTMLButtonElement;

let auth: AuthStatus = { state: "signed_out", user: null, baseUrl: "" };
let lastKey = "";

const deps: PanelDeps = {
  get baseUrl() {
    return auth.baseUrl;
  },
  get user() {
    return auth.user;
  },
  api: {
    get: (path) => rpc({ type: "api", method: "GET", path }),
    post: (path, body) => rpc({ type: "api", method: "POST", path, body }),
  },
  async login(baseUrlRaw, email, password) {
    const baseUrl = normalizeBaseUrl(baseUrlRaw);
    // Host access is requested only for the configured backend origin, at sign-in, from a user gesture.
    const granted = await chrome.permissions.request({ origins: [originPattern(baseUrl)] });
    if (!granted) throw new Error("Permission to contact the Tuck platform was declined.");
    await rpc({ type: "setBaseUrl", baseUrl });
    await rpc<User>({ type: "login", email, password });
    await loadAuth();
    await render(true);
  },
  async logout() {
    await rpc({ type: "logout" });
    await loadAuth();
    await render(true);
  },
  async refreshContext() {
    await render(true, true);
  },
  onAuthLost() {
    void loadAuth().then(() => render(true));
  },
};

async function loadAuth() {
  auth = await rpc<AuthStatus>({ type: "status" });
  connection.replaceChildren(
    h("span", { class: `dot dot-${auth.state === "signed_in" ? "ok" : auth.state === "expired" ? "warn" : "off"}` }),
    auth.state === "signed_in" ? `${auth.user?.email ?? "Connected"}` : auth.state === "expired" ? "Session expired" : "Not connected",
  );
  connection.setAttribute("title", auth.state === "signed_in" ? `Connected to ${auth.baseUrl}` : "Sign in to connect");
  signOut.hidden = auth.state !== "signed_in";
}

async function render(force = false, fresh = false) {
  if (auth.state !== "signed_in") {
    lastKey = "login";
    return renderLogin(root, auth, deps);
  }
  let ctx: PageContext;
  try {
    ctx = await rpc<PageContext>({ type: fresh ? "refreshContext" : "getContext" });
  } catch (e) {
    mount(root, h("p", { class: "status status-error" }, (e as Error).message));
    return;
  }
  const key = JSON.stringify(ctx);
  if (!force && key === lastKey) return;
  lastKey = key;
  root.setAttribute("aria-busy", "true");
  try {
    switch (ctx.kind) {
      case "linkedin_company":
        return await renderLinkedinCompany(root, ctx, deps);
      case "linkedin_person":
        return await renderLinkedinPerson(root, ctx, deps);
      case "gmail_thread":
        return await renderGmail(root, ctx, deps);
      case "tuck_crm":
        return renderCrm(root, ctx, deps);
      default:
        return renderUnsupported(root, ctx);
    }
  } finally {
    root.removeAttribute("aria-busy");
  }
}

chrome.runtime.onMessage.addListener((msg: Broadcast) => {
  if (msg?.type === "contextChanged") {
    // Re-read from the background, which merges content-script detail with the active tab's URL.
    void render(false);
  } else if (msg?.type === "authChanged") {
    auth = msg.status;
    void loadAuth().then(() => render(true));
  }
  return false;
});

signOut.addEventListener("click", () => void deps.logout());
refresh.addEventListener("click", () => void deps.refreshContext());

void loadAuth().then(() => render(true, true));
