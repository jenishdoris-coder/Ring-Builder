import type { ThumbnailChoice } from '../types/appearance';
import { modelThumbnailKey, thumbnailSignature } from '../config/appearance';

export type ThumbnailModel = { file: string; kind: 'head' | 'shank'; label: string };
export type ThumbnailCheckpoint = { id: string; filename: string; blob?: Blob; uploadKey: string; url?: string };
export interface ThumbnailCache {
  get(id: string): Promise<ThumbnailCheckpoint | undefined>;
  put(record: ThumbnailCheckpoint): Promise<void>;
}
export type ThumbnailProgress = { phase: 'render' | 'upload'; completed: number; total: number; label: string };
// Increment when the rendering pipeline changes, so older renders cannot be reused accidentally.
const renderVersion = 'collection-v4';
export const thumbnailCheckpointId = (scope: string, choice: ThumbnailChoice, model: ThumbnailModel) =>
  JSON.stringify([renderVersion, scope, thumbnailSignature(choice), model.kind, model.file]);
const stopped = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('Generation paused', 'AbortError'); };

export async function thumbnailJobProgress(models: ThumbnailModel[], scope: string, choice: ThumbnailChoice, cache: ThumbnailCache) {
  const records = await Promise.all(models.map(model => cache.get(thumbnailCheckpointId(scope, choice, model))));
  return { rendered: records.filter(record => record?.blob || record?.url).length, uploaded: records.filter(record => record?.url).length, total: models.length };
}

/** Render/checkpoint the whole set first. Uploads and catalog application follow only when it is complete. */
export async function runThumbnailCollection(options: {
  models: ThumbnailModel[]; scope: string; choice: ThumbnailChoice; cache: ThumbnailCache; signal: AbortSignal;
  stock: (model: ThumbnailModel) => string | undefined;
  render: (model: ThumbnailModel) => Promise<File>;
  upload: (file: File, key: string, model:ThumbnailModel) => Promise<{ url: string }>;
  progress: (value: ThumbnailProgress) => void;
}) {
  const { models, scope, choice, cache, signal, stock, render, upload, progress } = options;
  const images: Record<string, string> = {}, records: { model: ThumbnailModel; record: ThumbnailCheckpoint }[] = [];
  for (let index = 0; index < models.length; index++) {
    stopped(signal);
    const model = models[index], saved = stock(model);
    if (saved) images[modelThumbnailKey(model.file, model.kind)] = saved;
    else {
      const id = thumbnailCheckpointId(scope, choice, model);
      let record = await cache.get(id);
      if (!record?.blob && !record?.url) {
        const file = await render(model);
        record = { id, filename: file.name, blob: file, uploadKey: `${Date.now()}-${Math.random().toString(36).slice(2)}:${id}` };
        // Finish checkpointing this render even when Pause was clicked while it was rendering.
        await cache.put(record);
      }
      records.push({ model, record: record! });
    }
    progress({ phase: 'render', completed: index + 1, total: models.length, label: model.label });
  }
  stopped(signal);
  for (let index = 0; index < records.length; index++) {
    stopped(signal);
    const { model, record } = records[index];
    if (!record.url) {
      const result = await upload(new File([record.blob!], record.filename, { type: 'image/webp' }), record.uploadKey,model);
      record.url = result.url;
      // Keeping the URL prevents duplicate uploads when a run is paused or reloaded.
      await cache.put({ ...record, blob: undefined });
    }
    images[modelThumbnailKey(model.file, model.kind)] = record.url;
    progress({ phase: 'upload', completed: index + 1, total: records.length, label: model.label });
  }
  stopped(signal);
  return images;
}
