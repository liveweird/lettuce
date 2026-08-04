import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MantineProvider, ColorSchemeScript } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/inter/index.css";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./index.css";
import "./i18n";
import App from "./App.tsx";
import { theme } from "./theme";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ColorSchemeScript defaultColorScheme="auto" />
    <MantineProvider theme={theme} defaultColorScheme="auto">
      {/* The success-toast host (utils/toast.tsx is the only writer). Top-center on purpose:
          bottom-right would cover PaginationBar and form footers, top-right the header
          user-menu/bell cluster. Deliberately mounted here, not in App — tests never see it. */}
      <Notifications position="top-center" autoClose={2500} limit={3} />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
