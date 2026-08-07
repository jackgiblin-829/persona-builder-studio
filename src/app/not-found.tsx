import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="text-sm text-ink-muted">
        The page you asked for does not exist, or you do not have access to it.
      </p>
      <Link href="/" className="text-sm font-medium text-accent hover:underline">
        Back to your brands
      </Link>
    </main>
  );
}
