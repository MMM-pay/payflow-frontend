"use client";

import { useI18n } from "@/i18n/provider";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { config } from "@/lib/config";
import { directTargets, parseQuery, planTargets, type SearchTarget } from "@/lib/search";

/**
 * Header search: an address opens the merchant page or that account's
 * subscriptions, a number opens the mandate or plan with that id, and text
 * matches plan names. Plans are loaded once, on the first text query, from
 * the indexer when one is configured and from the contract otherwise.
 */
export function Search({ onNavigate }: { onNavigate: (href: string) => void }) {
  const { t: tr } = useI18n();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [plans, setPlans] = useState<{ id: number; name: string }[] | null>(null);
  const loading = useRef(false);

  const parsed = useMemo(() => parseQuery(query), [query]);

  useEffect(() => {
    if (parsed.kind !== "text" || plans || loading.current) return;
    loading.current = true;
    void (async () => {
      try {
        const res = await api.plans();
        // The contract path pulls in the Stellar SDK; load it only when needed.
        const loaded = res ? res.plans : await (await import("@/lib/chain")).chainPlans(config.readSource);
        setPlans(loaded);
      } catch {
        setPlans([]);
      } finally {
        loading.current = false;
      }
    })();
  }, [parsed, plans]);

  const results: SearchTarget[] = useMemo(
    () => (parsed.kind === "text" ? planTargets(plans ?? [], parsed.text) : directTargets(parsed)),
    [parsed, plans],
  );

  function go(target: SearchTarget) {
    setOpen(false);
    setQuery("");
    onNavigate(target.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = results[Math.min(active, results.length - 1)];
      if (target) go(target);
    }
  }

  const showList = open && parsed.kind !== "empty";
  const empty = parsed.kind === "text" && plans !== null && results.length === 0;

  return (
    <div className="relative w-full max-w-sm">
      <label htmlFor="global-search" className="sr-only">
        {tr("Search plans, merchants and mandates")}
      </label>
      <input
        id="global-search"
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results.length ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        placeholder={tr("Search address, id or plan name ( / )")}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="w-full rounded-lg border border-edge bg-transparent px-3 py-1.5 text-sm text-fg placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={tr("Search results")}
        hidden={!showList}
        className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-edge bg-bg shadow-lg"
      >
        {results.map((target, index) => (
          <li
            key={target.href}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            // mousedown runs before the input's blur closes the list.
            onMouseDown={(event) => {
              event.preventDefault();
              go(target);
            }}
            className={`cursor-pointer px-3 py-2 text-sm ${index === active ? "bg-fg/10 text-fg" : "text-muted"}`}
          >
            {tr(target.label, target.values)}
          </li>
        ))}
        {empty && <li className="px-3 py-2 text-sm text-muted">{tr("No plans match")}</li>}
      </ul>
    </div>
  );
}
