import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EditImpactEntry from "./EditImpactEntry";
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

const ENTRY = {
  id: 5,
  userId: 7,
  userName: "Me Myself",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  whatHappened: "Shipped the pipeline",
  contribution: "Built it",
  whyItMattered: "Cut the turnaround",
  evidence: "Kudos thread",
  createdAt: Date.now(),
  lastModified: Date.now(),
};

function renderScreen(route = "/impact-log/5/edit", entryStatus = 200, entry: unknown = ENTRY) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mockFetch = vi.fn((url: string, init?: RequestInit) => {
    const u = String(url);
    if ((init?.method ?? "GET") === "PUT" && u === "/api/v1/impact-log/5") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (u === "/api/v1/impact-log/5") {
      return Promise.resolve(jsonResponse(entryStatus, entryStatus === 200 ? entry : { title: "x" }));
    }
    return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
  });
  vi.stubGlobal("fetch", mockFetch);
  render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/impact-log/:id/edit" element={<EditImpactEntry />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return mockFetch;
}

describe("EditImpactEntry page", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("seeds the form from the document and PUTs the whole replacement", async () => {
    const user = userEvent.setup();
    const mockFetch = renderScreen("/impact-log/5/edit?back=%2Fimpact-log");

    // The document arrives and seeds every field; the owner renders as plain "You".
    expect(await screen.findByLabelText("What happened")).toHaveValue("Shipped the pipeline");
    expect(screen.getByLabelText(/period start/i)).toHaveValue("2026-07-01");
    expect(screen.getByText("You")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("My contribution"));
    await user.type(screen.getByLabelText("My contribution"), "Built and documented it");
    fireEvent.change(screen.getByLabelText(/period end/i), { target: { value: "2026-08-15" } });
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/impact-log"));
    const put = mockFetch.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({
      periodStart: "2026-07-01",
      periodEnd: "2026-08-15",
      whatHappened: "Shipped the pipeline",
      contribution: "Built and documented it",
      whyItMattered: "Cut the turnaround",
      evidence: "Kudos thread",
    });
  });

  test("a 403 load shows the permission wording and no submittable form", async () => {
    renderScreen("/impact-log/5/edit", 403);
    expect(await screen.findByText("You don't have access to this entry.")).toBeInTheDocument();
    expect(screen.queryByLabelText("What happened")).toBeNull();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  test("a 404 load says the entry no longer exists", async () => {
    renderScreen("/impact-log/5/edit", 404);
    expect(await screen.findByText("This entry no longer exists.")).toBeInTheDocument();
  });

  test("an invalid id redirects to the back target without fetching", () => {
    const mockFetch = renderScreen("/impact-log/abc/edit");
    expect(screen.getByTestId("probe")).toHaveTextContent("/impact-log");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
