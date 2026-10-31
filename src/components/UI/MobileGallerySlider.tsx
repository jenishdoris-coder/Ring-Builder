import { useRef, useState, type ReactNode } from "react";
import "../../styles/mobileGallerySlider.css";

export function MobileGallerySlider({ children }: { children: ReactNode }) {
  const rail = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ index: 0, end: false });
  const measure = () => {
    const element = rail.current; if (!element) return;
    const cards = [...element.querySelectorAll<HTMLElement>('figure')];
    let index = 0;
    cards.forEach((card, i) => { if (Math.abs(card.offsetLeft - element.scrollLeft) < Math.abs(cards[index].offsetLeft - element.scrollLeft)) index = i; });
    const end = element.scrollLeft + element.clientWidth >= element.scrollWidth - 2;
    setPosition(current => current.index === index && current.end === end ? current : { index, end });
  };
  const move = (step: number) => {
    const element = rail.current; if (!element) return;
    const cards = [...element.querySelectorAll<HTMLElement>('figure')];
    const target = cards[Math.max(0, Math.min(cards.length - 1, position.index + step))];
    if (target) element.scrollTo({ left: target.offsetLeft, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return <div className="mobile-gallery-slider" role="region" aria-label="Ring and hand image slider">
    <div className="mobile-gallery-rail" ref={rail} onScroll={measure}>{children}</div>
    <div className="mobile-gallery-navigation"><span>Swipe to explore · {position.index + 1}–{Math.min(6, position.index + 2)} of 6</span><div>
      <button type="button" disabled={position.index === 0} aria-label="Previous gallery image" onClick={() => move(-1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button>
      <button type="button" disabled={position.end} aria-label="Next gallery image" onClick={() => move(1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></button>
    </div></div>
  </div>;
}
