import { describe, expect, test } from "vitest";
import {
  answeredCount,
  commentPromptKey,
  emptyPulseFormValues,
  enpsColor,
  mantineColorVar,
  pulseFormValidation,
  pulseScaleColor,
  toPulseFormValues,
  toPulseSubmitBody,
  PULSE_MAX_COMMENT,
} from "./pulseSurveyForm";
import type { PulseMyResponse } from "../api/client";

const t = (key: string) => key;

describe("commentPromptKey", () => {
  test("bands: 0-6 low, 7-8 mid, 9-10 high, unanswered default", () => {
    expect(commentPromptKey(null)).toBe("default");
    expect(commentPromptKey(0)).toBe("low");
    expect(commentPromptKey(6)).toBe("low");
    expect(commentPromptKey(7)).toBe("mid");
    expect(commentPromptKey(8)).toBe("mid");
    expect(commentPromptKey(9)).toBe("high");
    expect(commentPromptKey(10)).toBe("high");
  });
});

describe("answeredCount", () => {
  test("counts the six scored answers, ignoring the comment", () => {
    const values = emptyPulseFormValues();
    expect(answeredCount(values)).toBe(0);
    values.enps = 5;
    values.q3 = "NA";
    values.comment = "does not count";
    expect(answeredCount(values)).toBe(2);
    values.q2 = "1";
    values.q4 = "4";
    values.q5 = "5";
    values.rotating = "3";
    expect(answeredCount(values)).toBe(6);
  });
});

describe("validation", () => {
  const validate = pulseFormValidation(t);

  test("every scored question is required; the comment is capped", () => {
    expect(validate.enps(null)).toBe("pulse.validation.answerRequired");
    expect(validate.enps(4)).toBeNull();
    expect(validate.q2(null)).toBe("pulse.validation.answerRequired");
    expect(validate.rotating("NA")).toBeNull();
    expect(validate.comment("x".repeat(PULSE_MAX_COMMENT))).toBeNull();
    expect(validate.comment("x".repeat(PULSE_MAX_COMMENT + 1))).toBe("pulse.validation.commentTooLong");
  });
});

describe("favourability colors", () => {
  test("the agreement scale runs orange to green with a neutral NA", () => {
    expect(pulseScaleColor("1")).toBe("orange.8");
    expect(pulseScaleColor("3")).toBe("yellow.6");
    expect(pulseScaleColor("5")).toBe("green.8");
    expect(pulseScaleColor("NA")).toBe("gray.5");
  });

  test("eNPS colors follow the bands: detractors orange, passives yellow-lime, promoters green", () => {
    expect(enpsColor(0)).toBe("orange.9");
    expect(enpsColor(6)).toBe("orange.4");
    expect(enpsColor(7)).toBe("yellow.6");
    expect(enpsColor(8)).toBe("lime.6");
    expect(enpsColor(9)).toBe("green.5");
    expect(enpsColor(10)).toBe("green.8");
    expect(enpsColor(42)).toBe("gray.5");
  });

  test("tokens render as Mantine CSS variables", () => {
    expect(mantineColorVar("green.8")).toBe("var(--mantine-color-green-8)");
  });
});

describe("body mapping", () => {
  test("toPulseSubmitBody trims the comment and omits it when blank", () => {
    const values = {
      ...emptyPulseFormValues(),
      enps: 7,
      q2: "4" as const,
      q3: "NA" as const,
      q4: "2" as const,
      q5: "5" as const,
      rotating: "3" as const,
      comment: "  keep  ",
    };
    expect(toPulseSubmitBody(values)).toEqual({
      enps: 7,
      q2: "4",
      q3: "NA",
      q4: "2",
      q5: "5",
      rotating: "3",
      comment: "keep",
    });
    expect(toPulseSubmitBody({ ...values, comment: "   " })).not.toHaveProperty("comment");
  });

  test("toPulseFormValues roundtrips the saved answers", () => {
    const saved: PulseMyResponse = {
      cycleId: 3,
      enps: 9,
      q2: "5",
      q3: "4",
      q4: "NA",
      q5: "1",
      rotating: "2",
      comment: null,
      submittedAt: 1,
      lastModified: 2,
    };
    const values = toPulseFormValues(saved);
    expect(values.enps).toBe(9);
    expect(values.q4).toBe("NA");
    expect(values.comment).toBe("");
  });
});
