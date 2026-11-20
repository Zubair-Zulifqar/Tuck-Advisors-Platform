import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div><p className="eyebrow">404</p><h1 className="mt-2 font-serif text-3xl">We couldn&apos;t find that page.</h1><Link href="/" className="mt-4 inline-block underline">Return home</Link></div>
    </main>
  );
}
