import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
process.on('uncaughtException',error=>{console.error((error.stack||error.message).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'[compiled test module]').slice(0,4000));process.exitCode=1;});
const compiled=new Map();
async function moduleUrl(path){
 const url=new URL(path,import.meta.url),key=url.href;if(compiled.has(key))return compiled.get(key);
 let output;
 if(url.pathname.endsWith('/server/db.ts'))output='export const database=async()=>globalThis.__adminDb;export const mongoClient=async()=>globalThis.__adminClient;';
 else {
  const source=await readFile(url,'utf8');
  output=url.pathname.endsWith('.json')?'export default '+source:ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  if(url.pathname.endsWith('/server/adminUploads.ts')||url.pathname.endsWith('/server/adminAssets.ts')){
   const stub='data:text/javascript;base64,'+Buffer.from(`export class S3Client {async send(command){return globalThis.__fakeS3(command);}destroy(){}};export class DeleteObjectsCommand{constructor(input){this.input=input;this.kind='delete';}};export class PutObjectCommand{constructor(input){this.input=input;this.kind='put';}};export class HeadObjectCommand{constructor(input){this.input=input;this.kind='head';}};export class GetObjectCommand{constructor(input){this.input=input;this.kind='get';}};export const getSignedUrl=async()=> 'https://upload.example.test/signed';`).toString('base64');
   output=output.replace(/(["'])@aws-sdk\/client-s3\1/g,JSON.stringify(stub)).replace(/(["'])@aws-sdk\/s3-request-presigner\1/g,JSON.stringify(stub));
  }
  for(const match of [...output.matchAll(/from\s+["'](\.[^"']+)["']/g)]){
   const spec=match[1],dep=new URL(spec.endsWith('.json')?spec:spec.endsWith('.js')?spec.slice(0,-3)+'.ts':spec+'.ts',url);
   output=output.replace(match[0],'from '+JSON.stringify(await moduleUrl(dep.href)));
  }
 }
 const result='data:text/javascript;base64,'+Buffer.from(output).toString('base64');compiled.set(key,result);return result;
}
const load=async path=>import(await moduleUrl(path));
const {runThumbnailCollection,thumbnailJobProgress}=await load('../src/admin/thumbnailJobs.ts');
const {thumbnailFilename}=await load('../src/admin/thumbnailFiles.ts');
const {DEFAULT_APPEARANCE}=await load('../src/config/appearance.ts');
const choice={...DEFAULT_APPEARANCE.thumbnails,mode:'hdr',metal:'gold',environment:{id:'metal-env-8',rotation:45,intensity:1.05}};
const models=Array.from({length:103},(_,i)=>({file:'https://example.com/models/band-'+i+'.glb',kind:'shank',label:'Band '+i}));
const memory=new Map(),cache={get:async id=>structuredClone(memory.get(id)),put:async record=>{memory.set(record.id,structuredClone(record));}};
let renders=0,uploads=0,uploadKeys=new Set();
let controller=new AbortController();
const options={models,scope:'test-store',choice,cache,stock:()=>undefined,
 render:async model=>{renders++;return new File(['rendered '+model.file],thumbnailFilename(model.file,model.kind,choice),{type:'image/webp'});},
 upload:async(file,key)=>{assert.equal(renders,103,'uploads begin only after every render is complete');assert.ok(!uploadKeys.has(key),'completed uploads are not repeated');uploadKeys.add(key);uploads++;return {url:'https://example.com/images/'+file.name};},
 progress:value=>{if(value.phase==='render'&&value.completed===50)controller.abort();}
};
await assert.rejects(()=>runThumbnailCollection({...options,signal:controller.signal}),e=>e.name==='AbortError');
assert.equal(renders,50);assert.equal(uploads,0);
assert.deepEqual(await thumbnailJobProgress(models,'test-store',choice,cache),{rendered:50,uploaded:0,total:103});
controller=new AbortController();
await assert.rejects(()=>runThumbnailCollection({...options,signal:controller.signal,progress:value=>{if(value.phase==='upload'&&value.completed===50)controller.abort();}}),e=>e.name==='AbortError');
assert.equal(renders,103);assert.equal(uploads,50);
const images=await runThumbnailCollection({...options,signal:new AbortController().signal,progress:()=>{}});
assert.equal(renders,103,'resume never rerenders a completed image');assert.equal(uploads,103);assert.equal(Object.keys(images).length,103);
await runThumbnailCollection({...options,signal:new AbortController().signal,progress:()=>{}});
assert.equal(renders,103);assert.equal(uploads,103,'applying the completed set has no uploads');
const otherChoice={...choice,metal:'rose'};
assert.equal((await thumbnailJobProgress(models,'test-store',otherChoice,cache)).rendered,0,'different settings have separate checkpoints');
const filename=thumbnailFilename('https://example.com/models/4%20PRONG%20ROUND%202CT.glb','head',choice);
assert.match(filename,/head-4-prong-round-2ct-hdr-metal-env-8-gold-r45-i1.05-/);assert.ok(filename.length<240);
assert.notEqual(filename,thumbnailFilename('https://example.com/models/4%20PRONG%20ROUND%203CT.glb','head',choice));
assert.notEqual(filename,thumbnailFilename('https://example.com/models/4%20PRONG%20ROUND%202CT.glb','head',otherChoice));
console.log('Thumbnail checks passed: pause at 50/103, deferred uploads, upload resume, cache isolation, descriptive filenames.');

const tables=new Map();
const table=name=>{if(!tables.has(name))tables.set(name,new Map());return tables.get(name);};
const match=(value,filter)=>Object.entries(filter).every(([key,v])=>v&&typeof v==='object'?('$gt'in v?value[key]>v.$gt:'$in'in v?v.$in.includes(value[key]):'$ne'in v?value[key]!==v.$ne:value[key]===v):value[key]===v);
let failSettings=false;
globalThis.__adminDb={collection:name=>({
 findOne:async filter=>structuredClone([...table(name).values()].find(row=>match(row,filter))),
 find:(filter={})=>{let max=Infinity;return {sort(){return this;},limit(n){max=n;return this;},toArray:async()=>structuredClone([...table(name).values()].filter(row=>match(row,filter)).slice(0,max))};},
 countDocuments:async(filter={})=>[...table(name).values()].filter(row=>match(row,filter)).length,
 deleteMany:async filter=>{for(const [id,row]of table(name))if(match(row,filter))table(name).delete(id);},
 updateMany:async(filter,update)=>{for(const [id,row]of table(name))if(match(row,filter))table(name).set(id,structuredClone({...row,...update.$set}));},
 bulkWrite:async operations=>{for(const {updateOne:op}of operations){const old=table(name).get(op.filter._id);table(name).set(op.filter._id,structuredClone({...op.filter,...(!old?op.update.$setOnInsert:old),...op.update.$set}));}},
 aggregate:()=>({toArray:async()=>[{count:0,bytes:0}]}),
 insertOne:async doc=>{assert.ok(!table(name).has(doc._id));table(name).set(doc._id,structuredClone(doc));},
 updateOne:async(filter,update,options)=>{const previous=[...table(name).values()].find(row=>match(row,filter));if(!previous&&!options?.upsert)return {matchedCount:0};const row={...(previous??{...filter,...update.$setOnInsert}),...update.$set};table(name).set(row._id,structuredClone(row));return {matchedCount:previous?1:0};},
 replaceOne:async(filter,doc)=>{if(failSettings&&name==='ring_builder_admin_catalogs')throw Error('Simulated write failure');table(name).set(filter._id,structuredClone({_id:filter._id,...doc}));}
})};
globalThis.__adminClient={startSession:()=>({withTransaction:async fn=>{const before=structuredClone(tables);try{return await fn();}catch(error){tables.clear();for(const [name,rows]of before)tables.set(name,rows);throw error;}},endSession:async()=>{}})};
const source=JSON.parse(await readFile(new URL('../src/config/catalog.json',import.meta.url),'utf8'));
const prefix='https://example.com/ring-builder/releases/test/';
const catalog={...source,schemaVersion:1,releaseId:'test',assetBaseUrl:prefix.slice(0,-1),shapes:source.shapes.map(shape=>({...shape,carats:shape.carats.map(head=>({...head,file:prefix+head.file.slice(1)}))})),shanks:source.shanks.map(band=>({...band,file:prefix+band.file.slice(1)}))};
const hidden=catalog.shanks.find(item=>item.id!==catalog.defaults.shankId);hidden.enabled=false;
table('ring_builder_catalogs').set('active',{_id:'active',...structuredClone(catalog),updatedAt:new Date()});
table('ring_builder_admin_drafts').set('store',{_id:'store',catalog:structuredClone(catalog),baseReleaseId:'test',revision:7,dirty:true});
const {publishCatalog,adminState}=await load('../server/adminStore.ts');
const initial=await adminState();assert.equal(initial.catalog.shanks.length,catalog.shanks.length);assert.equal(initial.hasUnpublishedChanges,true);
catalog.shanks.find(item=>item.id===catalog.defaults.shankId).name='Edited without a save step';
const result=await publishCatalog(catalog,7,'test','admin-test');
assert.equal(result.catalog.shanks.find(item=>item.id===catalog.defaults.shankId).name,'Edited without a save step');
assert.equal(result.catalog.shanks.find(item=>item.id===hidden.id).enabled,false,'hidden models stay available to the admin');
assert.ok(!result.active.shanks.some(item=>item.id===hidden.id),'hidden models stay out of the storefront');
assert.equal(result.revision,8);assert.equal(result.hasUnpublishedChanges,false);
assert.equal(table('ring_builder_admin_drafts').get('store').revision,7,'legacy data is preserved');
const before=JSON.stringify([...tables]);
await assert.rejects(()=>publishCatalog(catalog,7,'test','admin-test'),e=>e.status===409);assert.equal(JSON.stringify([...tables]),before);
const invalid=structuredClone(result.catalog);invalid.shanks[0].file='https://untrusted.test/unsafe.glb';
await assert.rejects(()=>publishCatalog(invalid,8,result.baseReleaseId,'admin-test'),e=>e.status===400);assert.equal(JSON.stringify([...tables]),before);
failSettings=true;
await assert.rejects(()=>publishCatalog(result.catalog,8,result.baseReleaseId,'admin-test'),/Simulated write failure/);
assert.equal(JSON.stringify([...tables]),before,'failed publishing rolls back the live catalog and release snapshot');
console.log('Publish checks passed: direct edits, old-data preservation, hidden models, stale-window rejection, validation and transaction rollback. No live database writes.');

for(const key of ['CLOUDFLARE_ACCOUNT_ID','CLOUDFLARE_ACCESS_KEY_ID','CLOUDFLARE_SECRET_ACCESS_KEY','CLOUDFLARE_BUCKET_NAME'])process.env[key]='test-only';
process.env.CLOUDFLARE_R2_PUBLIC_URL='https://example.com';
const imageHeader=Buffer.alloc(24);imageHeader.write('RIFF',0);imageHeader.write('WEBP',8);
globalThis.__fakeS3=async command=>command.kind==='head'?{ContentLength:24,ContentType:'image/webp'}:{Body:{transformToByteArray:async()=>imageHeader}};
const {beginUpload,finishUpload}=await load('../server/adminUploads.ts');
const uploadInput={filename:'shank-bypass-hdr-metal-env-8-gold.webp',bytes:24,kind:'image',idempotencyKey:'same-render-checkpoint'};
const firstTicket=await beginUpload(uploadInput,'admin-test'),retryTicket=await beginUpload(uploadInput,'admin-test');
assert.equal(firstTicket.id,retryTicket.id,'a retry reuses the same R2 upload object');
assert.equal(table('ring_builder_admin_uploads').size,1);
const finished=await finishUpload(firstTicket.id,'admin-test'),completedRetry=await beginUpload(uploadInput,'admin-test');
assert.deepEqual(completedRetry.asset,{url:finished.url,filename:uploadInput.filename});
assert.equal(table('ring_builder_assets').size,1,'retries produce one asset record');
await assert.rejects(()=>beginUpload({...uploadInput,bytes:25},'admin-test'),e=>e.status===409);
console.log('Upload checks passed: interrupted/retried uploads reuse their object and completed asset. No Cloudflare requests.');

failSettings=false;
const {removedCatalogAssets,processAssetCleanup}=await load('../server/adminAssets.ts');
const {deleteCatalogItem}=await load('../src/admin/deletion.ts');
const retained=result.catalog.shanks.find(band=>band.id!==hidden.id);
const shared=structuredClone(result.catalog);shared.shanks.push({...hidden,id:'shared-copy',file:retained.file});
const sharedAfter=structuredClone(shared);sharedAfter.shanks=sharedAfter.shanks.filter(band=>band.id!=='shared-copy');
assert.equal(removedCatalogAssets(shared,sharedAfter).length,0,'shared model files are retained');
const newLighting=structuredClone(result.catalog);newLighting.appearance={...structuredClone(DEFAULT_APPEARANCE),thumbnailSet:{signature:'another-look',images:{['shank:'+retained.file]:'https://example.com/ring-builder/admin/cached-style.webp'}}};
assert.equal(removedCatalogAssets(result.catalog,newLighting).length,0,'changing lighting never deletes resumable thumbnail sets');
const oldBand=result.catalog.shanks.find(band=>band.id===hidden.id),thumb='https://example.com/ring-builder/admin/fixture/thumb.webp',variant='https://example.com/ring-builder/admin/fixture/variant.webp';
result.catalog.appearance={...structuredClone(DEFAULT_APPEARANCE),thumbnailSet:{signature:'fixture',images:{['shank:'+oldBand.file]:thumb}}};
table('ring_builder_admin_catalogs').get('store').catalog=structuredClone(result.catalog);
for(const [i,url]of [oldBand.file,thumb,variant].entries())table('ring_builder_assets').set('deletion-fixture-'+i,{_id:'deletion-fixture-'+i,url,...(i?{modelFile:oldBand.file}:{})});
let storageFails=true,deletedKeys=[];
globalThis.__fakeS3=async command=>{assert.equal(command.kind,'delete');if(storageFails)throw Error('Simulated R2 outage');deletedKeys.push(...command.input.Delete.Objects.map(item=>item.Key));return {Errors:[]};};
const removal=deleteCatalogItem(result.catalog,{kind:'band',id:oldBand.id});
assert.ok(!removal.catalog.appearance.thumbnailSet.images['shank:'+oldBand.file],'removed model thumbnail mappings are pruned');
const publishedRemoval=await publishCatalog(removal.catalog,result.revision,result.baseReleaseId,'admin-test');
assert.equal(publishedRemoval.cleanup.pending,3,'failed storage deletion remains retryable after publishing');
assert.ok(!publishedRemoval.catalog.shanks.some(band=>band.id===oldBand.id));
storageFails=false;const cleanup=await processAssetCleanup();assert.deepEqual(cleanup,{deleted:3,pending:0});assert.equal(new Set(deletedKeys).size,3);
assert.ok(![...table('ring_builder_assets').values()].some(asset=>[oldBand.file,thumb,variant].includes(asset.url)));
const reintroduced=structuredClone(publishedRemoval.catalog);reintroduced.shanks.push(oldBand);
await assert.rejects(()=>publishCatalog(reintroduced,publishedRemoval.revision,publishedRemoval.baseReleaseId,'admin-test'),error=>error.status===409);
await assert.rejects(()=>beginUpload({...uploadInput,modelFile:oldBand.file},'admin-test'),error=>error.status===409);
console.log('Deletion checks passed: shared files retained, model/thumbnail variants removed, failed cleanup retried, and deleted files cannot be republished. No real storage files deleted.');
