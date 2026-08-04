import { afterEach, describe, expect, test, vi } from "vitest";
import { notifications } from "@mantine/notifications";
import { showSuccessToast } from "./toast";

describe("showSuccessToast", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("shows a teal success notification carrying the message", () => {
    const show = vi.spyOn(notifications, "show").mockReturnValue("id");
    showSuccessToast("Changes saved");
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Changes saved", color: "teal" }),
    );
  });
});
