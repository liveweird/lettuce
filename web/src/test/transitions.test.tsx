import { useState } from "react";
import { expect, test, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { Button, Transition } from "@mantine/core";
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
