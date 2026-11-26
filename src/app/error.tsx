"use client";

import { ErrorRecovery } from "@/components/ErrorRecovery";

export default function ErrorRouteFallback({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl justify-center px-4 py-10">
      <ErrorRecovery
        onRetry={reset}
        onReload={() => window.location.reload()}
        detail={error.message}
      />
    </div>
  );
}
