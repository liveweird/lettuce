// Dictionaries API — the four global ordered lists.
// Thin endpoint wrappers: transport (authedFetch/ApiError) in ./http, session state in ./session.

import { jsonRequest, voidRequest } from "./http";
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
  return (await jsonRequest<DictionaryEntryListResponse>(`/api/v1/dictionaries/${slug}`)).items;
}

/** Whole-document replace (ADMIN): payload order becomes the stored order. */
export async function updateDictionary(slug: DictionarySlug, body: DictionaryUpdateBody): Promise<void> {
  await voidRequest(`/api/v1/dictionaries/${slug}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
