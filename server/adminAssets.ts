import {createHash} from 'node:crypto';
import {DeleteObjectsCommand,S3Client} from '@aws-sdk/client-s3';
import type {RingCatalog} from '../src/types/catalog.js';
import {catalogAssetUrls,catalogModels,modelAssetUrls} from '../src/utils/catalogAssets.js';
import {database} from './db.js';

export const deletionId=(url:string)=>createHash('sha256').update(url).digest('hex');
export function cloudObjectKey(url:string){
 const base=process.env.CLOUDFLARE_R2_PUBLIC_URL?.replace(/\/+$/,'');
 if(!base||!url.startsWith(`${base}/ring-builder/`))return undefined;
 try{const parsed=new URL(url),key=decodeURIComponent(url.slice(base.length+1));return parsed.protocol==='https:'&&!parsed.search&&!parsed.hash&&!key.split('/').some(part=>part==='.'||part==='..')?key:undefined;}catch{return undefined;}
}
export function removedCatalogAssets(before:RingCatalog,after:RingCatalog,associated:{url:string}[]=[]){
 const retained=catalogAssetUrls(after),prior=new Set<string>(),models=new Set(catalogModels(after).map(model=>`${model.kind}:${model.file}`));
 // A lighting/style switch keeps its cached thumbnails. Only removed models/shapes trigger cleanup.
 for(const model of catalogModels(before))if(!models.has(`${model.kind}:${model.file}`)){
  for(const url of modelAssetUrls(model))prior.add(url);
  const thumbnail=before.appearance?.thumbnailSet?.images[`${model.kind}:${model.file}`];if(thumbnail)prior.add(thumbnail);
 }
 for(const shape of before.shapes)if(!after.shapes.some(item=>item.id===shape.id))prior.add(shape.image||`${before.assetBaseUrl.replace(/\/+$/,'')}/images/diamond-shapes/${encodeURIComponent(shape.id)}.webp`);
 for(const asset of associated)prior.add(asset.url);
 return [...prior].filter(url=>!retained.has(url)).flatMap(url=>{const key=cloudObjectKey(url);return key?[{url,key}]:[];});
}
export async function pendingAssetCleanup(){return (await database()).collection('ring_builder_asset_deletions').countDocuments({status:{$in:['pending','deleting']}});}

/** Deletion is idempotent and retryable; a storage failure never rolls back an already published catalog. */
export async function processAssetCleanup(){
 const db=await database(),queue=db.collection<any>('ring_builder_asset_deletions');
 const records=await queue.find({status:{$in:['pending','deleting']}}).sort({createdAt:1}).limit(1000).toArray();
 if(!records.length)return {deleted:0,pending:0};
 const ids=records.map(record=>record._id);let deleted=0;
 let r2:S3Client|undefined;
 try{
  if(!process.env.CLOUDFLARE_ACCOUNT_ID||!process.env.CLOUDFLARE_ACCESS_KEY_ID||!process.env.CLOUDFLARE_SECRET_ACCESS_KEY||!process.env.CLOUDFLARE_BUCKET_NAME)throw new Error('CloudflareNotConfigured');
  await queue.updateMany({_id:{$in:ids}},{$set:{status:'deleting',updatedAt:new Date()}});
  r2=new S3Client({region:'auto',endpoint:`https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,credentials:{accessKeyId:process.env.CLOUDFLARE_ACCESS_KEY_ID,secretAccessKey:process.env.CLOUDFLARE_SECRET_ACCESS_KEY},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
  const response=await r2.send(new DeleteObjectsCommand({Bucket:process.env.CLOUDFLARE_BUCKET_NAME,Delete:{Quiet:true,Objects:records.map(record=>({Key:record.key}))}}),{abortSignal:AbortSignal.timeout(10000)});
  const errors=new Set(response.Errors?.map(error=>error.Key)),completed=records.filter(record=>!errors.has(record.key)),urls=completed.map(record=>record.url);
  if(completed.length){
   await Promise.all([db.collection('ring_builder_assets').deleteMany({url:{$in:urls}}),db.collection('ring_builder_admin_uploads').deleteMany({url:{$in:urls}})]);
   await queue.updateMany({_id:{$in:completed.map(record=>record._id)}},{$set:{status:'deleted',updatedAt:new Date()}});deleted=completed.length;
  }
  if(errors.size)await queue.updateMany({_id:{$in:records.filter(record=>errors.has(record.key)).map(record=>record._id)}},{$set:{status:'pending',updatedAt:new Date()}});
 }catch(error){
  console.warn('Cloudflare asset cleanup pending',error instanceof Error?error.name:'UnknownError');
  await queue.updateMany({_id:{$in:ids},status:{$ne:'deleted'}},{$set:{status:'pending',updatedAt:new Date()}});
 }finally{r2?.destroy();}
 return {deleted,pending:await pendingAssetCleanup()};
}
