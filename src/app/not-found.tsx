"use client";

import Link from "next/link";
import { useI18n } from "@/i18n/provider";

export default function NotFound() {
  const { t: tr } = useI18n();
  return (
    <main>
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col items-center justify-center gap-6 px-4 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-muted">
          404
        </p>
        <h1 className="text-3xl font-semibold text-fg">
          {tr("Page not found")}
        </h1>
        <p className="text-base text-muted">
          {tr("The page you are looking for does not exist or may have moved.")}
        </p>
        <Link
          href="/"
          className="btn-primary inline-flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          {tr("Back to home")}
        </Link>
      </div>
    </main>
  );
}
