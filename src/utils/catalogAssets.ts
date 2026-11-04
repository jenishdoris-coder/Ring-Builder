import thumbnails from '../config/modelThumbnails.json';
import presets from '../config/thumbnailPresets.json';
import type {RingCatalog} from '../types/catalog';

export const catalogModels=(catalog:RingCatalog)=>[
 ...catalog.shanks.map(item=>({file:item.file,kind:'shank' as const,thumbnail:item.thumbnail})),
 ...catalog.shapes.flatMap(shape=>shape.carats.map(head=>({file:head.file,kind:'head' as const,thumbnail:head.thumbnail}))),
];
export function modelAssetUrls(model:{file:string;kind:'head'|'shank';thumbnail?:string}){
 const urls=new Set<string>([model.file]);if(model.thumbnail)urls.add(model.thumbnail);
 let path=model.file;try{path=decodeURIComponent(new URL(path,'https://ring-builder.local').pathname);}catch{}
 const start=path.indexOf('/models/'),stock=(thumbnails.images as Record<string,string>)[`${model.kind}:${start>=0?path.slice(start):path}`];
 if(stock?.includes('/D/'))for(const preset of presets)urls.add(stock.replace('/D/',`/${preset.id}/`));
 return urls;
}
export function pruneCatalogThumbnails(catalog:RingCatalog):RingCatalog{
 const set=catalog.appearance?.thumbnailSet;if(!set)return catalog;
 const keys=new Set(catalogModels(catalog).map(model=>`${model.kind}:${model.file}`));
 return {...catalog,appearance:{...catalog.appearance!,thumbnailSet:{...set,images:Object.fromEntries(Object.entries(set.images).filter(([key])=>keys.has(key)))}}};
}
/** Includes hidden models and every static preset, so shared assets remain protected. */
export function catalogAssetUrls(catalog:RingCatalog){
 const urls=new Set<string>(),models=catalogModels(catalog);
 for(const model of models)for(const url of modelAssetUrls(model))urls.add(url);
 for(const shape of catalog.shapes)urls.add(shape.image||`${catalog.assetBaseUrl.replace(/\/+$/,'')}/images/diamond-shapes/${encodeURIComponent(shape.id)}.webp`);
 const current=pruneCatalogThumbnails(catalog).appearance?.thumbnailSet;
 if(current)for(const url of Object.values(current.images))urls.add(url);
 return urls;
}
