import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import { notifications } from "@mantine/notifications";
import PulseSurvey from "./PulseSurvey";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";

type FetchMock = ReturnType<typeof vi.fn>;

const OPEN_CYCLE = {
  id: 3,
  status: "OPEN",
  plannedOpenDate: "2026-08-01",
  plannedCloseDate: "2026-08-08",
  rotatingQuestionEn: "Good work is recognized here." as string | null,
  rotatingQuestionPl: "Dobra praca jest tu doceniana." as string | null,
  createdAt: 0,
  lastModified: 0,
};

const SAVED = {
  cycleId: 3,
  enps: 8,
  q2: "4",
  q3: "3",
  q4: "5",
  q5: "NA",
  rotating: "2",
  comment: "earlier thoughts",
  submittedAt: 1,
  lastModified: 2,
};

const FIXED_QUESTIONS = [
  "I understand what is expected of me in my role.",
  "I receive the support I need from my manager.",
  "I feel safe raising concerns or suggesting improvements.",
  "My current workload is manageable over the long term.",
];

describe("PulseSurvey (wizard)", () => {
  let mockFetch: FetchMock;

  function setupMocks({
    cycles = [OPEN_CYCLE],
    myResponse = null as unknown,
    myResponseStatus = 404,
  } = {}) {
    // Upsert semantics like the real server: after a PUT the GET returns the stored row,
    // so the post-save refetch flips the page to the saved-summary screen.
    let stored = myResponse;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.includes("/my-response") && method === "PUT") {
        stored = {
          cycleId: OPEN_CYCLE.id,
          ...JSON.parse(init!.body as string),
          submittedAt: 1,
          lastModified: 2,
        };
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes("/my-response")) {
        return Promise.resolve(
          stored != null
            ? jsonResponse(200, stored)
            : jsonResponse(myResponseStatus, { title: "nope", status: myResponseStatus }),
        );
      }
      if (url.includes("/pulse-surveys/cycles")) {
        return Promise.resolve(jsonResponse(200, { items: cycles }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  /** Answers the currently shown agreement question, then advances via Next (v2.5.9 —
   *  answering never auto-advances). */
  async function answerCurrentScale(
    user: ReturnType<typeof userEvent.setup>,
    question: string,
    point = "Agree",
  ) {
    const group = await screen.findByRole("radiogroup", { name: question });
    await user.click(within(group).getByRole("radio", { name: point }));
    await user.click(screen.getByRole("button", { name: "Next" }));
  }

  test("no open cycle → the clear status message, never data", async () => {
    setupMocks({ cycles: [{ ...OPEN_CYCLE, status: "SCHEDULED", rotatingQuestionEn: null, rotatingQuestionPl: null }] });
    renderWithProviders(<PulseSurvey />);
    expect(await screen.findByText("There is no pulse survey open right now.")).toBeInTheDocument();
    expect(screen.queryByText(/recognized here/)).toBeNull();
  });

  test("a non-participant gets the status message on the 403", async () => {
    setupMocks({ myResponseStatus: 403 });
    renderWithProviders(<PulseSurvey />);
    expect(
      await screen.findByText("You are not a participant of the current pulse cycle."),
    ).toBeInTheDocument();
  });

  test("the wizard opens on Q1 only — later questions hidden, Back and Next gated", async () => {
    setupMocks();
    renderWithProviders(<PulseSurvey />);
    expect(
      await screen.findByText("How likely are you to recommend this company as a place to work?"),
    ).toBeInTheDocument();
    expect(screen.getByText("Question 1 of 7")).toBeInTheDocument();
    expect(screen.getByText("0 of 6 answered")).toBeInTheDocument();
    expect(screen.getByText("Not at all likely")).toBeInTheDocument();
    // One question per step: none of the later questions are on screen.
    expect(screen.queryByText(FIXED_QUESTIONS[0])).toBeNull();
    expect(screen.queryByText("Good work is recognized here.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit survey" })).toBeNull();
    // Back has nowhere to go; Next waits for an answer.
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  test("answering enables Next but never auto-advances; Back returns with the selection kept", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderWithProviders(<PulseSurvey />);
    await screen.findByText("Question 1 of 7");

    await user.click(screen.getByRole("radio", { name: "9" }));
    // Answering stays on the question (v2.5.9 — no auto-advance); Next unlocks.
    expect(screen.getByText("Question 1 of 7")).toBeInTheDocument();
    expect(screen.getByText("1 of 6 answered")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText(FIXED_QUESTIONS[0])).toBeInTheDocument();
    expect(screen.getByText("Question 2 of 7")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Question 1 of 7")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "9" })).toBeChecked();
    // Forward again without changing the answer: Next is still enabled.
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Question 2 of 7")).toBeInTheDocument();
  });

  test("the full walk: fixed questions, the verbatim rotating text, the band prompt, the PUT body", async () => {
    setupMocks();
    const toast = vi.spyOn(notifications, "show");
    const user = userEvent.setup();
    renderWithProviders(<PulseSurvey />);
    await screen.findByText("Question 1 of 7");

    await user.click(screen.getByRole("radio", { name: "9" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    for (const question of FIXED_QUESTIONS) {
      await answerCurrentScale(user, question);
    }
    // Q6 is the server's snapshotted wording, not localized; answer it NA.
    await answerCurrentScale(user, "Good work is recognized here.", "Not applicable");

    // The comment step: the promoter-band prompt (eNPS 9) + the anonymity reminder.
    expect(await screen.findByText("Question 7 of 7")).toBeInTheDocument();
    expect(screen.getByText("6 of 6 answered")).toBeInTheDocument();
    expect(screen.getByText(/don't include names/)).toBeInTheDocument();
    await user.type(
      screen.getByLabelText(/What should we make sure to preserve?/),
      "keep the pulse",
    );

    await user.click(screen.getByRole("button", { name: "Submit survey" }));
    await waitFor(() => {
      const put = mockFetch.mock.calls.find(
        ([url, init]) => String(url).includes("/my-response") && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeTruthy();
      expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({
        enps: 9,
        q2: "4",
        q3: "4",
        q4: "4",
        q5: "4",
        rotating: "NA",
        comment: "keep the pulse",
      });
    });
    expect(toast).toHaveBeenCalled();
    // A successful save lands on the saved-summary screen (v2.5.9), not back in the wizard.
    expect(await screen.findByText(/Your answers are saved/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit my answers" })).toBeInTheDocument();
    expect(screen.queryByText("Question 1 of 7")).toBeNull();
  });

  test("an existing response parks on the saved summary; Edit my answers reopens the wizard prefilled", async () => {
    setupMocks({ myResponse: SAVED });
    const user = userEvent.setup();
    renderWithProviders(<PulseSurvey />);
    // The summary screen (v2.5.9): the saved notice + the edit entry — no questions yet.
    expect(await screen.findByText(/Your answers are saved/)).toBeInTheDocument();
    expect(screen.queryByText("Question 1 of 7")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Edit my answers" }));
    expect(await screen.findByText("Question 1 of 7")).toBeInTheDocument();
    expect(screen.getByText("6 of 6 answered")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "8" })).toBeChecked();

    // Every step is answered, so Next walks straight through.
    for (let i = 0; i < 6; i++) {
      await user.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(await screen.findByText("Question 7 of 7")).toBeInTheDocument();
    // The passive-band prompt (eNPS 8) + the prefilled comment + the edit-mode button.
    expect(screen.getByText("What would improve your experience by one point?")).toBeInTheDocument();
    expect(screen.getByDisplayValue("earlier thoughts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  test("a cycles load failure shows the load-failed alert", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(500, { title: "boom", status: 500 })));
    renderWithProviders(<PulseSurvey />);
    expect(await screen.findByText("Loading failed. Refresh to retry.")).toBeInTheDocument();
  });

  test("a submit failure surfaces inline and keeps the wizard on the comment step", async () => {
    setupMocks({ myResponse: SAVED });
    // The PUT rejects (cycle closed under the user's feet -> 409).
    const base = mockFetch.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("/my-response") && init?.method === "PUT") {
        return Promise.resolve(jsonResponse(409, { title: "closed", status: 409 }));
      }
      return base(url, init);
    });
    const user = userEvent.setup();
    renderWithProviders(<PulseSurvey />);
    await screen.findByText(/Your answers are saved/);
    await user.click(screen.getByRole("button", { name: "Edit my answers" }));
    for (let i = 0; i < 6; i++) {
      await user.click(screen.getByRole("button", { name: "Next" }));
    }
    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("The survey is no longer open.")).toBeInTheDocument();
    // Still on the comment step - no reset on failure.
    expect(screen.getByText("Question 7 of 7")).toBeInTheDocument();
  });

  test("the favourability colors ride the controls", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderWithProviders(<PulseSurvey />);
    await screen.findByText("Question 1 of 7");

    // eNPS chips: the promoter 10 is tinted green while unchecked, detractor 0 orange.
    const ten = screen.getByRole("radio", { name: "10" }).closest("div")!;
    expect(ten.querySelector("label")!.getAttribute("style")).toContain("--mantine-color-green-8");
    const zero = screen.getByRole("radio", { name: "0" }).closest("div")!;
    expect(zero.querySelector("label")!.getAttribute("style")).toContain("--mantine-color-orange-9");

    // Agreement radios: the swatch beside "Strongly agree" is green, "Strongly disagree" orange.
    await user.click(screen.getByRole("radio", { name: "9" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    const group = await screen.findByRole("radiogroup", { name: FIXED_QUESTIONS[0] });
    const swatchColor = (label: string) =>
      within(group)
        .getByText(label)
        .closest("div")!
        .querySelector("[style*='--mantine-color']")
        ?.getAttribute("style") ?? "";
    expect(swatchColor("Strongly agree")).toContain("green-8");
    expect(swatchColor("Strongly disagree")).toContain("orange-8");
  });
});
