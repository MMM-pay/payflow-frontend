import { useCallback, useRef, useState } from "react";

export type ActionState = {
  busy: boolean;
  error: string | null;
  done: boolean;
};

export type ActionStates = Record<string, ActionState>;

export const EMPTY_ACTION_STATE: ActionState = {
  busy: false,
  error: null,
  done: false,
};

export function getActionState(
  states: ActionStates,
  key: string,
): ActionState {
  return states[key] ?? EMPTY_ACTION_STATE;
}

export function mergeActionState(
  states: ActionStates,
  key: string,
  patch: Partial<ActionState>,
): ActionStates {
  const prev = getActionState(states, key);
  return { ...states, [key]: { ...prev, ...patch } };
}

export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || "Something went wrong.";
  if (typeof err === "string") return err || "Something went wrong.";
  return "Something went wrong.";
}

export type RunAction = <T>(
  key: string,
  fn: () => Promise<T>,
) => Promise<T | undefined>;

export type UseActionResult = {
  states: ActionStates;
  run: RunAction;
  reset: (key: string) => void;
  getState: (key: string) => ActionState;
};

// React hook that manages busy/error/done state for keyed async actions.
// The pure helpers above are exported so they can be tested without rendering React.
export function useAction(): UseActionResult {
  // Lazy init so each component instance gets its own map.
  const [states, setStates] = useState<ActionStates>({});
  const runIdRef = useRef<Record<string, number>>({});

  const setState = useCallback(
    (key: string, patch: Partial<ActionState>) => {
      setStates((prev) => mergeActionState(prev, key, patch));
    },
    [],
  );

  const run = useCallback(
    async <T>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
      const id = (runIdRef.current[key] ?? 0) + 1;
      runIdRef.current[key] = id;
      setState(key, { busy: true, error: null, done: false });
      try {
        const result = await fn();
        // If a newer run started for this key, ignore this result.
        if (runIdRef.current[key] !== id) return result;
        setState(key, { busy: false, error: null, done: true });
        return result;
      } catch (err) {
        if (runIdRef.current[key] !== id) return undefined;
        setState(key, { busy: false, error: toErrorMessage(err), done: false });
        return undefined;
      }
    },
    [setState],
  );

  const reset = useCallback(
    (key: string) => {
      runIdRef.current[key] = (runIdRef.current[key] ?? 0) + 1;
      setState(key, { busy: false, error: null, done: false });
    },
    [setState],
  );

  const getState = useCallback(
    (key: string) => getActionState(states, key),
    [states],
  );

  return {
    states,
    run,
    reset,
    getState,
  };
}
