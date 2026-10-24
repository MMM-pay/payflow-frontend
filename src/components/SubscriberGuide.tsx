"use client";

import { useState, useSyncExternalStore } from "react";
import { useI18n } from "@/i18n/provider";

const STORAGE_KEY = "payflow.subscriber-guide.seen";
const GUIDE_CHANGE_EVENT = "payflow-subscriber-guide-change";

function subscribeToGuideChanges(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  window.addEventListener(GUIDE_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(GUIDE_CHANGE_EVENT, onChange);
  };
}

function getGuideSeen() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

const STEPS = [
  {
    title: "Fund your vault",
    body: "Deposit the plan token into your vault before subscribing. Your balance stays yours and can be withdrawn at any time.",
  },
  {
    title: "Authorize a mandate",
    body: "Your signature creates permission to collect the plan price on each billing date. You do not need to sign every charge.",
  },
  {
    title: "Cancel any time",
    body: "Cancel from your account page to stop future charges. Any unspent vault balance remains yours.",
  },
];

export function SubscriberGuide() {
  const { t: tr } = useI18n();
  const seen = useSyncExternalStore(subscribeToGuideChanges, getGuideSeen, () => false);
  const [dismissedInMemory, setDismissedInMemory] = useState(false);
  const [reopened, setReopened] = useState(false);
  const open = reopened || (!seen && !dismissedInMemory);

  function dismiss() {
    setDismissedInMemory(true);
    setReopened(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Keep the guide dismissible when browser storage is unavailable.
    }
    window.dispatchEvent(new Event(GUIDE_CHANGE_EVENT));
  }

  return (
    <section className="rounded-lg border border-edge bg-surface/50 p-4" aria-labelledby="subscriber-guide-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="subscriber-guide-title" className="text-base font-semibold">
          {tr("How subscriptions work")}
        </h2>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => open ? dismiss() : setReopened(true)}
          aria-expanded={open === true}
          aria-controls="subscriber-guide-steps"
        >
          {open ? tr("Skip guide") : tr("Show guide")}
        </button>
      </div>
      <ol id="subscriber-guide-steps" className="mt-4 grid gap-4 sm:grid-cols-3" hidden={!open}>
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-edge text-xs text-muted" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <h3 className="text-sm font-medium">{tr(step.title)}</h3>
              <p className="mt-1 text-sm text-muted">{tr(step.body)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}