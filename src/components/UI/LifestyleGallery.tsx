import { useEffect, useRef, useState } from "react";
import { LIFESTYLE_PHOTOS } from "../../config/lifestylePhotos";
import type { RingPreviewImage } from "../../utils/ringPreview";
import type { ImageOrigin } from "./ImageLightbox";
import "../../styles/lifestyleGallery.css";

export const LifestyleGallery = ({ designKey, images, pending, onVisibleChange, onOpen, onRetry }: {
  designKey: string; images: Record<string, RingPreviewImage | null>; pending: boolean;
  onVisibleChange: (visible: boolean) => void;
  onOpen: (image: RingPreviewImage, origin: ImageOrigin) => void;
  onRetry: (id: string) => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 850px)").matches);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 850px)");
    const change = () => setMobile(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    const list = listRef.current;
    if (!list || mobile && !open) { onVisibleChange(false); return; }
    const observer = new IntersectionObserver(entries => onVisibleChange(entries.some(entry => entry.isIntersecting)), { threshold: .01 });
    observer.observe(list);
    return () => { observer.disconnect(); onVisibleChange(false); };
  }, [mobile, open, onVisibleChange]);
  return <section className={`lifestyle-gallery ${open ? "is-open" : ""}`} ref={ref} aria-label="Your ring on a model">
    {mobile && <button type="button" className="lifestyle-gallery-heading" aria-expanded={open} aria-controls="lifestyle-portraits" onClick={() => setOpen(value => !value)}>
      <span><strong>See your ring on a model</strong><small>Two portraits · swipe to explore</small></span>
      <svg viewBox="0 0 24 24" aria-hidden="true" className={open ? "is-up" : ""}><path d="m7 10 5 5 5-5" /></svg>
    </button>}
    <div className="lifestyle-portraits" id="lifestyle-portraits" ref={listRef} hidden={mobile && !open}>
      {LIFESTYLE_PHOTOS.map(photo => {
        const image = images[`${designKey}:${photo.id}`];
        return <figure key={photo.id} className={`lifestyle-portrait ${!image || pending ? "is-refreshing" : ""}`} aria-busy={image === undefined || pending}>
          <button type="button" disabled={!image || pending} aria-label={`Enlarge ${photo.label.toLowerCase()}`} onClick={event => { if (!image) return; const rect = event.currentTarget.getBoundingClientRect(); onOpen(image, { left: rect.left, top: rect.top, width: rect.width, height: rect.height }); }}>
            <img src={image?.url ?? photo.image} alt={image ? `Your selected ring worn in the ${photo.label.toLowerCase()}` : ""} loading="lazy" /><span className="lifestyle-expand" aria-hidden="true">⤢</span>
          </button>
          {!image && <div className="lifestyle-portrait-status">{image === null ? <button type="button" onClick={() => onRetry(photo.id)}>Retry model preview</button> : <span>Preparing your model preview</span>}</div>}
          <figcaption>{photo.label}</figcaption>
        </figure>;
      })}
    </div>
  </section>;
};
