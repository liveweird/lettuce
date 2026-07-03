import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreateTemplate from "./CreateTemplate";

// Swap the Lexical-based editor for a plain textarea; the real wrapper is covered by
// MarkdownEditor.test.tsx.
vi.mock("../components/MarkdownEditor", async () => (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule());

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderCreateTemplate() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/templates/new"]}>
          <Routes>
            <Route path="/templates/new" element={<CreateTemplate />} />
            <Route path="/templates" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CreateTemplate page", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

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

  test("admin sees the form with Name and a WYSIWYG Content field", async () => {
    renderCreateTemplate();
    expect(await screen.findByRole("heading", { name: /create template/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/content/i)).toBeInTheDocument();
    // The old side-by-side Preview pane is gone — the editor renders markdown in place.
    expect(screen.queryByText(/preview/i)).not.toBeInTheDocument();
  });

  test("client-side validation blocks an empty submission (name required)", async () => {
    const user = userEvent.setup();
    renderCreateTemplate();

    await user.click(await screen.findByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/name must be 1–100 characters/i)).toBeInTheDocument();
    const postCall = mockFetch.mock.calls.find(
      ([url, init]) => init?.method === "POST" && url === "/api/v1/templates",
    );
    expect(postCall).toBeUndefined();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("typing flows into the content field", async () => {
    const user = userEvent.setup();
    renderCreateTemplate();

    await user.type(await screen.findByLabelText(/content/i), "# Hi");

    expect(screen.getByLabelText(/content/i)).toHaveValue("# Hi");
  });

  test("successful create POSTs {name, content} and navigates to /templates", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url === "/api/v1/templates") {
        return Promise.resolve(jsonResponse(201, { id: 7, name: "Welcome", content: "Body" }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderCreateTemplate();

    await user.type(screen.getByLabelText(/name/i), "Welcome");
    await user.type(screen.getByLabelText(/content/i), "Body");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/templates"));

    const postCall = mockFetch.mock.calls.find(
      ([url, init]) => init?.method === "POST" && url === "/api/v1/templates",
    );
    expect(postCall).toBeDefined();
    expect(JSON.parse((postCall![1] as RequestInit).body as string)).toEqual({
      name: "Welcome",
      content: "Body",
    });
  });

  test("409 duplicate name shows a field error and does not navigate", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url === "/api/v1/templates") {
        return Promise.resolve(jsonResponse(409, { error: "conflict", message: "exists" }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderCreateTemplate();

    await user.type(screen.getByLabelText(/name/i), "Welcome");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/a template with this name already exists/i)).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("403 shows a permission error alert", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url === "/api/v1/templates") {
        return Promise.resolve(jsonResponse(403, { error: "forbidden", message: "no" }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderCreateTemplate();

    await user.type(screen.getByLabelText(/name/i), "Welcome");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/don't have permission to create templates/i)).toBeInTheDocument();
  });

  test("400 shows a validation error alert", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url === "/api/v1/templates") {
        return Promise.resolve(jsonResponse(400, { error: "bad_request", message: "no" }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderCreateTemplate();

    await user.type(screen.getByLabelText(/name/i), "Welcome");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/validation error/i)).toBeInTheDocument();
  });

  test("an unexpected status shows a generic create-failed alert", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url === "/api/v1/templates") {
        return Promise.resolve(jsonResponse(500, { error: "internal", message: "boom" }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderCreateTemplate();

    await user.type(screen.getByLabelText(/name/i), "Welcome");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/create failed \(500\)/i)).toBeInTheDocument();
  });

  test("a network error shows a connection alert", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url === "/api/v1/templates") {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });
    const user = userEvent.setup();
    renderCreateTemplate();

    await user.type(screen.getByLabelText(/name/i), "Welcome");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/check your connection/i)).toBeInTheDocument();
  });

  test("the Name clear button empties the field", async () => {
    const user = userEvent.setup();
    renderCreateTemplate();

    const name = await screen.findByLabelText(/name/i);
    await user.type(name, "Welcome");
    expect(name).toHaveValue("Welcome");
    await user.click(screen.getByRole("button", { name: /clear name/i }));
    expect(name).toHaveValue("");
  });

  test("non-admin is redirected to /templates without rendering the form", () => {
    localStorage.setItem(ROLE_KEY, "USER");
    renderCreateTemplate();
    expect(screen.getByTestId("probe")).toHaveTextContent("/templates");
    expect(screen.queryByRole("heading", { name: /create template/i })).not.toBeInTheDocument();
  });

  test("Cancel links back to /templates", async () => {
    renderCreateTemplate();
    const cancel = await screen.findByRole("link", { name: /cancel/i });
    expect(cancel).toHaveAttribute("href", "/templates");
  });
});
