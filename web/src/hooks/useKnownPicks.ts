import { useMemo } from "react";
import type { DictionarySlug } from "../api/dictionaries";
import { useDictionaryOptions } from "./useDictionaryOptions";

/**
 * The stored picks of a multi-value filter, minus the ones whose option no longer exists
 * (a deleted team, an archived dictionary entry) — but only ONCE the options have arrived
 * (`source` undefined = still loading or failed: the stored picks stand, so a slow options
 * request never silently widens the first page, the DaysOff org-team idiom). The result keeps a
 * stable identity between renders and across the options arriving when nothing is dropped (it rides `usePagedSort`'s deps and query keys); stale picks
 * are never rewritten into storage here — the next user change persists the cleaned set.
 * `isKnown` must be a module-level function (it is a memo dependency).
 */
export function useKnownPicks<S>(
  picks: string[],
  source: S | undefined,
  isKnown: (source: S, pick: string) => boolean,
): string[] {
  return useMemo(() => {
    if (source === undefined) return picks;
    const kept = picks.filter((pick) => isKnown(source, pick));
    // Nothing dropped: hand back the stored array itself, so the options arriving never
    // changes the identity the page-reset effect watches (it would jump the user to page 1).
    return kept.length === picks.length ? picks : kept;
  }, [picks, source, isKnown]);
}

/** `isKnown` over a loaded team list: the pick is a team id string. */
export const isKnownTeam = (teams: readonly { id: number }[], pick: string): boolean =>
  teams.some((team) => String(team.id) === pick);

/** `isKnown` over Mantine options: the pick is an option value. */
export const isKnownOption = (options: readonly { value: string }[], pick: string): boolean =>
  options.some((option) => option.value === pick);

/**
 * A dictionary-backed filter: the picker's options plus the stored picks cleaned of archived
 * entries once the dictionary has loaded. `extraKnown` values (the career pyramid's "Not set"
 * sentinel) always stay valid — pass a module-level array.
 */
export function useKnownDictionaryPicks(
  slug: DictionarySlug,
  stored: string[],
  extraKnown: readonly string[] = NO_EXTRA,
): { options: { value: string; label: string }[]; picks: string[] } {
  const { options, loading, error } = useDictionaryOptions(slug);
  const source = useMemo(
    () => (loading || error ? undefined : { options, extraKnown }),
    [loading, error, options, extraKnown],
  );
  const picks = useKnownPicks(stored, source, isKnownDictionaryPick);
  return { options, picks };
}

const NO_EXTRA: readonly string[] = [];

const isKnownDictionaryPick = (
  source: { options: readonly { value: string }[]; extraKnown: readonly string[] },
  pick: string,
): boolean => source.extraKnown.includes(pick) || isKnownOption(source.options, pick);
