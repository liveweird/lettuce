import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import EmojiButton from "./EmojiButton";

// vi.mock intercepts EmojiButton's React.lazy dynamic import, so the real emoji-mart
// (a shadow-DOM custom element happy-dom can't drive) never loads.
vi.mock("./EmojiPicker", () => ({
  default: ({ onSelect }: { onSelect: (native: string) => void }) => (
    <button onClick={() => onSelect("🎉")}>pick</button>
  ),
}));

function renderButton(onSelect = vi.fn()) {
  render(
    <MantineProvider env="test">
      <EmojiButton onSelect={onSelect} label="Insert emoji" />
    </MantineProvider>,
  );
  return onSelect;
}

afterEach(cleanup);

describe("EmojiButton", () => {
  test("renders the labeled trigger without mounting the picker", () => {
    renderButton();
    expect(screen.getByRole("button", { name: "Insert emoji" })).toBeInTheDocument();
    expect(screen.queryByText("pick")).toBeNull();
  });

  test("opens the picker on click; selecting forwards the emoji and closes", async () => {
    const onSelect = renderButton();
    await userEvent.click(screen.getByRole("button", { name: "Insert emoji" }));
    await userEvent.click(await screen.findByText("pick"));
    expect(onSelect).toHaveBeenCalledWith("🎉");
    expect(screen.queryByText("pick")).toBeNull();
  });

  test("a second trigger click closes the picker without selecting", async () => {
    const onSelect = renderButton();
    const trigger = screen.getByRole("button", { name: "Insert emoji" });
    await userEvent.click(trigger);
    await screen.findByText("pick");
    await userEvent.click(trigger);
    expect(screen.queryByText("pick")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
