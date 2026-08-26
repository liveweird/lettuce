import { describe, expect, test } from "vitest";
import type { TFunction } from "i18next";
import { ApiError } from "../api/http";
import type { SuccessionNominationResponse, SuccessionPlanResponse } from "../api/successionPlans";
import {
  definitionDirty,
  emptyNominationValues,
  emptySuccessionPlanValues,
  emptyTextRowDraft,
  nominationValidation,
  successionLoadErrorMessage,
  successionPlanValidation,
  successionSaveErrorMessage,
  toNominationBody,
  toNominationFormValues,
  toSuccessionPlanBody,
  toSuccessionPlanFormValues,
} from "./successionForm";

const t = ((key: string) => key) as unknown as TFunction;

const plan: SuccessionPlanResponse = {
  id: 5,
  managerId: 1,
  managerName: "Mona",
  userId: 2,
  userName: "Sam",
  roleCriticality: "CRITICAL",
  retentionRisk: "HIGH",
  lossImpact: ["Client trust", "Domain knowledge"],
  targetBenchDepth: 3,
  status: "OPEN",
  benchCount: 1,
  nominations: [],
  createdAt: 1,
  lastReviewedAt: 2,
};

const nomination: SuccessionNominationResponse = {
  id: 9,
  planId: 5,
  candidateId: 4,
  candidateName: "Cleo",
  readiness: "READY_NOW",
  nominationType: "SECONDARY",
  competencyGaps: [{ text: "Budget ownership", filled: true }],
  awareness: "CONFIDENTIAL",
  goals: [
    { id: 11, title: "Lead on-call", status: "ACTIVE", type: "NUMBER" },
    { id: 7, title: "Board deck", status: "DRAFT", type: "NUMBER" },
  ],
  createdAt: 1,
  lastModified: 2,
};

describe("succession form mapping", () => {
  test("draft rows get unique React keys", () => {
    const a = emptyTextRowDraft("x");
    const b = emptyTextRowDraft("x");
    expect(a.key).not.toBe(b.key);
    expect(a.value).toBe("x");
  });

  test("plan values round-trip: response → form → body (rows trimmed)", () => {
    const values = toSuccessionPlanFormValues(plan);
    expect(values.roleCriticality).toBe("CRITICAL");
    expect(values.lossImpact.map((row) => row.value)).toEqual(["Client trust", "Domain knowledge"]);
    values.lossImpact[0].value = "  Client trust  ";
    const body = toSuccessionPlanBody(values);
    expect(body).toEqual({
      roleCriticality: "CRITICAL",
      retentionRisk: "HIGH",
      lossImpact: ["Client trust", "Domain knowledge"],
      targetBenchDepth: 3,
    });
  });

  test("nomination values round-trip keeps the goal link order and numeric ids", () => {
    const values = toNominationFormValues(nomination);
    expect(values.candidateId).toBe("4");
    expect(values.goalIds).toEqual(["11", "7"]);
    const body = toNominationBody(values);
    expect(body.candidateId).toBe(4);
    expect(body.goalIds).toEqual([11, 7]);
    expect(body.competencyGaps).toEqual([{ text: "Budget ownership", filled: true }]);
  });

  test("empty defaults: plan CORE/MEDIUM/depth 2, nomination READY_SOON/PRIMARY/IMPLICIT", () => {
    const planValues = emptySuccessionPlanValues();
    expect(planValues.roleCriticality).toBe("CORE");
    expect(planValues.targetBenchDepth).toBe(2);
    const nominationValues = emptyNominationValues();
    expect(nominationValues.candidateId).toBeNull();
    expect(nominationValues.readiness).toBe("READY_SOON");
    expect(nominationValues.awareness).toBe("IMPLICIT");
  });
});

describe("succession validation", () => {
  test("bench depth must be a whole number within 1..10", () => {
    const rules = successionPlanValidation(t);
    expect(rules.targetBenchDepth(2)).toBeNull();
    expect(rules.targetBenchDepth("")).toBe("succession.validation.benchDepth");
    expect(rules.targetBenchDepth(0)).toBe("succession.validation.benchDepth");
    expect(rules.targetBenchDepth(11)).toBe("succession.validation.benchDepth");
    expect(rules.targetBenchDepth(2.5)).toBe("succession.validation.benchDepth");
  });

  test("list rows must be non-blank and bounded", () => {
    const rules = successionPlanValidation(t);
    expect(rules.lossImpact.value("fine")).toBeNull();
    expect(rules.lossImpact.value("   ")).toBe("succession.validation.itemRequired");
    expect(rules.lossImpact.value("x".repeat(201))).toBe("succession.validation.itemTooLong");
  });

  test("a nomination needs a candidate", () => {
    const rules = nominationValidation(t);
    expect(rules.candidateId(null)).toBe("succession.validation.candidateRequired");
    expect(rules.candidateId("4")).toBeNull();
  });
});

describe("succession error mapping", () => {
  test("load errors: 404, 403, everything else", () => {
    expect(successionLoadErrorMessage(new ApiError(404, null), t)).toBe("succession.error.notFound");
    expect(successionLoadErrorMessage(new ApiError(403, null), t)).toBe(
      "succession.error.viewPermission",
    );
    expect(successionLoadErrorMessage(new Error("boom"), t)).toBe("succession.error.loadFailed");
  });

  test("save errors: the 409 conflict wording, the 400 invalid wording", () => {
    expect(successionSaveErrorMessage(new ApiError(409, null), t)).toBe(
      "succession.error.conflict",
    );
    expect(successionSaveErrorMessage(new ApiError(400, null), t)).toBe("succession.error.invalid");
    expect(successionSaveErrorMessage(new Error("net"), t)).toBe("succession.error.saveFailed");
  });
});

describe("definitionDirty (checkup-29 — payload compare, not Mantine dirty flags)", () => {
  test("clean form matches the stored plan", () => {
    expect(definitionDirty(toSuccessionPlanFormValues(plan), plan)).toBe(false);
  });

  test("a list REORDER counts as dirty (the isDirty blind spot)", () => {
    const values = toSuccessionPlanFormValues(plan);
    values.lossImpact = [values.lossImpact[1], values.lossImpact[0]];
    expect(definitionDirty(values, plan)).toBe(true);
  });

  test("a removed row and a scalar change count as dirty", () => {
    const removed = toSuccessionPlanFormValues(plan);
    removed.lossImpact = removed.lossImpact.slice(0, 1);
    expect(definitionDirty(removed, plan)).toBe(true);
    const scalar = toSuccessionPlanFormValues(plan);
    scalar.targetBenchDepth = 5;
    expect(definitionDirty(scalar, plan)).toBe(true);
  });
});
