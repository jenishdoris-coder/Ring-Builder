import thumbnails from '../config/modelThumbnails.json';
import {assetUrl} from '../config/assets';
export function stockThumbnailUrl(file:string,kind:'head'|'shank',preset='D'){
 let pathname=file;try{pathname=new URL(file,'https://ring-builder.local').pathname;}catch{}
 try{pathname=decodeURIComponent(pathname);}catch{}
 const start=pathname.indexOf('/models/');const path=(thumbnails.images as Record<string,string>)[`${kind}:${start>=0?pathname.slice(start):pathname}`];
 return path?.includes('/D/')?assetUrl(path.replace('/D/',`/${preset}/`)):undefined;
}
