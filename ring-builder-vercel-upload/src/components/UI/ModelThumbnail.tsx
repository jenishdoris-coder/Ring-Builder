import { useEffect, useRef, useState } from "react";

export const ModelThumbnail = ({ file, kind, label }: { file: string; kind: "head" | "shank"; label: string }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState<{ file: string; url: string }>();
  useEffect(() => {
    let active = true;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      import("../../utils/modelThumbnail").then(module => module.getModelThumbnail(file, kind)).then((url) => {
        if (active) setImage({ file, url });
      }).catch((error) => console.warn("Model thumbnail unavailable", file, error));
    }, { rootMargin: "180px" });
    if (ref.current) observer.observe(ref.current);
    return () => { active = false; observer.disconnect(); };
  }, [file, kind]);
  return <span className="option-model-image" ref={ref}>
    {image?.file === file ? <img src={image.url} alt={label} /> : <span className="model-image-placeholder" aria-hidden="true" />}
  </span>;
};
