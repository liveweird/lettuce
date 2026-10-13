import { Stack, Text } from "@mantine/core";

// The shared option shape for every "pick a person" Select/MultiSelect: the LABEL stays the
// plain name (Mantine mirrors it into the closed input value and every MultiSelect chip — a
// team suffix there would bloat both, see userOption below), while `teamNames` feeds the
// dimmed subtitle renderUserOption draws in the dropdown and `keywords` feeds the theme-wide
// foldedOptionsFilter (utils/text.ts) so typing a team name also matches. Both stay OPTIONAL
// (the renderPeriodOption/ReviewPeriodOption precedent, useReviewPeriodOptions.tsx) — Mantine's
// `renderOption` prop is typed over the bare `ComboboxItem<string>` regardless of what `data`
// actually holds, so a required extra field would fail assignability at every call site.
export type UserOption = {
  value: string;
  label: string;
  teamNames?: string[];
  keywords?: string;
};

/** Builds a team-aware person option — the ONE builder every picker's option list uses. */
export function userOption(id: number, name: string, teamNames: string[]): UserOption {
  return { value: String(id), label: name, teamNames, keywords: teamNames.join(" ") };
}

/**
 * THE picker rule for deactivated people: a picker that creates a NEW reference (a recipient,
 * a provider, a manager, a member, a sharee, a candidate) never offers a deactivated account —
 * the server answers 400 on submit — but a value that is ALREADY selected/stored stays
 * (`keepIds`), so editing an existing record never blanks its Select. List FILTER dropdowns
 * are not pickers of new references (they select historical data) and do not use this.
 */
export function activeOnly<T extends { id: number; deactivated?: boolean | null }>(
  users: readonly T[],
  keepIds: Iterable<number> = [],
): T[] {
  const keep = new Set(keepIds);
  return users.filter((u) => !u.deactivated || keep.has(u.id));
}

// The shared person-picker renderOption (modelled on PeriodOptionLabel in
// useReviewPeriodOptions.tsx): the name always, and — only when the person belongs to at least
// one team — a dimmed second line of team names joined by " · ". Deliberately NOT part of the
// label text: see the UserOption doc comment above. Tolerates options built without teamNames
// (renders just the name), the same forgiving contract as renderPeriodOption.
export function renderUserOption({ option }: { option: UserOption }) {
  const teamNames = option.teamNames ?? [];
  return (
    <Stack gap={0}>
      <Text size="sm">{option.label}</Text>
      {teamNames.length > 0 && (
        <Text size="xs" c="dimmed">
          {teamNames.join(" · ")}
        </Text>
      )}
    </Stack>
  );
}
