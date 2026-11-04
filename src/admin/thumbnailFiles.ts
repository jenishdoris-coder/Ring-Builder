import { thumbnailSignature } from '../config/appearance';
import type { ThumbnailChoice } from '../types/appearance';

export function thumbnailFilename(source: string, kind: 'head' | 'shank', choice: ThumbnailChoice) {
  let path = source;
  try { path = new URL(source, 'https://ring-builder.local').pathname; } catch { /* Local filenames are valid too. */ }
  try { path = decodeURIComponent(path); } catch { /* Keep malformed filenames readable. */ }
  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
  const name = slug((path.split('/').pop() || 'model').replace(/\.glb$/i, '')).slice(0, 110);
  const style = choice.mode === 'hdr'
    ? `hdr-${choice.environment.id}-${choice.metal}-r${choice.environment.rotation}-i${choice.environment.intensity}`
    : `preset-${choice.preset}`;
  let hash = 2166136261;
  for (const char of `${source}:${kind}:${thumbnailSignature(choice)}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return `${kind}-${name}-${slug(style)}-${hash.toString(16).padStart(8, '0')}.webp`;
}
