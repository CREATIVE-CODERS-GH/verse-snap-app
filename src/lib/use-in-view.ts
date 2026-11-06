import { useCallback, useEffect, useState } from "react";

/**
 * Becomes true once the element is near the screen, and stays true. Discover uses it so passage text and
 * image records are requested only for results the person is actually about to see.
 * Without IntersectionObserver (very old browsers) everything counts as visible.
 */
export function useInView<T extends Element>(
  rootMargin = "300px",
): [(node: T | null) => void, boolean] {
  const [node, setNode] = useState<T | null>(null);
  const [seen, setSeen] = useState(false);
  const ref = useCallback((element: T | null) => setNode(element), []);
  useEffect(() => {
    if (seen || !node) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, seen, rootMargin]);
  return [ref, seen];
}
