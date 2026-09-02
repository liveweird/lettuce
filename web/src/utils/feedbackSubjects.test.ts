import { describe, expect, test } from "vitest";
import type { TFunction } from "i18next";
import { feedbackSubjectNames, feedbackSubjects, subjectDisplays } from "./feedbackSubjects";

const t = ((key: string) => (key === "common.state.you" ? "You" : key)) as unknown as TFunction;

describe("feedbackSubjects", () => {
  test("returns the position-ordered subjects list when present", () => {
    const row = {
      subjectId: 1,
      subjectName: "Ann",
      subjectDeleted: false,
      subjects: [
        { id: 1, name: "Ann", deleted: false },
        { id: 2, name: "Ben", deleted: true },
      ],
    };
    expect(feedbackSubjects(row).map((s) => s.id)).toEqual([1, 2]);
    expect(feedbackSubjectNames(row)).toBe("Ann, Ben");
  });

  test("falls back to the legacy subjectId/subjectName pair", () => {
    expect(feedbackSubjects({ subjectId: 5, subjectName: "Mona" })).toEqual([
      { id: 5, name: "Mona", deleted: false },
    ]);
    expect(feedbackSubjects({ subjectId: 5, subjectName: null, subjects: [] })).toEqual([
      { id: 5, name: "#5", deleted: false },
    ]);
  });

  test("subjectDisplays renders the current user as You by id", () => {
    const row = {
      subjectId: 1,
      subjects: [
        { id: 1, name: "Ann" },
        { id: 7, name: "Myself" },
      ],
    };
    expect(subjectDisplays(row, 7, t)).toEqual([
      { display: "Ann", isYou: false },
      { display: "You", isYou: true },
    ]);
    expect(subjectDisplays(row, null, t).every((s) => !s.isYou)).toBe(true);
  });
});
