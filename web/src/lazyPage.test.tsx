import { describe, expect, it } from "vitest";
import { Suspense, useState } from "react";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import lazyPage from "./lazyPage";

function Hello({ name }: { name: string }) {
  return <p>hello {name}</p>;
}

describe("lazyPage", () => {
  it("suspends on first render like React.lazy when it was not preloaded", async () => {
    const Page = lazyPage(() => Promise.resolve({ default: Hello }));
    render(
      <Suspense fallback={<p>loading</p>}>
        <Page name="ann" />
      </Suspense>,
    );
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(await screen.findByText("hello ann")).toBeInTheDocument();
  });

  it("renders synchronously after preload() — no fallback", async () => {
    const Page = lazyPage(() => Promise.resolve({ default: Hello }));
    await Page.preload();
    render(
      <Suspense fallback={<p>loading</p>}>
        <Page name="bob" />
      </Suspense>,
    );
    expect(screen.getByText("hello bob")).toBeInTheDocument();
    expect(screen.queryByText("loading")).not.toBeInTheDocument();
  });

  it("a preload finishing after the first render does not remount the mounted page", async () => {
    function Counter({ label }: { label: string }) {
      const [n, setN] = useState(0);
      return (
        <button onClick={() => setN(n + 1)}>
          {label} {n}
        </button>
      );
    }
    const Page = lazyPage(() => Promise.resolve({ default: Counter }));
    const ui = (label: string) => (
      <Suspense fallback={<p>loading</p>}>
        <Page label={label} />
      </Suspense>
    );
    const { rerender } = render(ui("count"));
    await userEvent.click(await screen.findByRole("button", { name: "count 0" }));
    expect(screen.getByRole("button", { name: "count 1" })).toBeInTheDocument();
    await Page.preload();
    rerender(ui("clicks"));
    // Same element type across the re-render: the state (1) survived.
    expect(screen.getByRole("button", { name: "clicks 1" })).toBeInTheDocument();
  });

  it("keeps preloaded pages independent of each other", async () => {
    const A = lazyPage(() => Promise.resolve({ default: () => <p>page a</p> }));
    const B = lazyPage(() => Promise.resolve({ default: () => <p>page b</p> }));
    await A.preload();
    render(
      <Suspense fallback={<p>loading</p>}>
        <A />
        <B />
      </Suspense>,
    );
    // B was not preloaded, so it still suspends the boundary.
    expect(screen.getByText("loading")).toBeInTheDocument();
    expect(await screen.findByText("page b")).toBeInTheDocument();
  });
});
