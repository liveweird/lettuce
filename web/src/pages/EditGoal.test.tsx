import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EditGoal from "./EditGoal";
import { jsonResponse } from "../test/http";

vi.mock("../components/MarkdownEditor", async () =>
  (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule(),
);

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

const DRAFT_GOAL = {
  id: 5,
  managerId: 7,
  managerName: "Mona Manager",
  subordinateId: 8,
  subordinateName: "Sub Ordinate",
  createdAt: new Date(2026, 5, 1).getTime(),
  dueDate: "2099-06-15",
  title: "Raise coverage",
  description: "Initial description",
  type: "PERCENTAGE",
  targetValue: 90,
  currentValue: 0,
  achieved: null,
  status: "DRAFT",
  summary: null,
  lastModified: new Date(2026, 6, 1).getTime(),
};

function renderScreen(path = "/goals/5/edit?from=own&back=%2Fusers%2F7%2Fgoals") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/goals/:id/edit" element={<EditGoal />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("EditGoal page", () => {
  let mockFetch: FetchMock;

  function setupMocks(goal: unknown = DRAFT_GOAL) {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "PUT" || method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (u.includes("/events")) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (u.includes("/api/v1/goals/5")) return Promise.resolve(jsonResponse(200, goal));
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
  }

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "7"); // the manager by default
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("a non-manager is redirected off a DRAFT to the read-only view, keeping the context", async () => {
    localStorage.setItem(USER_ID_KEY, "8");
    setupMocks();
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent("/goals/5/view?from=own");
    });
  });

  test("a non-party is redirected off an ACTIVE goal; the subordinate is not (v2.8.0)", async () => {
    localStorage.setItem(USER_ID_KEY, "99"); // neither party
    setupMocks({ ...DRAFT_GOAL, status: "ACTIVE", currentValue: 45 });
    renderScreen();
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent("/goals/5/view?from=own");
    });

    cleanup();
    localStorage.setItem(USER_ID_KEY, "8"); // the subordinate reaches the Update screen
    setupMocks({ ...DRAFT_GOAL, status: "ACTIVE", currentValue: 45 });
    renderScreen();
    expect(await screen.findByLabelText(/current/i)).toBeInTheDocument();
    expect(screen.getByText("Update progress")).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).toBeNull();
  });

  test("a CLOSED goal is redirected to the read-only view (nothing editable)", async () => {
    setupMocks({ ...DRAFT_GOAL, status: "ARCHIVED", summary: "done" });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent("/goals/5/view?from=own");
    });
  });

  test("DRAFT: seeds the definition form and saves it as a PUT, then navigates back", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderScreen();

    const title = await screen.findByLabelText(/title/i);
    expect(title).toHaveValue("Raise coverage");
    // The (mocked) MarkdownEditor is lazy-loaded — wait for the Suspense boundary to resolve.
    expect(await screen.findByLabelText("Description", { selector: "textarea" })).toHaveValue(
      "Initial description",
    );
    // The due date is prefilled from the document and editable in DRAFT.
    expect(screen.getByLabelText(/due date/i)).toHaveValue("2099-06-15");

    await user.clear(title);
    await user.type(title, "Raise coverage further");
    const target = screen.getByLabelText(/target/i);
    await user.clear(target);
    await user.type(target, "95");
    fireEvent.change(screen.getByLabelText(/due date/i), { target: { value: "2099-09-01" } });
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    await waitFor(() => {
      const put = mockFetch.mock.calls.find(
        ([u, init]) => String(u) === "/api/v1/goals/5" && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeDefined();
      expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({
        title: "Raise coverage further",
        description: "Initial description",
        type: "PERCENTAGE",
        targetValue: 95,
        dueDate: "2099-09-01",
      });
    });
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users/7/goals"));
  });

  test("DRAFT: a blank title blocks the save with a validation message", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderScreen();

    await user.clear(await screen.findByLabelText(/title/i));
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    expect(await screen.findByText("A title is required")).toBeInTheDocument();
    expect(
      mockFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT"),
    ).toBe(false);
  });

  test("DRAFT: switching the type warns about the reset and drops the target for BINARY", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderScreen();

    await screen.findByLabelText(/title/i);
    // happy-dom does not open Mantine comboboxes via userEvent's pointer simulation.
    fireEvent.click(screen.getByLabelText("Type", { selector: "input" }));
    fireEvent.click(await screen.findByRole("option", { name: "Done / not done" }));

    expect(
      screen.getByText("Changing the goal type resets its target and recorded progress."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/target/i)).toBeNull(); // BINARY has no target input

    await user.click(screen.getByRole("button", { name: /^save draft$/i }));
    await waitFor(() => {
      const put = mockFetch.mock.calls.find(
        ([u, init]) => String(u) === "/api/v1/goals/5" && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeDefined();
      expect(JSON.parse((put![1] as RequestInit).body as string)).toMatchObject({
        type: "BINARY",
        targetValue: null,
      });
    });
  });

  test("DRAFT: Delete confirms and issues the DELETE, then navigates back", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderScreen();

    await screen.findByLabelText(/title/i);
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(
        mockFetch.mock.calls.some(
          ([u, init]) =>
            String(u) === "/api/v1/goals/5" && (init as RequestInit)?.method === "DELETE",
        ),
      ).toBe(true);
    });
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users/7/goals"));
  });

  test("DRAFT: Cancel opens the discard confirm; discarding navigates without saving", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderScreen();

    await screen.findByLabelText(/title/i);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("link", { name: /^discard$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users/7/goals"));
    expect(
      mockFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT"),
    ).toBe(false);
  });

  test("DRAFT: Save & activate PUTs the definition, POSTs activate, and navigates back", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderScreen();

    await screen.findByLabelText(/title/i);
    await user.click(screen.getByRole("button", { name: /^save & activate$/i }));

    await waitFor(() => {
      const put = mockFetch.mock.calls.find(
        ([u, init]) => String(u) === "/api/v1/goals/5" && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeDefined();
      expect(
        mockFetch.mock.calls.some(
          ([u, init]) =>
            String(u) === "/api/v1/goals/5/activate" && (init as RequestInit)?.method === "POST",
        ),
      ).toBe(true);
    });
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users/7/goals"));
  });

  test("DRAFT: validation blocks Save & activate too", async () => {
    setupMocks();
    const user = userEvent.setup();
    renderScreen();

    await user.clear(await screen.findByLabelText(/title/i));
    await user.click(screen.getByRole("button", { name: /^save & activate$/i }));

    expect(await screen.findByText("A title is required")).toBeInTheDocument();
    expect(
      mockFetch.mock.calls.some(([, init]) => {
        const method = (init as RequestInit | undefined)?.method;
        return method === "PUT" || method === "POST";
      }),
    ).toBe(false);
  });

  test("DRAFT: a 409 on the activate step shows the conflict message and stays", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "PUT") return Promise.resolve(new Response(null, { status: 204 }));
      if (method === "POST") return Promise.resolve(jsonResponse(409, { title: "conflict" }));
      if (u.includes("/events")) return Promise.resolve(jsonResponse(200, { items: [] }));
      return Promise.resolve(jsonResponse(200, DRAFT_GOAL));
    });
    const user = userEvent.setup();
    renderScreen();

    await screen.findByLabelText(/title/i);
    await user.click(screen.getByRole("button", { name: /^save & activate$/i }));

    expect(
      await screen.findByText("The goal's status changed in the meantime — reload and try again."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).toBeNull();
  });

  test("ACTIVE: a past due date renders read-only with the overdue badge", async () => {
    setupMocks({ ...DRAFT_GOAL, status: "ACTIVE", currentValue: 45, dueDate: "2020-01-01" });
    renderScreen();

    await screen.findByLabelText(/current/i);
    // Read-only display (no date input on the progress branch) + the overdue signal.
    expect(screen.queryByLabelText("Due date", { selector: "input" })).toBeNull();
    expect(screen.getByText("Jan 1, 2020")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  test("ACTIVE (numeric): the Update screen PUTs the new current value to /progress", async () => {
    setupMocks({ ...DRAFT_GOAL, status: "ACTIVE", currentValue: 45 });
    const user = userEvent.setup();
    renderScreen();

    // The heading renders before the data — wait for the form control itself.
    const current = await screen.findByLabelText(/current/i);
    expect(screen.getByText("Update progress")).toBeInTheDocument();
    // The definition is frozen: no title input, just the read-only display.
    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
    expect(screen.getByText("Initial description")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();
    // A future due date shows plainly, without the overdue badge.
    expect(screen.getByText("Jun 15, 2099")).toBeInTheDocument();
    expect(screen.queryByText("Overdue")).toBeNull();
    // Lifecycle no longer lives on this screen (list rows / view screen own it) — Close+Save only.
    expect(screen.queryByRole("button", { name: /return to draft/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /save & archive/i })).toBeNull();
    await user.clear(current);
    await user.type(current, "60");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const put = mockFetch.mock.calls.find(
        ([u, init]) =>
          String(u) === "/api/v1/goals/5/progress" && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeDefined();
      expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({ currentValue: 60 });
    });
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users/7/goals"));
  });

  test("ACTIVE: the subordinate saves a value change with a comment; the comment rides the PUT", async () => {
    localStorage.setItem(USER_ID_KEY, "8");
    setupMocks({ ...DRAFT_GOAL, status: "ACTIVE", currentValue: 45 });
    const user = userEvent.setup();
    renderScreen();

    const current = await screen.findByLabelText(/current/i);
    await user.clear(current);
    await user.type(current, "70");
    await user.type(
      screen.getByLabelText(/comment \(optional\)/i),
      "Landed the first milestone",
    );
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const put = mockFetch.mock.calls.find(
        ([u, init]) =>
          String(u) === "/api/v1/goals/5/progress" && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeDefined();
      expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({
        currentValue: 70,
        comment: "Landed the first milestone",
      });
    });
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users/7/goals"));
  });

  test("ACTIVE: a comment-only save is allowed and sends the unchanged value with the comment", async () => {
    setupMocks({ ...DRAFT_GOAL, status: "ACTIVE", currentValue: 45 });
    const user = userEvent.setup();
    renderScreen();

    await screen.findByLabelText(/current/i);
    await user.type(screen.getByLabelText(/comment \(optional\)/i), "Blocked on the vendor");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const put = mockFetch.mock.calls.find(
        ([u, init]) =>
          String(u) === "/api/v1/goals/5/progress" && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeDefined();
      expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({
        currentValue: 45,
        comment: "Blocked on the vendor",
      });
    });
  });

  test("ACTIVE: Save with nothing changed shows the nothing-to-save notice and sends nothing", async () => {
    setupMocks({ ...DRAFT_GOAL, status: "ACTIVE", currentValue: 45 });
    const user = userEvent.setup();
    renderScreen();

    await screen.findByLabelText(/current/i);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(
      await screen.findByText("Nothing to save — change the value or add a comment first."),
    ).toBeInTheDocument();
    expect(
      mockFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT"),
    ).toBe(false);
    expect(screen.queryByTestId("probe")).toBeNull();

    // The notice clears as soon as the form goes dirty.
    await user.type(screen.getByLabelText(/comment \(optional\)/i), "x");
    await waitFor(() => {
      expect(
        screen.queryByText("Nothing to save — change the value or add a comment first."),
      ).toBeNull();
    });
  });

  test("ACTIVE: a clean Close navigates straight; a dirty Close asks to discard", async () => {
    setupMocks({ ...DRAFT_GOAL, status: "ACTIVE", currentValue: 45 });
    const user = userEvent.setup();
    renderScreen();

    // Clean: straight out, no dialog.
    await screen.findByLabelText(/current/i);
    await user.click(screen.getByRole("button", { name: /^close$/i }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users/7/goals"));
    expect(screen.queryByRole("dialog")).toBeNull();

    cleanup();
    setupMocks({ ...DRAFT_GOAL, status: "ACTIVE", currentValue: 45 });
    renderScreen();

    // Dirty: the discard confirm gates the exit.
    await user.type(await screen.findByLabelText(/comment \(optional\)/i), "unsaved note");
    await user.click(screen.getByRole("button", { name: /^close$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("link", { name: /^discard$/i }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users/7/goals"));
    expect(
      mockFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT"),
    ).toBe(false);
  });

  test("ACTIVE (binary): the achieved switch PUTs the flag to /progress", async () => {
    setupMocks({
      ...DRAFT_GOAL,
      type: "BINARY",
      targetValue: null,
      currentValue: null,
      achieved: false,
      status: "ACTIVE",
    });
    const user = userEvent.setup();
    renderScreen();

    const achieved = await screen.findByLabelText("Achieved");
    await user.click(achieved);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      const put = mockFetch.mock.calls.find(
        ([u, init]) =>
          String(u) === "/api/v1/goals/5/progress" && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeDefined();
      expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({ achieved: true });
    });
  });

  test("a save failure keeps the form and shows the mapped message", async () => {
    setupMocks();
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if ((init?.method ?? "GET") === "PUT") {
        return Promise.resolve(jsonResponse(409, { title: "conflict" }));
      }
      if (u.includes("/events")) return Promise.resolve(jsonResponse(200, { items: [] }));
      return Promise.resolve(jsonResponse(200, DRAFT_GOAL));
    });
    const user = userEvent.setup();
    renderScreen();

    await screen.findByLabelText(/title/i);
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    expect(
      await screen.findByText("The goal's status changed in the meantime — reload and try again."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).toBeNull();
  });

  test("load errors render the message with a Close exit", async () => {
    mockFetch.mockResolvedValue(jsonResponse(403, { title: "no" }));
    renderScreen();
    expect(await screen.findByText("You may not view this goal.")).toBeInTheDocument();

    cleanup();
  });
});
