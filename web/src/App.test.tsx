import { describe, expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import App from "./App";

function renderApp(route: string) {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe("App shell", () => {
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

  test("hides the logout button when not authenticated", () => {
    renderApp("/");
    expect(
      screen.queryByRole("button", { name: /logout/i }),
    ).not.toBeInTheDocument();
  });

  test("shows the logout button when a token is present", () => {
    localStorage.setItem("lettuce.auth.token", "fake-token");
    renderApp("/");
    expect(
      screen.getByRole("button", { name: /logout/i }),
    ).toBeInTheDocument();
  });
});
