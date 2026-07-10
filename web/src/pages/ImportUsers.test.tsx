import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ImportUsers from "./ImportUsers";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.role";

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderImport() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/users/import"]}>
          <Routes>
            <Route path="/users/import" element={<ImportUsers />} />
            <Route path="/users" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const CSV = "name,email\nAlice,alice@x.com\ngarbage\n";

async function uploadAndImport(user: ReturnType<typeof userEvent.setup>, sendEmails = false) {
  const file = new File([CSV], "users.csv", { type: "text/csv" });
  // Mantine FileInput renders a button plus a separate hidden native input —
  // userEvent.upload must target the real <input type="file">.
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  await user.upload(input, file);
  if (sendEmails) await user.click(screen.getByLabelText(/email the credentials/i));
  await user.click(screen.getByRole("button", { name: /^import$/i }));
}

describe("ImportUsers page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "ADMIN");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
  });

  test("posts the file text with the checkbox flag and renders the per-row summary", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rows: [
            { line: 2, name: "Alice", email: "alice@x.com", status: "CREATED", password: "pw-alice-123456" },
            { line: 3, name: "Bob", email: "bob@x.com", status: "DUPLICATE", message: "Email already in use" },
            { line: 4, status: "PARSE_ERROR", message: "Expected 'name,email'" },
            { line: 5, name: "Cee", email: "cee@x.com", status: "EMAIL_FAILED", password: "pw-cee-7654321" },
            { line: 6, name: "Dee", email: "dee@x.com", status: "ERROR", message: "boom" },
          ],
          created: 2,
          duplicates: 1,
          errors: 2,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const user = userEvent.setup();
    renderImport();
    await uploadAndImport(user, true);

    expect(await screen.findByText(/created: 2/i)).toBeInTheDocument();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ csv: CSV, sendEmails: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/users/import",
      expect.objectContaining({ method: "POST" }),
    );

    // All five statuses render, passwords only where present.
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText(/duplicate — skipped/i)).toBeInTheDocument();
    expect(screen.getByText(/parse error/i)).toBeInTheDocument();
    expect(screen.getByText(/created, email failed/i)).toBeInTheDocument();
    expect(screen.getByText(/^error$/i)).toBeInTheDocument();
    // Passwords are masked by default; revealing one row leaves the other masked.
    expect(screen.queryByText("pw-alice-123456")).not.toBeInTheDocument();
    expect(screen.queryByText("pw-cee-7654321")).not.toBeInTheDocument();
    expect(screen.getByText("*".repeat("pw-alice-123456".length))).toBeInTheDocument();
    expect(screen.getByText("*".repeat("pw-cee-7654321".length))).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /show password/i })[0]);
    expect(screen.getByText("pw-alice-123456")).toBeInTheDocument();
    expect(screen.queryByText("pw-cee-7654321")).not.toBeInTheDocument();
    expect(screen.getByText(/shown below only once/i)).toBeInTheDocument();
    // The upload form is gone.
    expect(screen.queryByRole("button", { name: /^import$/i })).not.toBeInTheDocument();
  });

  test("copies a row's password to the clipboard", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          rows: [{ line: 1, name: "Alice", email: "alice@x.com", status: "CREATED", password: "pw-copy-me-12345" }],
          created: 1,
          duplicates: 0,
          errors: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const user = userEvent.setup();
    renderImport();
    await uploadAndImport(user);

    // Copy works while the password is still masked and copies the real value.
    await screen.findByText("*".repeat("pw-copy-me-12345".length));
    await user.click(screen.getByRole("button", { name: /^copy$/i }));
    expect(await screen.findByRole("button", { name: /^copied$/i })).toBeInTheDocument();
    await expect(window.navigator.clipboard.readText()).resolves.toBe("pw-copy-me-12345");
    expect(screen.queryByText("pw-copy-me-12345")).not.toBeInTheDocument();
  });

  test("503 shows the mail-unavailable message and keeps the form", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 503 }));

    const user = userEvent.setup();
    renderImport();
    await uploadAndImport(user, true);

    expect(await screen.findByText(/cannot send email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^import$/i })).toBeInTheDocument();
  });

  test("import button is disabled without a file", () => {
    renderImport();
    expect(screen.getByRole("button", { name: /^import$/i })).toBeDisabled();
  });

  test("non-admin is redirected to /users", () => {
    localStorage.setItem(ROLE_KEY, "USER");
    renderImport();
    expect(screen.getByTestId("probe")).toHaveTextContent("/users");
    expect(screen.queryByText(/mass user import/i)).not.toBeInTheDocument();
  });
});
