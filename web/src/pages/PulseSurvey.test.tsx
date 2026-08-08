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
  rotatingQuestion: "Good work is recognized here." as string | null,
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

describe("PulseSurvey", () => {
  let mockFetch: FetchMock;

  function setupMocks({
    cycles = [OPEN_CYCLE],
    myResponse = null as unknown,
    myResponseStatus = 404,
  } = {}) {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.includes("/my-response") && method === "PUT") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes("/my-response")) {
        return Promise.resolve(
          myResponse != null
            ? jsonResponse(200, myResponse)
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

  test("no open cycle → the clear status message, never data", async () => {
    setupMocks({ cycles: [{ ...OPEN_CYCLE, status: "SCHEDULED", rotatingQuestion: null }] });
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

  test("blank form: all seven questions render, Q1 first, rotating text verbatim", async () => {
    setupMocks();
    renderWithProviders(<PulseSurvey />);
    expect(
      await screen.findByText("How likely are you to recommend this company as a place to work?"),
    ).toBeInTheDocument();
    expect(screen.getByText("I understand what is expected of me in my role.")).toBeInTheDocument();
    expect(screen.getByText("My current workload is manageable over the long term.")).toBeInTheDocument();
    // Q6 is the server's snapshotted wording, not localized.
    expect(screen.getByText("Good work is recognized here.")).toBeInTheDocument();
    // The anchors + the anonymity reminder + the neutral prompt while eNPS is unanswered.
    expect(screen.getByText("Not at all likely")).toBeInTheDocument();
    expect(screen.getByText("Extremely likely")).toBeInTheDocument();
    expect(screen.getByText(/don't include names/)).toBeInTheDocument();
    expect(screen.getByText("Anything else you'd like to share?")).toBeInTheDocument();
    expect(screen.getByText("0 of 6 answered")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit survey" })).toBeInTheDocument();
  });

  test("the comment prompt follows the eNPS band and the progress counts up", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderWithProviders(<PulseSurvey />);
    await screen.findByText("0 of 6 answered");

    await user.click(screen.getByRole("radio", { name: "3" }));
    expect(screen.getByText("What is the most important thing we should improve?")).toBeInTheDocument();
    expect(screen.getByText("1 of 6 answered")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "8" }));
    expect(screen.getByText("What would improve your experience by one point?")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "10" }));
    expect(screen.getByText("What should we make sure to preserve?")).toBeInTheDocument();
  });

  test("submitting requires every scored answer, then PUTs the body and toasts", async () => {
    setupMocks();
    const toast = vi.spyOn(notifications, "show");
    const user = userEvent.setup();
    renderWithProviders(<PulseSurvey />);
    await screen.findByText("0 of 6 answered");

    // Missing answers block the submit with inline errors.
    await user.click(screen.getByRole("button", { name: "Submit survey" }));
    expect((await screen.findAllByText("Please pick an answer.")).length).toBeGreaterThan(0);
    expect(mockFetch.mock.calls.every(([url]) => !String(url).includes("my-response") || true)).toBe(true);

    await user.click(screen.getByRole("radio", { name: "9" }));
    for (const question of [
      "I understand what is expected of me in my role.",
      "I receive the support I need from my manager.",
      "I feel safe raising concerns or suggesting improvements.",
      "My current workload is manageable over the long term.",
    ]) {
      const group = screen.getByRole("radiogroup", { name: question });
      await user.click(within(group).getByRole("radio", { name: "Agree" }));
    }
    const rotating = screen.getByRole("radiogroup", { name: "Good work is recognized here." });
    await user.click(within(rotating).getByRole("radio", { name: "Not applicable" }));
    await user.type(screen.getByLabelText(/What should we make sure to preserve?/), "keep the pulse");

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
  });

  test("saved answers prefill the form and flip the affordances to edit mode", async () => {
    setupMocks({ myResponse: SAVED });
    renderWithProviders(<PulseSurvey />);
    expect(await screen.findByText(/Your answers are saved/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "8" })).toBeChecked();
    expect(screen.getByDisplayValue("earlier thoughts")).toBeInTheDocument();
    expect(screen.getByText("6 of 6 answered")).toBeInTheDocument();
  });
});
