import { redirect } from "next/navigation";
import { Logo } from "@/components/site/chrome";
import { LoginForm } from "@/components/app/login-form";
import { currentUser } from "@/server/session";

export const metadata = { title: "Sign in", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/app");
  return (
    <main className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_top,rgba(176,141,87,0.14),transparent_60%)] px-4">
      <div className="w-full max-w-sm">
        <Logo className="mb-8 justify-center" />
        <div className="surface rounded-xl p-6 shadow-card">
          <h1 className="font-serif text-xl font-semibold">Team sign-in</h1>
          <p className="muted mb-5 mt-1 text-sm">Access is limited to Tuck Advisors staff.</p>
          <LoginForm />
        </div>
        {process.env.NODE_ENV !== "production" && (
          <p className="muted mt-4 text-center text-xs">Local demo: owner@tuck.example (or admin@ / analyst@ / viewer@) with your SEED_PASSWORD.</p>
        )}
      </div>
    </main>
  );
}
