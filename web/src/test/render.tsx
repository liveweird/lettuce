import { type ReactElement } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";

interface Options extends Omit<RenderOptions, "wrapper"> {
  route?: string;
}

export function renderWithProviders(ui: ReactElement, options: Options = {}) {
  const { route = "/", ...rest } = options;
  return render(ui, {
    wrapper: ({ children }) => (
      <MantineProvider>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </MantineProvider>
    ),
    ...rest,
  });
}

export * from "@testing-library/react";
