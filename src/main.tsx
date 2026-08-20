import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { getDb } from "@/lib/db";
import { ensureSrd } from "@/lib/srd";
import { routeTree } from "./routeTree.gen";
import "./index.css";

const queryClient = new QueryClient();
const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

function BootError({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-lg flex-col gap-2">
        <p className="text-sm font-medium">AI TRPG Engine 启动失败</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function renderApp(node: React.ReactNode) {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark">
        {node}
      </ThemeProvider>
    </React.StrictMode>,
  );
}

async function boot() {
  try {
    await getDb();
    await ensureSrd();
    renderApp(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    renderApp(<BootError message={message} />);
  }
}

void boot();
