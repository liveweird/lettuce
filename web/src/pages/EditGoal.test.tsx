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

  test("a non-manager is redirected to the read-only view, keeping the context", async () => {
    localStorage.setItem(USER_ID_KEY, "8");
    setupMocks();
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent("/goals/5/view?from=own");
    });
  });

  test("a CLOSED goal is redirected to the read-only view (nothing editable)", async () => {
    setupMocks({ ...DRAFT_GOAL, status: "CLOSED", summary: "done" });
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

  test("ACTIVE (numeric): the progress form PUTs the new current value to /progress", async () => {
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

  test("ACTIVE: Return to draft saves progress, deactivates, and re-renders as the definition editor in place", async () => {
    let deactivated = false;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "PUT") return Promise.resolve(new Response(null, { status: 204 }));
      if (method === "POST" && u === "/api/v1/goals/5/deactivate") {
        deactivated = true;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (u.includes("/events")) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (u.includes("/api/v1/goals/5")) {
        return Promise.resolve(
          jsonResponse(200, deactivated ? DRAFT_GOAL : { ...DRAFT_GOAL, status: "ACTIVE", currentValue: 45 }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
    const user = userEvent.setup();
    renderScreen();

    await screen.findByLabelText(/current/i);
    await user.click(screen.getByRole("button", { name: /return to draft/i }));

    // In place: the same route now shows the DRAFT definition form — no navigation happened.
    expect(await screen.findByLabelText(/title/i)).toHaveValue("Raise coverage");
    expect(screen.queryByTestId("probe")).toBeNull();
    expect(
      mockFetch.mock.calls.some(
        ([u, init]) =>
          String(u) === "/api/v1/goals/5/progress" && (init as RequestInit)?.method === "PUT",
      ),
    ).toBe(true);
  });

  test("ACTIVE: Save & close collects the mandatory summary, then PUTs progress and POSTs close", async () => {
    setupMocks({ ...DRAFT_GOAL, status: "ACTIVE", currentValue: 45 });
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "PUT" || method === "POST") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (u.includes("/events")) return Promise.resolve(jsonResponse(200, { items: [] }));
      return Promise.resolve(jsonResponse(200, { ...DRAFT_GOAL, status: "ACTIVE", currentValue: 45 }));
    });
    const user = userEvent.setup();
    renderScreen();

    const current = await screen.findByLabelText(/current/i);
    await user.clear(current);
    await user.type(current, "80");
    await user.click(screen.getByRole("button", { name: /^save & close$/i }));
    const dialog = await screen.findByRole("dialog");

    // A blank summary is blocked inside the dialog — nothing has been sent yet.
    await user.click(within(dialog).getByRole("button", { name: /close goal/i }));
    expect(await within(dialog).findByText("A summary is required to close a goal")).toBeInTheDocument();
    expect(mockFetch.mock.calls.some(([u]) => String(u).includes("/close"))).toBe(false);

    await user.type(within(dialog).getByLabelText(/summary/i), "Wrapped up ahead of time");
    await user.click(within(dialog).getByRole("button", { name: /close goal/i }));

    await waitFor(() => {
      const put = mockFetch.mock.calls.find(
        ([u, init]) =>
          String(u) === "/api/v1/goals/5/progress" && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeDefined();
      expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({ currentValue: 80 });
      const close = mockFetch.mock.calls.find(([u]) => String(u) === "/api/v1/goals/5/close");
      expect(close).toBeDefined();
      expect(JSON.parse((close![1] as RequestInit).body as string)).toEqual({
        summary: "Wrapped up ahead of time",
      });
    });
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/users/7/goals"));
  });

  test("ACTIVE: a 409 on the close step shows the conflict message and stays", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (method === "PUT") return Promise.resolve(new Response(null, { status: 204 }));
      if (method === "POST") return Promise.resolve(jsonResponse(409, { title: "conflict" }));
      if (u.includes("/events")) return Promise.resolve(jsonResponse(200, { items: [] }));
      return Promise.resolve(jsonResponse(200, { ...DRAFT_GOAL, status: "ACTIVE", currentValue: 45 }));
    });
    const user = userEvent.setup();
    renderScreen();

    await screen.findByLabelText(/current/i);
    await user.click(screen.getByRole("button", { name: /^save & close$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/summary/i), "s");
    await user.click(within(dialog).getByRole("button", { name: /close goal/i }));

    expect(
      await screen.findByText("The goal's status changed in the meantime — reload and try again."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).toBeNull();
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
