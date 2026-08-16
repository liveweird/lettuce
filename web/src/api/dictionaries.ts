// Dictionaries API — the four global ordered lists.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { ApiError, authedFetch, safeJson } from "./http";
import type { components, paths } from "./schema";

export type DictionarySlug =
  | "career-paths"
  | "career-specializations"
  | "seniority-levels"
  | "pulse-rotating-questions";
export type DictionaryEntry = components["schemas"]["DictionaryEntry"];
export type DictionaryUpdateBody = components["schemas"]["DictionaryUpdateRequest"];
type DictionaryEntryListResponse =
  paths["/api/v1/dictionaries/{dictionary}"]["get"]["responses"]["200"]["content"]["application/json"];

/** The dictionary's active entries in the admin-curated order (unpaged — at most 200). */
export async function getDictionary(slug: DictionarySlug): Promise<DictionaryEntry[]> {
  const res = await authedFetch(`/api/v1/dictionaries/${slug}`);
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
  return ((await res.json()) as DictionaryEntryListResponse).items;
}

/** Whole-document replace (ADMIN): payload order becomes the stored order. */
export async function updateDictionary(slug: DictionarySlug, body: DictionaryUpdateBody): Promise<void> {
  const res = await authedFetch(`/api/v1/dictionaries/${slug}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await safeJson(res));
}
