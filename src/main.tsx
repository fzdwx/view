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
import { prewarmFontFallbacks } from "./lib/fontFallbackPrewarm";
import { installNativeWebviewBehavior } from "./lib/nativeWebviewBehavior";
import { installMainWindowStatePersistence } from "./lib/nativeWindowState";
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
        <RouterProvider router={router} />
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
createRoot(rootElement()).render(<RootApp />);
