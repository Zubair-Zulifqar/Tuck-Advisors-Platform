import Link from "next/link";
import { Logo } from "@/components/site/chrome";
import { NavLinks } from "@/components/app/nav";
import { Providers } from "@/components/providers";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <Providers>
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="border-b hairline bg-[var(--surface)] lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-4 py-4 lg:block">
            <Logo />
            <p className="muted hidden pt-1 text-xs lg:block">{user.organizationName}</p>
          </div>
          <NavLinks />
          <div className="hidden border-t hairline px-4 py-3 text-xs lg:absolute lg:bottom-0 lg:block lg:w-full">
            <p className="truncate font-medium">{user.name ?? user.email}</p>
            <p className="muted capitalize">{user.role}</p>
            <form action="/api/auth/logout" method="post" className="mt-2"><button className="muted underline">Sign out</button></form>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">{children}</main>
      </div>
      <Link href="/" className="sr-only">Public site</Link>
    </Providers>
  );
}
