/** Keep a decoded frame over the canvas while camera controls/materials change. */
export const holdViewerFrame = async (viewer: any, canvas: HTMLCanvasElement): Promise<(immediate?: boolean) => void> => {
  const parent = canvas.parentElement;
  if (!parent) return () => {};
  const previous = parent.querySelector<HTMLImageElement>("img[data-camera-frame]");
  let source = previous?.src;
  if (!source) {
    viewer.setDirty?.();
    await Promise.race([viewer.doOnce("postRender"), new Promise(resolve => setTimeout(resolve, 150))]);
    if (!canvas.isConnected) return () => {};
    try { source = canvas.toDataURL("image/png"); } catch { return () => {}; }
  }
  const image = document.createElement("img");
  image.src = source;
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  image.dataset.cameraFrame = "true";
  Object.assign(image.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "4", transition: "opacity 140ms ease-out" });
  try { await image.decode(); } catch { return () => {}; }
  if (!canvas.isConnected) return () => {};
  previous?.remove();
  parent.appendChild(image);
  let released = false;
  return (immediate = false) => {
    if (released || !image.isConnected) return;
    released = true;
    // After a warm-up render the real canvas is ready before the camera starts
    // moving. Remove the guard now so it cannot cover the camera animation.
    if (immediate) { image.remove(); return; }
    const reveal = () => {
      if (!image.isConnected) return;
      requestAnimationFrame(() => {
        image.style.opacity = "0";
        setTimeout(() => image.remove(), 160);
      });
    };
    viewer.setDirty?.();
    void Promise.race([viewer.doOnce("postRender"), new Promise(resolve => setTimeout(resolve, 150))]).then(reveal);
  };
};

export const clearViewerFrames = (canvas: HTMLCanvasElement | null) => {
  canvas?.parentElement?.querySelectorAll("img[data-camera-frame]").forEach(image => image.remove());
};

/** A completed animation can still have its penultimate pixels on the canvas. */
export const waitForCompleteRingFrame = (viewer: any, isCurrent: () => boolean): Promise<boolean> => {
  if (!isCurrent()) return Promise.resolve(false);
  // Discard temporal history containing the last partially dissolved ring.
  viewer.getPluginByType?.("TAA")?.pass?.passObject?.onSizeUpdate?.();
  return new Promise(resolve => {
    let remaining = 2;
    const finish = (complete: boolean) => {
      viewer.removeEventListener("postRender", rendered);
      viewer.removeEventListener("dispose", disposed);
      resolve(complete);
    };
    const disposed = () => finish(false);
    const rendered = () => {
      if (!isCurrent()) return finish(false);
      if (viewer.scene.renderCamera !== viewer.scene.activeCamera) return;
      if (--remaining === 0) finish(true);
      else viewer.setDirty();
    };
    viewer.addEventListener("postRender", rendered);
    viewer.addEventListener("dispose", disposed);
    viewer.setDirty();
  });
};
