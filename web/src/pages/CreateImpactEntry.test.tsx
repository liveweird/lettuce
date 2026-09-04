import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreateImpactEntry from "./CreateImpactEntry";
import { jsonResponse } from "../test/http";

vi.mock("../components/MarkdownEditor", async () =>
  (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule(),
);

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{`${location.pathname}${location.search}`}</div>;
}

const CREATED = {
  id: 5,
  userId: 7,
  userName: "Me Myself",
  title: "Pipeline shipped",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  whatHappened: "Shipped it",
  contribution: "Built it",
  whyItMattered: "It mattered",
  evidence: "Kudos",
  createdAt: Date.now(),
  lastModified: Date.now(),
};

// The four wizard sections in step order: (step label on the rail, full editor label, text).
const SECTIONS: { editorLabel: string; text: string }[] = [
  { editorLabel: "What happened", text: "Shipped it" },
  { editorLabel: "My contribution", text: "Built it" },
  { editorLabel: "Why did it matter", text: "It mattered" },
  { editorLabel: "What evidence / feedback supports that", text: "Kudos" },
];

function renderScreen(route = "/impact-log/new") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/impact-log/new" element={<CreateImpactEntry />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("CreateImpactEntry page", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn((url: string, init?: RequestInit) => {
      const u = String(url);
      if ((init?.method ?? "GET") === "POST" && u === "/api/v1/impact-log") {
        return Promise.resolve(jsonResponse(201, CREATED));
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  // Fill the wizard step by step: type into the active section's editor, then Next. The first
  // editor loads lazily — findByLabelText waits for the chunk.
  async function walkSections(user: ReturnType<typeof userEvent.setup>) {
    // The title is a header field (visible on every step) and gates Next like the period.
    const title = screen.getByLabelText(/^Title/);
    await user.clear(title);
    await user.type(title, "Pipeline shipped");
    for (const { editorLabel, text } of SECTIONS) {
      await user.type(await screen.findByLabelText(editorLabel), text);
      await user.click(screen.getByRole("button", { name: "Next" }));
    }
  }

  test("walks all four steps, reviews the entry, creates, and returns to back", async () => {
    const user = userEvent.setup();
    renderScreen("/impact-log/new?back=%2Fimpact-log");

    // The owner is fixed ("You"); the step rail names every step in order (the step button's
    // accessible name is "<number> <label>" — the icon renders the step number).
    expect(await screen.findByText("You")).toBeInTheDocument();
    const rail = ["What happened", "My contribution", "Why it mattered", "Evidence", "Review"];
    rail.forEach((label, i) => {
      expect(screen.getByRole("button", { name: `${i + 1} ${label}` })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: "2026-07-31" } });
    await walkSections(user);

    // The Review step renders every section read-only before the Create.
    expect(screen.getByText("Shipped it")).toBeInTheDocument();
    expect(screen.getByText("Built it")).toBeInTheDocument();
    expect(screen.getByText("It mattered")).toBeInTheDocument();
    expect(screen.getByText("Kudos")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/impact-log"));
    const post = mockFetch.mock.calls.find(
      ([u, init]) => String(u) === "/api/v1/impact-log" && (init as RequestInit)?.method === "POST",
    );
    expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
      title: "Pipeline shipped",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      whatHappened: "Shipped it",
      contribution: "Built it",
      whyItMattered: "It mattered",
      evidence: "Kudos",
    });
  });

  test("a blank title blocks Next at the always-visible header input", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(await screen.findByLabelText("What happened"), "Something happened");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("A title is required")).toBeInTheDocument();
    expect(screen.queryByLabelText("My contribution")).toBeNull();
  });

  test("a blank section blocks Next with one inline error; filling it unblocks", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(await screen.findByLabelText(/^Title/), "Pipeline shipped");
    await screen.findByLabelText("What happened");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("This section is required")).toBeInTheDocument();
    // Still on step 1 — the next section's editor never mounted.
    expect(screen.queryByLabelText("My contribution")).toBeNull();

    await user.type(screen.getByLabelText("What happened"), "Now it happened");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByLabelText("My contribution")).toBeInTheDocument();
    expect(
      mockFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toBe(false);
  });

  test("Back and clicking a visited step keep the text; future steps are unclickable", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(await screen.findByLabelText(/^Title/), "Pipeline shipped");
    await user.type(await screen.findByLabelText("What happened"), "Shipped it");
    // A future step on the rail does nothing (no skipping ahead).
    await user.click(screen.getByRole("button", { name: /Evidence/ }));
    expect(screen.getByLabelText("What happened")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(await screen.findByLabelText("My contribution"), "Built it");

    // The footer Back returns without losing what was written…
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByLabelText("What happened")).toHaveValue("Shipped it");

    // …and so does clicking ahead-but-visited on the rail after moving forward again.
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByLabelText("My contribution")).toHaveValue("Built it");
    await user.click(screen.getByRole("button", { name: /What happened/ }));
    expect(await screen.findByLabelText("What happened")).toHaveValue("Shipped it");
  });

  test("moving the period start past the end drags the end along (the range nudge)", async () => {
    renderScreen();
    const end = await screen.findByLabelText(/period end/i);
    fireEvent.change(end, { target: { value: "2026-07-10" } });
    // DateInput keeps its typed text while its calendar is open — leaving the field (as a
    // user moving to the start field does) lets the nudge repaint it.
    fireEvent.blur(end);
    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: "2026-08-01" } });
    expect(screen.getByLabelText(/period end/i)).toHaveValue("2026-08-01");
  });

  test("a cleared period blocks Next at the always-visible inputs", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(await screen.findByLabelText("What happened"), "Shipped it");
    fireEvent.change(screen.getByLabelText(/period start/i), { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Pick a date")).toBeInTheDocument();
    expect(screen.queryByLabelText("My contribution")).toBeNull();
  });

  test("Cancel opens the discard confirm; discarding returns to back", async () => {
    const user = userEvent.setup();
    renderScreen("/impact-log/new?back=%2Fimpact-log");

    await screen.findByLabelText("What happened");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Discard entry?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /^discard$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/impact-log"));
    expect(
      mockFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST"),
    ).toBe(false);
  });

  test("a save failure shows the inline error and stays on the Review step", async () => {
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        return Promise.resolve(jsonResponse(500, { title: "boom" }));
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    });
    const user = userEvent.setup();
    renderScreen();

    await screen.findByLabelText("What happened");
    await walkSections(user);
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(
      await screen.findByText("Failed to save the entry (HTTP 500)."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).toBeNull();
  });
});
