import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import EditTemplate from "./EditTemplate";
import { jsonResponse } from "../test/http";

// Swap the Lexical-based editor for a plain textarea; the real wrapper is covered by
// MarkdownEditor.test.tsx.
vi.mock("../components/MarkdownEditor", async () => (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule());

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}


function renderEditTemplate(entry = "/templates/5/edit") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/templates/:id/edit" element={<EditTemplate />} />
            <Route path="/templates" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const LOADED = { id: 5, name: "Loaded Name", content: "# Loaded" };

function getReturns(mockFetch: ReturnType<typeof vi.fn>, response: Response) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url === "/api/v1/templates/5") return Promise.resolve(response);
    return Promise.resolve(jsonResponse(404, {}));
  });
}

describe("EditTemplate page", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, JSON.stringify(["ADMIN"]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("loads the template and populates the form fields", async () => {
    getReturns(mockFetch, jsonResponse(200, LOADED));
    renderEditTemplate();

    expect(await screen.findByDisplayValue("Loaded Name")).toBeInTheDocument();
    // The editor is lazy-loaded, so its (mocked) field appears asynchronously.
    expect(await screen.findByDisplayValue("# Loaded")).toBeInTheDocument();
  });

  test("404 shows a 'Template not found' message", async () => {
    getReturns(mockFetch, jsonResponse(404, { error: "not_found", message: "gone" }));
    renderEditTemplate();

    expect(await screen.findByText(/template not found/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to templates/i })).toBeInTheDocument();
  });

  test("successful save PUTs {name, content} and navigates to /templates", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/v1/templates/5") {
        return Promise.resolve(jsonResponse(200, LOADED));
      }
      if (method === "PUT" && url === "/api/v1/templates/5") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderEditTemplate();

    const nameInput = await screen.findByDisplayValue("Loaded Name");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/templates"));

    const putCall = mockFetch.mock.calls.find(
      ([url, init]) => init?.method === "PUT" && url === "/api/v1/templates/5",
    );
    expect(putCall).toBeDefined();
    expect(JSON.parse((putCall![1] as RequestInit).body as string)).toEqual({
      name: "Renamed",
      content: "# Loaded",
    });
  });

  test("409 on save shows a duplicate-name field error and does not navigate", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/v1/templates/5") {
        return Promise.resolve(jsonResponse(200, LOADED));
      }
      if (method === "PUT" && url === "/api/v1/templates/5") {
        return Promise.resolve(jsonResponse(409, { error: "conflict", message: "exists" }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderEditTemplate();

    await screen.findByDisplayValue("Loaded Name");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/a template with this name already exists/i)).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("a non-404 load error shows a 'Failed to load template' alert", async () => {
    getReturns(mockFetch, jsonResponse(500, { error: "internal", message: "boom" }));
    renderEditTemplate();

    expect(await screen.findByText(/failed to load template/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to templates/i })).toBeInTheDocument();
  });

  test("404 on save shows 'Template no longer exists'", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/v1/templates/5") {
        return Promise.resolve(jsonResponse(200, LOADED));
      }
      if (method === "PUT" && url === "/api/v1/templates/5") {
        return Promise.resolve(jsonResponse(404, { error: "not_found", message: "gone" }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderEditTemplate();

    await screen.findByDisplayValue("Loaded Name");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/template no longer exists/i)).toBeInTheDocument();
  });

  test("a network error on save shows a connection alert", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/v1/templates/5") {
        return Promise.resolve(jsonResponse(200, LOADED));
      }
      if (method === "PUT" && url === "/api/v1/templates/5") {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderEditTemplate();

    await screen.findByDisplayValue("Loaded Name");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/check your connection/i)).toBeInTheDocument();
  });

  test("the Name clear button empties the field", async () => {
    getReturns(mockFetch, jsonResponse(200, LOADED));
    const user = userEvent.setup();
    renderEditTemplate();

    const name = await screen.findByDisplayValue("Loaded Name");
    await user.click(screen.getByRole("button", { name: /clear name/i }));
    expect(name).toHaveValue("");
  });

  test("Cancel opens a discard confirmation whose Discard links back to /templates", async () => {
    getReturns(mockFetch, jsonResponse(200, LOADED));
    const user = userEvent.setup();
    renderEditTemplate();

    await screen.findByDisplayValue("Loaded Name");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(await screen.findByText(/discard changes\?/i)).toBeInTheDocument();
    expect(
      screen.getByText(/any unsaved changes to this template will be lost/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /discard/i })).toHaveAttribute("href", "/templates");
  });

  test("non-admin is redirected to /templates", () => {
    localStorage.setItem(ROLE_KEY, "[]");
    renderEditTemplate();
    expect(screen.getByTestId("probe")).toHaveTextContent("/templates");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("an invalid id redirects to /templates", () => {
    renderEditTemplate("/templates/abc/edit");
    expect(screen.getByTestId("probe")).toHaveTextContent("/templates");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
