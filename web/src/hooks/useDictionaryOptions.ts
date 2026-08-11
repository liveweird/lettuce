import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getDictionary, type DictionaryEntry, type DictionarySlug } from "../api/client";
import { pickDictionaryValue } from "../utils/dictionaryForm";

// One cached query per dictionary (the ["dictionary", slug] key is shared with
// pages/Dictionary.tsx) mapped to Mantine Select options — the useManagerOptions shape.
// Labels are the viewer's language (V53 bilingual entries). `current` is appended when it
// is no longer among the active entries (soft-deleted since being assigned), so a stale
// value still displays in the picker instead of vanishing.
export function useDictionaryOptions(
  slug: DictionarySlug,
  current?: DictionaryEntry | null,
): { options: { value: string; label: string }[]; loading: boolean } {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const { data, isLoading } = useQuery({
    queryKey: ["dictionary", slug],
    queryFn: () => getDictionary(slug),
    staleTime: 5 * 60 * 1000,
  });

  const options = useMemo(() => {
    const active = (data ?? []).map((e) => ({ value: String(e.id), label: pickDictionaryValue(e, lang) }));
    return current && !active.some((o) => o.value === String(current.id))
      ? [...active, { value: String(current.id), label: pickDictionaryValue(current, lang) }]
      : active;
  }, [data, current, lang]);

  return { options, loading: isLoading };
}
