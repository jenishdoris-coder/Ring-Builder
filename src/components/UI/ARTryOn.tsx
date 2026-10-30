import { lazy, Suspense, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { SelectedRing } from '../../../ar/src/selected-ring';
import type { RingEngravingConfig } from '../../config/engraving';
import '../../styles/arOverlay.css';

const ARExperience = lazy(() => import('../../../ar/src/ARExperience'));

export function ARTryOn({ selection, engraving, onClose }: { selection: SelectedRing; engraving: RingEngravingConfig[]; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const studio = document.getElementById('canvas-container');
    const wasInert = studio?.inert ?? false;
    if (studio) studio.inert = true;
    document.body.style.overflow = document.documentElement.style.overflow = 'hidden';
    dialog.current?.focus({preventScroll:true});
    const onKey = (event:KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]') ?? []);
      const first = controls[0], last = controls[controls.length-1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown',onKey);
    return () => {
      document.removeEventListener('keydown',onKey);
      if (studio) studio.inert = wasInert;
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      previousFocus?.focus({preventScroll:true});
    };
  },[]);
  return createPortal(<div ref={dialog} className="ar-overlay" role="dialog" aria-modal="true" aria-label="Try your ring in AR" tabIndex={-1}>
    <Suspense fallback={<div className="ar-opening"><button type="button" className="ar-opening-back" onClick={onClose}>← Back to your ring</button><div role="status"><span className="ar-opening-spinner" /><p>Preparing your try-on…</p></div></div>}>
      <ARExperience selection={selection} engraving={engraving} onClose={onClose} />
    </Suspense>
  </div>,document.body);
}
