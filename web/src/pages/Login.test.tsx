import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../test/render";
import App from "../App";
import Login from "./Login";

// These cases log in and land on the authenticated shell, which mounts react-joyride (the guided
// tour). Stub it so the tour's layout engine isn't exercised under happy-dom.
vi.mock("react-joyride", () => ({
  Joyride: () => null,
  STATUS: {},
}));

describe("Login page", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("stores the token on successful login", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ token: "abc.def.ghi", expiresAt: 0, userId: 1, role: "USER" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<Login />, { route: "/login" });

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(localStorage.getItem("lettuce.auth.token")).toBe("abc.def.ghi"),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/login",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("surfaces an error on failed login", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response("{}", { status: 401, headers: { "Content-Type": "application/json" } }),
    );

    const user = userEvent.setup();
    renderWithProviders(<Login />, { route: "/login" });

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(
      await screen.findByText(/invalid email or password/i),
    ).toBeInTheDocument();
    expect(localStorage.getItem("lettuce.auth.token")).toBeNull();
  });

  test("surfaces a generic message for a non-401 server error", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response("{}", { status: 500, headers: { "Content-Type": "application/json" } }),
    );

    const user = userEvent.setup();
    renderWithProviders(<Login />, { route: "/login" });

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    // The 500 branch reports the status rather than the credentials message.
    expect(await screen.findByText(/login failed \(500\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/invalid email or password/i)).toBeNull();
  });

  test("validates email format client-side without calling the API", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;

    const user = userEvent.setup();
    renderWithProviders(<Login />, { route: "/login" });

    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/enter a valid email/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("shows a 'signed out' banner after the user logs out, hidden on first interaction", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    localStorage.setItem("lettuce.auth.token", "fake-token");

    const user = userEvent.setup();
    renderWithProviders(<App />, { route: "/" });

    await user.click(await screen.findByRole("button", { name: /logout/i }));

    expect(
      await screen.findByText(/you've been signed out/i),
    ).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/logout",
      expect.objectContaining({ method: "POST" }),
    );

    await user.type(screen.getByLabelText(/email/i), "a");
    expect(screen.queryByText(/you've been signed out/i)).not.toBeInTheDocument();

    localStorage.removeItem("lettuce.auth.token");
  });

  test("returns the user to the page they tried to reach before login", async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ token: "abc.def.ghi", expiresAt: 0, userId: 1, role: "USER" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<App />, { route: "/teams" });

    expect(
      await screen.findByRole("heading", { level: 3, name: /sign in/i }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(
      await screen.findByRole("heading", { level: 2, name: "Teams" }),
    ).toBeInTheDocument();
  });
});
