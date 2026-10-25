import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { FullScreenLoading } from "./components/search-states";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Scripture text never changes, so reuse what has already been fetched
        // instead of re-requesting it while moving between screens.
        staleTime: 10 * 60 * 1000,
        gcTime: 60 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Stitch 15: a page that takes a moment to load shows the loading screen, not a blank page.
    defaultPendingComponent: FullScreenLoading,
    defaultPendingMs: 600,
  });

  return router;
};
