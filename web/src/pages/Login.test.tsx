import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../test/render";
import Login from "./Login";

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
      new Response(JSON.stringify({ token: "abc.def.ghi" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<Login />, { route: "/login" });

    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.type(screen.getByLabelText(/password/i), "hunter2");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(localStorage.getItem("lettuce.auth.token")).toBe("abc.def.ghi"),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "/login",
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
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText(/login failed \(401\)/i)).toBeInTheDocument();
    expect(localStorage.getItem("lettuce.auth.token")).toBeNull();
  });
});
