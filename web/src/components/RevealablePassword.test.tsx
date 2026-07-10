import { describe, expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import RevealablePassword from "./RevealablePassword";

const PASSWORD = "sup3r-Secret_pw1";

function renderIt() {
  return render(
    <MantineProvider env="test">
      <RevealablePassword password={PASSWORD} />
    </MantineProvider>,
  );
}

describe("RevealablePassword", () => {
  test("masks the password with same-length stars by default", () => {
    renderIt();
    expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
    expect(screen.getByText("*".repeat(PASSWORD.length))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show password/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("the eye toggle reveals and hides again", async () => {
    const user = userEvent.setup();
    renderIt();

    await user.click(screen.getByRole("button", { name: /show password/i }));
    expect(screen.getByText(PASSWORD)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hide password/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: /hide password/i }));
    expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
    expect(screen.getByText("*".repeat(PASSWORD.length))).toBeInTheDocument();
  });

  test("copy while masked still copies the real password", async () => {
    const user = userEvent.setup();
    renderIt();

    await user.click(screen.getByRole("button", { name: /^copy$/i }));
    expect(await screen.findByRole("button", { name: /^copied$/i })).toBeInTheDocument();
    await expect(window.navigator.clipboard.readText()).resolves.toBe(PASSWORD);
    // Copying does not reveal.
    expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument();
  });
});
