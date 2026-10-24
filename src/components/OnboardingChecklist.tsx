"use client";

import { useI18n } from "@/i18n/provider";

import Link from "next/link";

/** Which of the four first steps a merchant has behind them. */
export interface OnboardingState {
  fundWallet: boolean;
  publishPlan: boolean;
  shareLink: boolean;
  firstSubscriber: boolean;
}

interface Step {
  key: keyof OnboardingState;
  title: string;
  hint: string;
  /** Where the step is done, when it is somewhere other than this page. */
  href?: string;
}

const STEPS: Step[] = [
  {
    key: "fundWallet",
    title: "Fund your wallet",
    hint: "A contract write costs a fee, so the wallet needs a balance before anything can be published.",
    href: "/account",
  },
  {
    key: "publishPlan",
    title: "Publish your first plan",
    hint: "A plan is the price and the billing period a subscriber agrees to.",
  },
  {
    key: "shareLink",
    title: "Share the link",
    hint: "Copy a plan's link or QR code and put it where your customers are.",
  },
  {
    key: "firstSubscriber",
    title: "See your first subscriber",
    hint: "A subscriber appears here as soon as they open a mandate against one of your plans.",
  },
];

/**
 * The four steps between a new merchant and their first subscriber.
 *
 * It disappears for good once dismissed, and says nothing about steps already
 * behind the merchant beyond ticking them: a checklist that keeps explaining
 * what you have already done reads as noise.
 */
export function OnboardingChecklist({
  address,
  state,
  onDismiss,
}: {
  address: string | null;
  state: OnboardingState;
  onDismiss: () => void;
}) {
  const { t: tr } = useI18n();
  const done = STEPS.filter((step) => state[step.key]).length;

  return (
    <section
      aria-labelledby="onboarding-heading"
      className="rounded-xl border border-edge bg-surface/50 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="onboarding-heading" className="text-base font-semibold">
            {tr("Getting started")}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {tr("{0} of {1} done", { "0": done, "1": STEPS.length })}
          </p>
        </div>
        <button type="button" className="btn-ghost text-xs" onClick={onDismiss}>
          {tr("Dismiss")}
        </button>
      </div>

      <ol className="mt-3 space-y-2">
        {STEPS.map((step) => {
          const complete = state[step.key];
          return (
            <li key={step.key} className="flex gap-2 text-sm">
              {/* The tick is decorative: the text after it says the same. */}
              <span aria-hidden="true" className={complete ? "text-accent" : "text-muted"}>
                {complete ? "✓" : "○"}
              </span>
              <span className={complete ? "text-muted line-through" : ""}>
                <span className="sr-only">
                  {complete ? tr("Done:") : tr("To do:")}{" "}
                </span>
                {step.href && !complete && address ? (
                  <Link href={step.href} className="text-accent hover:underline">
                    {tr(step.title)}
                  </Link>
                ) : (
                  tr(step.title)
                )}
                {!complete && <span className="block text-muted">{tr(step.hint)}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
