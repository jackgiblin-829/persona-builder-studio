"use client";

import { ErrorState } from "@/components/ui";

export default function BrandError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      title="This page could not be loaded"
      message={error.message || "An unexpected error occurred."}
      action={
        <button onClick={reset} className="text-sm font-medium text-accent hover:underline">
          Try again
        </button>
      }
    />
  );
}
