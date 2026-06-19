import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ViewTemplate from "./ViewTemplate";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

const TEMPLATE = { id: 5, name: "Welcome", content: "# Hi\n\nBody text" };

function getReturns(mockFetch: ReturnType<typeof vi.fn>, response: Response) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url === "/api/templates/5") return Promise.resolve(response);
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function renderViewTemplate(entry = "/templates/5/view") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/templates/:id/view" element={<ViewTemplate />} />
            <Route path="/templates" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("ViewTemplate page", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    // A non-admin may reach this read-only page.
    localStorage.setItem(ROLE_KEY, "USER");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders the name read-only and the content rendered as Markdown", async () => {
    getReturns(mockFetch, jsonResponse(200, TEMPLATE));
    renderViewTemplate();

    // Name shown read-only.
    const name = (await screen.findByLabelText("Name")) as HTMLInputElement;
    expect(name.value).toBe("Welcome");
    expect(name).toBeDisabled();

    // `# Hi` renders as an <h1>Hi</h1> in the Markdown content.
    expect(screen.getByRole("heading", { name: "Hi" })).toBeInTheDocument();
  });

  test("is read-only — only a Close action that links back to the list", async () => {
    getReturns(mockFetch, jsonResponse(200, TEMPLATE));
    renderViewTemplate();

    await screen.findByLabelText("Name");
    expect(screen.getByRole("link", { name: /close/i })).toHaveAttribute("href", "/templates");
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });

  test("404 shows a 'Template not found' message with a Close link", async () => {
    getReturns(mockFetch, jsonResponse(404, { error: "not_found", message: "gone" }));
    renderViewTemplate();

    expect(await screen.findByText(/template not found/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /close/i })).toHaveAttribute("href", "/templates");
  });

  test("a non-404 load error shows a generic failed message", async () => {
    getReturns(mockFetch, jsonResponse(500, { error: "internal", message: "boom" }));
    renderViewTemplate();

    expect(await screen.findByText(/failed to load template \(500\)/i)).toBeInTheDocument();
  });

  test("an invalid id redirects to the templates list", () => {
    renderViewTemplate("/templates/abc/view");
    expect(screen.getByTestId("probe")).toHaveTextContent("/templates");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
