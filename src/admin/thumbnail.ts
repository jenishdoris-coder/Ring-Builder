import {renderThumbnail} from '../utils/thumbnailRendering';
import {DEFAULT_APPEARANCE} from '../config/appearance';
import type {ThumbnailChoice} from '../types/appearance';
import {thumbnailFilename} from './thumbnailFiles';
/** Render once in the admin, then upload a static WebP to R2. */
export async function generateThumbnail(file:File,kind:'head'|'shank',choice:ThumbnailChoice=DEFAULT_APPEARANCE.thumbnails,source=file.name):Promise<File>{
 const url=URL.createObjectURL(file);
 try{return new File([await renderThumbnail(url,kind,choice)],thumbnailFilename(source,kind,choice),{type:'image/webp'});}finally{URL.revokeObjectURL(url);}
}
