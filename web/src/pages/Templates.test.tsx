import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Templates from "./Templates";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function templatesPage(
  items: Array<{ id: number; name: string; contentPreview: string }>,
  total = items.length,
) {
  return jsonResponse(200, { items, page: 1, pageSize: 20, total });
}

const SEED = [
  { id: 1, name: "Welcome", contentPreview: "Hello there" },
  { id: 2, name: "Farewell", contentPreview: "Goodbye now" },
];

function setupMocks(mockFetch: FetchMock, listByUrl: (url: string) => Response) {
  mockFetch.mockImplementation((url: string) => {
    if (url.startsWith("/api/v1/templates?")) return Promise.resolve(listByUrl(url));
    return Promise.resolve(jsonResponse(404, {}));
  });
}

function renderTemplates() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/templates"]}>
          <Templates />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("Templates page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "ADMIN");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders rows showing template name and content preview", async () => {
    setupMocks(mockFetch, () => templatesPage(SEED));
    renderTemplates();

    expect(await screen.findByRole("cell", { name: "Welcome" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Farewell" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Hello there" })).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/templates\?/),
      expect.any(Object),
    );
    // The heading carries the data-tour anchor the guided tour targets for the Config → Templates step.
    expect(screen.getByRole("heading", { name: "Templates" })).toHaveAttribute(
      "data-tour",
      "config-templates",
    );
  });

  test("typing in the Name filter triggers a refetch with name=", async () => {
    setupMocks(mockFetch, () => templatesPage(SEED));
    const user = userEvent.setup();
    renderTemplates();

    await screen.findByText("Welcome");
    await user.click(screen.getByRole("button", { name: /filters/i }));
    await user.type(screen.getByLabelText(/name/i), "Wel");

    await waitFor(
      () => {
        const called = mockFetch.mock.calls.some(
          ([url]) =>
            typeof url === "string" &&
            url.startsWith("/api/v1/templates?") &&
            url.includes("name=Wel"),
        );
        expect(called).toBe(true);
      },
      { timeout: 1500 },
    );
  });

  test("filters are collapsed by default and the toggle reveals them", async () => {
    setupMocks(mockFetch, () => templatesPage(SEED));
    const user = userEvent.setup();
    renderTemplates();

    await screen.findByText("Welcome");
    const toggle = screen.getByRole("button", { name: /filters/i });
    // Collapsed by default — the toggle reports it and the space-eating filter row is hidden.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Name")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("the Filters toggle shows a badge counting the active filters", async () => {
    setupMocks(mockFetch, () => templatesPage(SEED));
    const user = userEvent.setup();
    renderTemplates();

    await screen.findByText("Welcome");
    const toggle = screen.getByRole("button", { name: /filters/i });
    expect(within(toggle).queryByText("1")).not.toBeInTheDocument();

    await user.click(toggle);
    await user.type(screen.getByLabelText("Name"), "Wel");
    expect(within(toggle).getByText("1")).toBeInTheDocument();
  });

  test("the Name filter clear button empties the field", async () => {
    setupMocks(mockFetch, () => templatesPage(SEED));
    const user = userEvent.setup();
    renderTemplates();

    await user.click(screen.getByRole("button", { name: /filters/i }));
    const filter = await screen.findByLabelText(/name/i);
    await user.type(filter, "Wel");
    expect(filter).toHaveValue("Wel");
    await user.click(screen.getByRole("button", { name: /clear name filter/i }));
    expect(filter).toHaveValue("");
  });

  test("toggling the Name sort header refetches with sort=-name", async () => {
    setupMocks(mockFetch, () => templatesPage(SEED));
    const user = userEvent.setup();
    renderTemplates();

    await screen.findByText("Welcome");
    await user.click(screen.getByRole("button", { name: /^name$/i }));

    await waitFor(() => {
      const called = mockFetch.mock.calls.some(
        ([url]) =>
          typeof url === "string" &&
          url.startsWith("/api/v1/templates?") &&
          url.includes("sort=-name"),
      );
      expect(called).toBe(true);
    });
  });

  test("pagination button click triggers a GET with page=2", async () => {
    setupMocks(mockFetch, () => templatesPage(SEED, 25));
    const user = userEvent.setup();
    renderTemplates();

    await screen.findByText("Welcome");
    await user.click(screen.getByRole("button", { name: "2" }));

    await waitFor(() => {
      const called = mockFetch.mock.calls.some(
        ([url]) =>
          typeof url === "string" &&
          url.startsWith("/api/v1/templates?") &&
          url.includes("page=2"),
      );
      expect(called).toBe(true);
    });
  });

  test("shows 'No templates' empty state when the API returns zero items", async () => {
    setupMocks(mockFetch, () => templatesPage([], 0));
    renderTemplates();

    expect(await screen.findByText(/no templates/i)).toBeInTheDocument();
  });

  test("load failure surfaces a 'Failed to load templates' alert", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.startsWith("/api/v1/templates?")) {
        return Promise.resolve(jsonResponse(500, { error: "internal", message: "boom" }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    renderTemplates();

    expect(await screen.findByText(/failed to load templates/i)).toBeInTheDocument();
  });

  test("admin sees a 'Create template' link pointing at /templates/new", async () => {
    setupMocks(mockFetch, () => templatesPage(SEED));
    renderTemplates();

    await screen.findByRole("cell", { name: "Welcome" });
    const link = screen.getByRole("link", { name: /create template/i });
    expect(link).toHaveAttribute("href", "/templates/new");
  });

  test("admin sees Edit links and Delete buttons per row; Edit points at the edit route", async () => {
    setupMocks(mockFetch, () => templatesPage(SEED));
    renderTemplates();

    await screen.findByRole("cell", { name: "Welcome" });
    const editLinks = screen.getAllByRole("link", { name: /^edit /i });
    expect(editLinks).toHaveLength(2);
    expect(editLinks[0]).toHaveAttribute("href", "/templates/1/edit");
    expect(screen.getAllByRole("button", { name: /^delete /i })).toHaveLength(2);
  });

  test("non-admin sees neither Create, Edit, nor Delete controls", async () => {
    localStorage.setItem(ROLE_KEY, "USER");
    setupMocks(mockFetch, () => templatesPage(SEED));
    renderTemplates();

    await screen.findByRole("cell", { name: "Welcome" });
    expect(screen.queryByRole("link", { name: /create template/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^edit /i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete /i })).not.toBeInTheDocument();
  });

  test("non-admin sees a View link per row pointing at the view route", async () => {
    localStorage.setItem(ROLE_KEY, "USER");
    setupMocks(mockFetch, () => templatesPage(SEED));
    renderTemplates();

    await screen.findByRole("cell", { name: "Welcome" });
    const viewLinks = screen.getAllByRole("link", { name: /^view /i });
    expect(viewLinks).toHaveLength(2);
    expect(viewLinks[0]).toHaveAttribute("href", "/templates/1/view");
  });

  test("admin sees Edit/Delete but not View", async () => {
    setupMocks(mockFetch, () => templatesPage(SEED));
    renderTemplates();

    await screen.findByRole("cell", { name: "Welcome" });
    expect(screen.getAllByRole("link", { name: /^edit /i })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /^view /i })).not.toBeInTheDocument();
  });

  test("Cancel in the delete modal closes it without calling DELETE", async () => {
    setupMocks(mockFetch, () => templatesPage(SEED));
    const user = userEvent.setup();
    renderTemplates();

    await user.click(await screen.findByRole("button", { name: /delete farewell/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const deleteCall = mockFetch.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "DELETE",
    );
    expect(deleteCall).toBeUndefined();
  });

  test("confirming triggers DELETE /api/templates/:id and refetches the list", async () => {
    let listCount = 0;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE" && /^\/api\/v1\/templates\/\d+$/.test(url)) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.startsWith("/api/v1/templates?")) {
        listCount++;
        const items = listCount === 1 ? SEED : [SEED[0]];
        return Promise.resolve(templatesPage(items));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTemplates();

    await user.click(await screen.findByRole("button", { name: /delete farewell/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() =>
      expect(screen.queryByRole("cell", { name: "Farewell" })).not.toBeInTheDocument(),
    );

    const deleteCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        (init as RequestInit | undefined)?.method === "DELETE" &&
        typeof url === "string" &&
        url === "/api/v1/templates/2",
    );
    expect(deleteCall).toBeDefined();
    expect(listCount).toBeGreaterThanOrEqual(2);
  });

  test("DELETE failure surfaces an alert and keeps the modal open", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "DELETE" && /^\/api\/v1\/templates\/\d+$/.test(url)) {
        return Promise.resolve(jsonResponse(500, { error: "internal", message: "boom" }));
      }
      if (url.startsWith("/api/v1/templates?")) {
        return Promise.resolve(templatesPage(SEED));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderTemplates();

    await user.click(await screen.findByRole("button", { name: /delete farewell/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^delete$/i }));

    expect(await within(dialog).findByText(/failed to delete template/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
