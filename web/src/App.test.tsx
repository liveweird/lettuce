import { afterEach, beforeEach, describe, expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";

const TOKEN_KEY = "lettuce.auth.token";

function renderApp(route: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("App shell", () => {
  afterEach(() => {
    localStorage.removeItem(TOKEN_KEY);
  });

  describe("when authenticated", () => {
    beforeEach(() => {
      localStorage.setItem(TOKEN_KEY, "fake-token");
    });

    test("renders the brand and the dashboard at /", () => {
      renderApp("/");
      expect(screen.getByText("Lettuce")).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 2, name: "Dashboard" }),
      ).toBeInTheDocument();
    });

    test("navigating via the navbar swaps the main content", async () => {
      const user = userEvent.setup();
      renderApp("/");
      await user.click(screen.getByRole("link", { name: /users/i }));
      expect(
        screen.getByRole("heading", { level: 2, name: "Users" }),
      ).toBeInTheDocument();
    });

    test("shows the logout button", () => {
      renderApp("/");
      expect(
        screen.getByRole("button", { name: /logout/i }),
      ).toBeInTheDocument();
    });
  });

  describe("when not authenticated", () => {
    test("redirects from / to the login screen", () => {
      renderApp("/");
      expect(
        screen.getByRole("heading", { level: 3, name: /sign in/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { level: 2, name: "Dashboard" }),
      ).not.toBeInTheDocument();
    });

    test("redirects from a protected route to the login screen", () => {
      renderApp("/teams");
      expect(
        screen.getByRole("heading", { level: 3, name: /sign in/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { level: 2, name: "Teams" }),
      ).not.toBeInTheDocument();
    });
  });
});
