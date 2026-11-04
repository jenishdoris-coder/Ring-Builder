import thumbnails from "../../config/modelThumbnails.json";
import { assetUrl } from "../../config/assets";
import {useAppearance} from './AppearanceContext';
import {modelThumbnailKey,thumbnailSignature} from '../../config/appearance';

const images: Record<string, string> = thumbnails.images;

export const ModelThumbnail = ({ file, kind, label, thumbnail }: { file: string; kind: "head" | "shank"; label: string; thumbnail?: string }) => {
  const appearance=useAppearance();
  // Catalog URLs include an R2 release prefix; the original model path stays stable.
  let pathname = file;
  try { pathname = new URL(file, "https://ring-builder.local").pathname; } catch { /* A missing thumbnail must not crash the configurator. */ }
  try { pathname = decodeURIComponent(pathname); } catch { /* Preserve malformed percent signs in uploaded filenames. */ }
  const start = pathname.indexOf("/models/");
  const path = images[`${kind}:${start >= 0 ? pathname.slice(start) : pathname}`];
  const generated=appearance.thumbnailSet?.signature===thumbnailSignature(appearance.thumbnails)?appearance.thumbnailSet.images[modelThumbnailKey(file,kind)]:undefined;
  const stock=path && appearance.thumbnails.mode==='preset'?path.replace('/D/',`/${appearance.thumbnails.preset}/`):path;
  const url = generated || thumbnail || (stock && (import.meta.env.DEV ? stock : assetUrl(stock)));
  return <span className="option-model-image">
    {url ? <img src={url} alt={label} loading="lazy" decoding="async" width={thumbnails.width} height={thumbnails.height} /> : <span className="model-image-placeholder" aria-hidden="true" />}
  </span>;
};
