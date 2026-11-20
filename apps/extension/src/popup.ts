import type { AuthStatus } from "./lib/auth";
import { rpc } from "./lib/messages";

const statusEl = document.getElementById("status")!;
const openBtn = document.getElementById("open-panel") as HTMLButtonElement;
const signOut = document.getElementById("sign-out") as HTMLButtonElement;

async function paint() {
  try {
    const s = await rpc<AuthStatus>({ type: "status" });
    statusEl.textContent =
      s.state === "signed_in" ? `Connected as ${s.user?.email ?? "user"} · ${new URL(s.baseUrl).host}` : s.state === "expired" ? "Session expired — sign in from the side panel." : "Not connected — sign in from the side panel.";
    statusEl.dataset.state = s.state;
    signOut.hidden = s.state !== "signed_in";
  } catch (e) {
    statusEl.textContent = (e as Error).message;
  }
}

openBtn.addEventListener("click", async () => {
  // sidePanel.open must run inside the user gesture.
  const win = await chrome.windows.getCurrent();
  if (win.id !== undefined) await chrome.sidePanel.open({ windowId: win.id });
  window.close();
});

signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  await rpc({ type: "logout" }).catch(() => undefined);
  await paint();
  signOut.disabled = false;
});

void paint();
