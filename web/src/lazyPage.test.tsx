import { describe, expect, it, vi } from "vitest";
import lazyPage from "./lazyPage";

const Dummy = () => null;

describe("lazyPage.preload", () => {
  it("loads the module once however often it is called", async () => {
    const loader = vi.fn().mockResolvedValue({ default: Dummy });
    const Page = lazyPage(loader);
    await Promise.all([Page.preload(), Page.preload()]);
    await Page.preload();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed load", async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error("404")).mockResolvedValue({ default: Dummy });
    const Page = lazyPage(loader);
    await expect(Page.preload()).rejects.toThrow("404");
    await Page.preload();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
