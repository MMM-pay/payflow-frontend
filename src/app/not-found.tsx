import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col items-center justify-center gap-6 px-4 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          404
        </p>
        <h1 className="text-3xl font-semibold text-foreground">
          Page not found
        </h1>
        <p className="text-base text-muted-foreground">
          The page you are looking for does not exist or may have moved.
        </p>
        <Link
          href="/"
          className="btn-primary inline-flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
