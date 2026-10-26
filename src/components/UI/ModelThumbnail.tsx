import thumbnails from "../../config/modelThumbnails.json";
import { assetUrl } from "../../config/assets";

const images: Record<string, string> = thumbnails.images;

export const ModelThumbnail = ({ file, kind, label }: { file: string; kind: "head" | "shank"; label: string }) => {
  // Catalog URLs include an R2 release prefix; the original model path stays stable.
  const pathname = decodeURIComponent(new URL(file, "https://ring-builder.local").pathname);
  const start = pathname.indexOf("/models/");
  const path = images[`${kind}:${start >= 0 ? pathname.slice(start) : pathname}`];
  const url = path && (import.meta.env.DEV ? path : assetUrl(path));
  return <span className="option-model-image">
    {url ? <img src={url} alt={label} loading="lazy" decoding="async" width={thumbnails.width} height={thumbnails.height} /> : <span className="model-image-placeholder" aria-hidden="true" />}
  </span>;
};
