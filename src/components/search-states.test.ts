import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NOT_FOUND_MESSAGE, NotFoundActions } from "@/components/search-states";

async function render(onRetry?: () => void) {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => createElement(NotFoundActions, { onRetry }),
  });
  const stub = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([index, stub("/voice"), stub("/search")]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("NotFoundActions", () => {
  it("links Speak Again to /voice and Search Manually to /search", async () => {
    const markup = await render();
    expect(markup).toMatch(/href="\/voice"[^>]*>.*Speak Again/s);
    expect(markup).toMatch(/href="\/search"[^>]*>.*Search Manually/s);
    expect(markup).toContain("bg-vs-primary");
    expect(markup).toContain("h-12");
  });

  it("shows Try again only when a retry handler is given", async () => {
    expect(await render()).not.toContain("Try again");
    expect(await render(() => {})).toContain("Try again");
  });

  it("uses the recovery copy", () => {
    expect(NOT_FOUND_MESSAGE).toBe(
      "We couldn't find that Bible reference. Try speaking again or search for a different verse.",
    );
  });

  it("is wired into the reader, retrying only on query errors", () => {
    const src = read("src/routes/verse.$translation.$book.$chapter.$verse.tsx");
    expect(src).toContain("NotFoundActions");
    expect(src).toMatch(/onRetry=\{\s*verseQuery\.isError/);
  });
});
