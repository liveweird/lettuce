import { useState } from "react";
import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Button, MantineProvider, Transition } from "@mantine/core";
import { renderWithProviders } from "./render";

// Pins that Mantine transitions are synchronous under test (see the comment in ./setup.ts): with
// `prefers-reduced-motion: reduce` forced, useTransition's mount/unmount effect never schedules an
// rAF/rAF/setTimeout chain, so a mounted Transition's content is visible immediately and no timer
// is left pending — which is exactly what stops that timer from outliving happy-dom's environment
// and throwing "window is not defined" after the suite tears down (the two 2026-09 CI flakes this
// pins against). Revert the setup.ts change locally and re-run this file to see it fail with a
// nonzero `vi.getTimerCount()` after the flip.
function Flippable() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen((v) => !v)}>toggle</Button>
      <Transition mounted={open} transition="fade">
        {(styles) => <div style={styles}>content</div>}
      </Transition>
    </>
  );
}

test("Mantine transitions mount/unmount synchronously and leave no pending timers", () => {
  vi.useFakeTimers();
  try {
    renderWithProviders(<Flippable />);

    expect(screen.queryByText("content")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    expect(screen.getByText("content")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    expect(screen.queryByText("content")).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

// The second half of the setup.ts fix: many page tests render through a bare
// `<MantineProvider env="test">` with no `theme={theme}`, which resolves to Mantine's shared
// DEFAULT_THEME — whose `respectReducedMotion` setup.ts flips to true. Without that flip the
// forced media query is ignored on the bare provider and the timer chain comes back.
test("a bare MantineProvider (no app theme) also transitions synchronously", () => {
  vi.useFakeTimers();
  try {
    render(
      <MantineProvider env="test">
        <Flippable />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    expect(screen.getByText("content")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
