import { useCallback, useEffect, useRef, useState } from "react";

/** Mobile choices are a draft until the shopper asks to see the ring, or
 * returns to the gallery. Only the committed design reaches the renderer. */
export function useMobileRingPreview<T extends { key: string }>(draft: T, autoSync: boolean, onCommit: () => void) {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 850px)").matches);
  const [committed, setCommitted] = useState(draft);
  const [offscreen, setOffscreen] = useState(false);
  const [inCustomization, setInCustomization] = useState(false);
  const latest = useRef({ draft, committed, onCommit, mobile });
  latest.current = { draft, committed, onCommit, mobile };
  const commit = useCallback(() => {
    const current = latest.current;
    current.committed = current.draft;
    setCommitted(current.draft);
    current.onCommit();
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 850px)");
    const change = () => setMobile(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!mobile || autoSync) setCommitted(draft);
  }, [mobile, autoSync, draft]);
  useEffect(() => {
    let previousY = window.scrollY;
    let returningToViewer = false;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const live = document.querySelector(".product-live-tile")?.getBoundingClientRect();
      const gallery = document.getElementById("ring-gallery")?.getBoundingClientRect();
      const customization = document.querySelector(".product-customization-heading")?.getBoundingClientRect();
      if (!live) return;
      const y = window.scrollY;
      const current = latest.current;
      setOffscreen(live.bottom <= 0 || live.top >= window.innerHeight);
      const galleryBottom = gallery?.bottom ?? live.bottom;
      if (galleryBottom <= 0) returningToViewer = true;
      setInCustomization(Boolean(customization && customization.top < window.innerHeight * .85 && live.bottom < window.innerHeight * .35));
      // Apply before the old design can re-enter the screen. Scrolling down
      // through options must never start a render for each choice.
      if (current.mobile && y < previousY && ((returningToViewer && galleryBottom > -200) || y < 24) && current.draft.key !== current.committed.key) {
        commit();
        returningToViewer = false;
      }
      if (galleryBottom > 0) returningToViewer = false;
      previousY = y;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    measure();
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, [commit]);
  const pending = mobile && draft.key !== committed.key;
  return { mobile, rendered: mobile ? committed : draft, pending, offscreen, showButton: mobile && (inCustomization || pending), commit };
}
