import { afterEach, describe, expect, test, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render";
import PersonaChip from "./PersonaChip";
import TruncatedText from "./TruncatedText";

const LONG = "Aleksandra Kowalska-Wiśniewska-Nowakowska";

// happy-dom has no layout: scrollWidth/clientWidth are 0/0, so "truncated" is whatever the test
// says. Restored after each test.
const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, "scrollWidth");
const originalClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
function layout(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(Element.prototype, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: clientWidth });
}
afterEach(() => {
  vi.useRealTimers();
  if (originalScroll) Object.defineProperty(Element.prototype, "scrollWidth", originalScroll);
  if (originalClient) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClient);
});

const tooltip = () => document.body.querySelector<HTMLElement>('[role="tooltip"]');

describe("TruncatedText", () => {
  test("keeps the full text in the DOM and truncates it visually", () => {
    renderWithProviders(<TruncatedText>{LONG}</TruncatedText>);
    const text = screen.getByText(LONG);
    expect(text).toHaveAttribute("data-truncate", "end");
    expect(tooltip()).toBeNull();
  });

  test("a cut-off text shows its full text in a tooltip on hover, hidden from assistive tech", async () => {
    layout(300, 120);
    renderWithProviders(<TruncatedText>{LONG}</TruncatedText>);
    const text = screen.getByText(LONG);
    await userEvent.hover(text);
    await waitFor(() => expect(tooltip()).not.toBeNull());
    // The label repeats the text, so it must not be announced twice.
    const hidden = tooltip()!.querySelector('[aria-hidden="true"]');
    expect(hidden).toHaveTextContent(LONG);
    // The text is exposed once: by the element itself.
    expect(screen.getAllByText(LONG)).toHaveLength(2);
    expect(screen.getAllByText(LONG).filter((el) => !el.closest('[aria-hidden="true"]'))).toHaveLength(1);
    await userEvent.unhover(text);
    await waitFor(() => expect(tooltip()).toBeNull());
  });

  test("a text that fits never gets a tooltip", async () => {
    layout(80, 120);
    renderWithProviders(<TruncatedText>Short name</TruncatedText>);
    await userEvent.hover(screen.getByText("Short name"));
    // Past the 300 ms intent delay.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(tooltip()).toBeNull();
  });

  test("opens on keyboard focus of the nearest focusable ancestor and Escape dismisses it", async () => {
    layout(300, 120);
    renderWithProviders(
      <a href="/users/1">
        <TruncatedText>{LONG}</TruncatedText>
      </a>,
    );
    expect(tooltip()).toBeNull();
    await userEvent.tab();
    expect(screen.getByRole("link")).toHaveFocus();
    await waitFor(() => expect(tooltip()).not.toBeNull());
    fireEvent.keyDown(screen.getByRole("link"), { key: "Escape" });
    await waitFor(() => expect(tooltip()).toBeNull());
  });

  test("a focusable scroll region around the text is not its focus host (hover only)", async () => {
    layout(300, 120);
    renderWithProviders(
      <div role="region" aria-label="Scrolling table" tabIndex={0}>
        <TruncatedText>{LONG}</TruncatedText>
      </div>,
    );
    await userEvent.tab();
    expect(screen.getByRole("region")).toHaveFocus();
    // Past the intent delay: focus on the region must not open the tooltip.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(tooltip()).toBeNull();
    await userEvent.hover(screen.getByText(LONG));
    await waitFor(() => expect(tooltip()).not.toBeNull());
  });
});

describe("PersonaChip truncation", () => {
  test("the linked name keeps its accessible name and reveals the full name on keyboard focus", async () => {
    layout(300, 120);
    renderWithProviders(<PersonaChip name={LONG} to="/users/1/details" ariaLabel="Details of Aleksandra" />);
    const link = screen.getByRole("link", { name: "Details of Aleksandra" });
    await userEvent.tab();
    expect(link).toHaveFocus();
    await waitFor(() => expect(tooltip()).not.toBeNull());
    expect(tooltip()).toHaveTextContent(LONG);
    expect(screen.getByRole("link", { name: "Details of Aleksandra" })).toBeInTheDocument();
  });

  test("a plain (non-link) name is also revealed when cut off", async () => {
    layout(300, 120);
    renderWithProviders(<PersonaChip name={LONG} />);
    await userEvent.hover(screen.getAllByText(LONG)[0]);
    await waitFor(() => expect(tooltip()).not.toBeNull());
  });
});
