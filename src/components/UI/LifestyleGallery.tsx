import { useEffect, useRef, useState } from "react";
import { LIFESTYLE_PHOTOS } from "../../config/lifestylePhotos";
import type { RingPreviewImage } from "../../utils/ringPreview";
import type { ImageOrigin } from "./ImageLightbox";
import "../../styles/lifestyleGallery.css";

export const LifestyleGallery = ({ designKey, images, pending, onVisibleChange, onOpen, onRetry, embedded = false }: {
  embedded?: boolean;
  designKey: string; images: Record<string, RingPreviewImage | null>; pending: boolean;
  onVisibleChange: (visible: boolean) => void;
  onOpen: (image: RingPreviewImage, origin: ImageOrigin) => void;
  onRetry: (id: string) => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [decoded, setDecoded] = useState<Record<string, string>>({});
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const visible = new Set<Element>();
    const observer = new IntersectionObserver(entries => { entries.forEach(entry => { if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target); }); onVisibleChange(visible.size > 0); }, { threshold: .01 });
    list.querySelectorAll('.lifestyle-portrait').forEach(card => observer.observe(card));
    return () => { observer.disconnect(); onVisibleChange(false); };
  }, [embedded, onVisibleChange]);
  return <section className={`lifestyle-gallery ${embedded ? "is-embedded" : ""}`} ref={ref} aria-label="Your ring on a model">
    <div className="lifestyle-portraits" id="lifestyle-portraits" ref={listRef}>
      {LIFESTYLE_PHOTOS.map(photo => {
        const image = images[`${designKey}:${photo.id}`];
        const ready = Boolean(image && decoded[photo.id] === image.url);
        const preparing = image !== null && (!ready || pending);
        return <figure key={photo.id} className={`lifestyle-portrait ${preparing ? "is-refreshing" : ""}`} aria-busy={preparing}>
          <button type="button" disabled={!ready || pending} aria-label={`Enlarge ${photo.label.toLowerCase()}`} onClick={event => { if (!image) return; const rect = event.currentTarget.getBoundingClientRect(); onOpen(image, { left: rect.left, top: rect.top, width: rect.width, height: rect.height }); }}>
            {image && <img className={`lifestyle-generated-image ${ready && !pending ? "is-ready" : ""}`} src={image.url} onLoad={() => setDecoded(current => ({ ...current, [photo.id]: image.url }))} alt={`Your selected ring worn in the ${photo.label.toLowerCase()}`} loading="lazy" decoding="async" />}
            {ready && !pending && <span className="lifestyle-expand" aria-hidden="true">⤢</span>}
          </button>
          <div className={`lifestyle-portrait-status ${preparing || image === null ? "is-active" : ""}`} aria-hidden={!preparing && image !== null}>{image === null ? <button type="button" onClick={() => onRetry(photo.id)}>Retry model preview</button> : <span className="lifestyle-loading-pill" role="status"><svg viewBox="0 0 32 32" aria-hidden="true"><circle className="lifestyle-loader-orbit" cx="16" cy="19" r="9" /><path d="m10 6 3-3h6l3 3-6 7Zm0 0h12M13 3l3 10 3-10" /></svg><span>Preparing preview</span></span>}</div>
          <figcaption>{photo.label}</figcaption>
        </figure>;
      })}
    </div>
  </section>;
};
