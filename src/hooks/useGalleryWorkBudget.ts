import { useEffect, useState } from "react";

/** Let native scrolling own the frame budget, including the desktop gallery's
 * nested scroll area. The live WebGL tile can sleep behind the photo section. */
export function useGalleryWorkBudget() {
  const [scrolling, setScrolling] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(true);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let moving = false;
    const onScroll = () => {
      if (!moving) { moving = true; setScrolling(true); }
      clearTimeout(timer);
      timer = setTimeout(() => { moving = false; setScrolling(false); }, 180);
    };
    // Scroll does not bubble from an overflow container; capture is needed for
    // the desktop gallery as well as the mobile document.
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    const tile = document.querySelector(".product-live-tile");
    const observer = new IntersectionObserver(entries => setViewerVisible(entries.some(entry => entry.isIntersecting)), { threshold: .01 });
    if (tile) observer.observe(tile);
    return () => { clearTimeout(timer); observer.disconnect(); window.removeEventListener("scroll", onScroll, true); };
  }, []);
  return { scrolling, viewerVisible };
}
