import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import NotificationPreferences from "./NotificationPreferences";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const ROLES_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderPage(id: number | string = 7) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/users/${id}/notification-preferences`]}>
          <Routes>
            <Route
              path="/users/:id/notification-preferences"
              element={<NotificationPreferences />}
            />
            <Route path="/users" element={<PathProbe />} />
            <Route path="/" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const EXISTING_USER = {
  id: 7,
  name: "Alice",
  email: "alice@example.com",
  roles: [] as string[],
  disabledFeatures: [] as string[],
  emailNotificationsEnabled: true,
};

const ITEMS = [
  {
    type: "FEEDBACK_REQUESTED_TO_PROVIDER",
    feature: "FEEDBACKS",
    inApp: true,
    email: true,
    teams: true,
    locked: false,
  },
  {
    type: "FEEDBACK_SENT_TO_SUBJECT",
    feature: "FEEDBACKS",
    inApp: true,
    email: true,
    teams: true,
    locked: false,
  },
  { type: "GOAL_ACTIVATED_TO_SUBORDINATE", feature: "GOALS", inApp: true, email: true, teams: true, locked: false },
  { type: "PULSE_CYCLE_OPENED", feature: "PULSE_SURVEYS", inApp: true, email: true, teams: true, locked: false },
  { type: "PASSWORD_CHANGED", feature: null, inApp: true, email: true, teams: true, locked: true },
];

const PREFS = { emailEnabled: true, teamsAvailable: false, items: ITEMS };

describe("NotificationPreferences page", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLES_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function mockApi({
    user = EXISTING_USER,
    prefs = PREFS,
    userStatus = 200,
    putEmailStatus = 204,
    putPrefsStatus = 204,
  }: {
    user?: typeof EXISTING_USER;
    prefs?: typeof PREFS;
    userStatus?: number;
    putEmailStatus?: number;
    putPrefsStatus?: number;
  } = {}) {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "PUT" && url.endsWith("/email-notifications")) {
        return Promise.resolve(
          putEmailStatus === 204
            ? new Response(null, { status: 204 })
            : jsonResponse(putEmailStatus, { title: "err", status: putEmailStatus }),
        );
      }
      if (method === "PUT" && url.endsWith("/notification-preferences")) {
        return Promise.resolve(
          putPrefsStatus === 204
            ? new Response(null, { status: 204 })
            : jsonResponse(putPrefsStatus, { title: "err", status: putPrefsStatus }),
        );
      }
      if (url.endsWith("/notification-preferences")) {
        return Promise.resolve(jsonResponse(200, prefs));
      }
      return Promise.resolve(
        userStatus === 200
          ? jsonResponse(200, user)
          : jsonResponse(userStatus, { title: "not found", status: userStatus }),
      );
    });
  }

  test("groups rows by feature in FEATURES order, with locked types under Other, always on", async () => {
    mockApi();
    renderPage(7);

    const feedbacksHeading = await screen.findByText("Feedbacks");
    const goalsHeading = screen.getByText("Goals");
    const otherHeading = screen.getByText("Other");
    // Document order: Feedbacks precedes Goals precedes Other (FEATURES order, Other last).
    expect(
      feedbacksHeading.compareDocumentPosition(goalsHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      goalsHeading.compareDocumentPosition(otherHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.getByText("My password was changed")).toBeInTheDocument();
    expect(screen.getByText("(Always on)")).toBeInTheDocument();
    const lockedSwitches = screen.getAllByRole("switch", {
      name: /My password was changed/,
    }) as HTMLInputElement[];
    expect(lockedSwitches).toHaveLength(2);
    for (const s of lockedSwitches) {
      expect(s.checked).toBe(true);
      expect(s.disabled).toBe(true);
    }
  });

  test("hides the section for a feature the target has disabled", async () => {
    mockApi({ user: { ...EXISTING_USER, disabledFeatures: ["PULSE_SURVEYS"] } });
    renderPage(7);

    await screen.findByText("Feedbacks");
    expect(screen.queryByText("Pulse Surveys")).toBeNull();
    expect(screen.queryByText("A pulse survey opened")).toBeNull();
  });

  test("greys out (disables) the whole email column while the master switch is off", async () => {
    mockApi();
    const user = userEvent.setup();
    renderPage(7);

    await screen.findByText("Feedbacks");
    const master = screen.getByRole("switch", { name: "Send me emails" });
    expect((master as HTMLInputElement).checked).toBe(true);
    await user.click(master);

    const emailSwitch = screen.getByRole("switch", {
      name: "Someone requests feedback from me — Email",
    }) as HTMLInputElement;
    expect(emailSwitch.disabled).toBe(true);
    const inAppSwitch = screen.getByRole("switch", {
      name: "Someone requests feedback from me — In app",
    }) as HTMLInputElement;
    expect(inAppSwitch.disabled).toBe(false);
  });

  test("a section's bulk 'All off' control turns off every in-app switch in that section only", async () => {
    mockApi();
    const user = userEvent.setup();
    renderPage(7);

    await screen.findByText("Feedbacks");
    await user.click(
      screen.getByRole("button", {
        name: "Turn off In app for every Feedbacks notification",
      }),
    );

    expect(
      (screen.getByRole("switch", {
        name: "Someone requests feedback from me — In app",
      }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByRole("switch", {
        name: "Feedback about me was sent — In app",
      }) as HTMLInputElement).checked,
    ).toBe(false);
    // Unaffected: a different feature's row.
    expect(
      (screen.getByRole("switch", {
        name: "One of my goals was activated — In app",
      }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  test("Save calls only the matrix endpoint when just a per-row switch changed", async () => {
    mockApi();
    const user = userEvent.setup();
    renderPage(7);

    await screen.findByText("Feedbacks");
    await user.click(
      screen.getByRole("switch", { name: "Someone requests feedback from me — In app" }),
    );
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/"));
    const putCalls = mockFetch.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PUT");
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0][0]).toBe("/api/v1/users/7/notification-preferences");
    const body = JSON.parse((putCalls[0][1] as { body: string }).body);
    expect(body.disabled).toEqual([
      { type: "FEEDBACK_REQUESTED_TO_PROVIDER", channel: "IN_APP" },
    ]);
  });

  test("Save calls only the master email endpoint when just the master switch changed", async () => {
    mockApi();
    const showSpy = vi.spyOn(notifications, "show");
    const user = userEvent.setup();
    renderPage(7);

    await screen.findByText("Feedbacks");
    await user.click(screen.getByRole("switch", { name: "Send me emails" }));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/"));
    const putCalls = mockFetch.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PUT");
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0][0]).toBe("/api/v1/users/7/email-notifications");
    expect(JSON.parse((putCalls[0][1] as { body: string }).body)).toEqual({ enabled: false });
    expect(showSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Notification preferences saved" }),
    );
  });

  test("the Microsoft Teams column is absent while Teams is unavailable for the target", async () => {
    mockApi();
    renderPage(7);

    await screen.findByText("Feedbacks");
    expect(screen.queryByRole("switch", { name: "Someone requests feedback from me — Microsoft Teams" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Turn off Microsoft Teams for every Feedbacks notification" }),
    ).toBeNull();
  });

  test("with Teams available, a Teams switch turned off is saved as a TEAMS pair", async () => {
    mockApi({ prefs: { ...PREFS, teamsAvailable: true } });
    const user = userEvent.setup();
    renderPage(7);

    await screen.findByText("Feedbacks");
    const lockedTeams = screen.getByRole("switch", {
      name: "My password was changed — Microsoft Teams",
    }) as HTMLInputElement;
    expect(lockedTeams.checked).toBe(true);
    expect(lockedTeams.disabled).toBe(true);
    await user.click(
      screen.getByRole("switch", { name: "Someone requests feedback from me — Microsoft Teams" }),
    );
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/"));
    const putCalls = mockFetch.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PUT");
    expect(putCalls).toHaveLength(1);
    expect(JSON.parse((putCalls[0][1] as { body: string }).body).disabled).toEqual([
      { type: "FEEDBACK_REQUESTED_TO_PROVIDER", channel: "TEAMS" },
    ]);
  });

  test("a stored TEAMS preference survives a save made while the Teams column is hidden", async () => {
    const items = ITEMS.map((item) =>
      item.type === "GOAL_ACTIVATED_TO_SUBORDINATE" ? { ...item, teams: false } : item,
    );
    mockApi({ prefs: { ...PREFS, items } });
    const user = userEvent.setup();
    renderPage(7);

    await screen.findByText("Feedbacks");
    await user.click(
      screen.getByRole("switch", { name: "Someone requests feedback from me — In app" }),
    );
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/"));
    const putCalls = mockFetch.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PUT");
    const disabled = JSON.parse((putCalls[0][1] as { body: string }).body).disabled;
    expect(disabled).toEqual(
      expect.arrayContaining([
        { type: "FEEDBACK_REQUESTED_TO_PROVIDER", channel: "IN_APP" },
        { type: "GOAL_ACTIVATED_TO_SUBORDINATE", channel: "TEAMS" },
      ]),
    );
    expect(disabled).toHaveLength(2);
  });

  test("Save issues no PUT at all when nothing changed", async () => {
    mockApi();
    const user = userEvent.setup();
    renderPage(7);

    await screen.findByText("Feedbacks");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/"));
    const putCalls = mockFetch.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PUT");
    expect(putCalls).toHaveLength(0);
  });

  test("a partial failure (master saved, matrix failed) names which part failed and stays put", async () => {
    mockApi({ putPrefsStatus: 500 });
    const user = userEvent.setup();
    renderPage(7);

    await screen.findByText("Feedbacks");
    await user.click(screen.getByRole("switch", { name: "Send me emails" }));
    await user.click(
      screen.getByRole("switch", { name: "Someone requests feedback from me — In app" }),
    );
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(
      await screen.findByText(
        "The email switch was saved, but the per-type changes failed to save — please try again",
      ),
    ).toBeInTheDocument();
    // Both endpoints were actually called, in order — the master change is not lost.
    const putCalls = mockFetch.mock.calls.filter(([, init]) => (init as RequestInit)?.method === "PUT");
    expect(putCalls.map(([url]) => url)).toEqual([
      "/api/v1/users/7/email-notifications",
      "/api/v1/users/7/notification-preferences",
    ]);
    // No navigation away — the failure leaves the user able to retry from here.
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  test("a 404 user shows the not-found state", async () => {
    mockApi({ userStatus: 404 });
    renderPage(7);
    expect(await screen.findByText("User not found")).toBeInTheDocument();
  });

  test("a non-admin opening another user's page is redirected home", () => {
    localStorage.setItem(USER_ID_KEY, "1");
    mockApi();
    renderPage(7);
    expect(screen.getByTestId("probe")).toHaveTextContent("/");
  });
});
