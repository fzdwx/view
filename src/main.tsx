import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { App } from "./App";
import { SettingsWindowApp } from "./components/SettingsWindowApp";
import { DiffRenderingProvider } from "./components/workbench/DiffRenderingProvider";
import { prewarmFontFallbacks } from "./lib/fontFallbackPrewarm";
import { installNativeWebviewBehavior } from "./lib/nativeWebviewBehavior";
import { installMainWindowStatePersistence } from "./lib/nativeWindowState";
import { loadAppSettings } from "./lib/settings";
import { preloadSettingsWindow, installSettingsWindowZoom } from "./lib/settingsWindow";
import { applyDisplayScale } from "./lib/windowDpiScaling";
import "./styles.css";

const queryClient = new QueryClient();

const rootRoute = createRootRoute({
  component: Outlet,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: App,
});

const router = createRouter({
  routeTree: rootRoute.addChildren([indexRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function RootApp() {
  return (
    <QueryClientProvider client={queryClient}>
      {isSettingsWindowRoute() ? (
        <SettingsWindowApp />
      ) : (
        <DiffRenderingProvider>
          <RouterProvider router={router} />
        </DiffRenderingProvider>
      )}
    </QueryClientProvider>
  );
}

function rootElement(): HTMLElement {
  const element = document.getElementById("root");
  if (!element) {
    throw new Error("Missing root element");
  }

  return element;
}

function isSettingsWindowRoute(): boolean {
  const url = new URL(window.location.href);
  return (
    url.pathname === "/settings" || url.searchParams.get("window") === "settings"
  );
}

installNativeWebviewBehavior();
installMainWindowStatePersistence();
prewarmFontFallbacks();
if (isSettingsWindowRoute()) {
  void installSettingsWindowZoom(loadAppSettings().appZoom);
} else {
  void preloadSettingsWindow();
  void applyDisplayScale({ appZoom: loadAppSettings().appZoom });
}
createRoot(rootElement()).render(<RootApp />);
