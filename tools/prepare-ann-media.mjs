import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {readFile,mkdir,copyFile,rename,unlink,open} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {createInflateRaw} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const resources=path.join(root,'packages/ann-studio/src-tauri/resources');
const manifest=JSON.parse(await readFile(path.join(resources,'media-tools-manifest.json'),'utf8'));
const destination=path.join(resources,'media-tools');
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function ready(){try{return await digest(path.join(destination,'ffmpeg.exe'))===manifest.binarySha256 && (await readFile(path.join(destination,'LICENSE'))).length>0 && (await readFile(path.join(destination,'README.txt'))).length>0;}catch{return false;}}
if(await ready()){console.log('Pinned media toolchain verified');process.exit(0);}
if(process.argv.includes('--check'))throw new Error('Bundled media toolchain missing or hash mismatch; run node tools/prepare-ann-media.mjs before packaging');
if(process.platform!=='win32')throw new Error('Windows x64 media-tool preparation requires Windows');
await mkdir(destination,{recursive:true});
const cache=path.join(resources,'.media-cache');await mkdir(cache,{recursive:true});
const archive=path.join(cache,manifest.archiveSha256+'.zip');
const supplied=process.argv.indexOf('--archive');
if(supplied>=0){if(!process.argv[supplied+1])throw new Error('--archive requires a local ZIP path');await copyFile(path.resolve(process.argv[supplied+1]),archive);}
else {
  let valid=false;try{valid=await digest(archive)===manifest.archiveSha256;}catch{}
  if(!valid){const temporary=archive+'.part';try{const response=await fetch(manifest.archiveUrl,{signal:AbortSignal.timeout(300000)});if(!response.ok||!response.body)throw new Error('Pinned media download failed: '+response.status);await pipeline(Readable.fromWeb(response.body),createWriteStream(temporary,{flags:'w'}));if(await digest(temporary)!==manifest.archiveSha256)throw new Error('Media archive hash mismatch');await rename(temporary,archive);}finally{await unlink(temporary).catch(()=>{});}}
}
if(await digest(archive)!==manifest.archiveSha256)throw new Error('Media archive hash mismatch');
// Narrow ZIP reader for the SHA-256-pinned vendor archive; extracts only named files.
const input=await open(archive,'r');
async function bytes(offset,length){const b=Buffer.alloc(length);const result=await input.read(b,0,length,offset);if(result.bytesRead!==length)throw new Error('Truncated pinned archive');return b;}
try {
 const size=(await input.stat()).size, end=await bytes(size-22,22);
 if(end.readUInt32LE(0)!==0x06054b50||end.readUInt16LE(20)!==0)throw new Error('Unsupported pinned ZIP end record');
 let offset=end.readUInt32LE(16);const count=end.readUInt16LE(10), found=new Set();
 const wanted=new Map([[manifest.binaryEntry,'ffmpeg.exe'],[manifest.licenseEntry,'LICENSE'],[manifest.readmeEntry,'README.txt']]);
 for(let i=0;i<count;i++){
  const h=await bytes(offset,46);if(h.readUInt32LE(0)!==0x02014b50)throw new Error('Invalid pinned ZIP directory');
  const nameLength=h.readUInt16LE(28),extraLength=h.readUInt16LE(30),commentLength=h.readUInt16LE(32);
  const name=(await bytes(offset+46,nameLength)).toString('utf8');offset+=46+nameLength+extraLength+commentLength;
  if(!wanted.has(name))continue;if(found.has(name))throw new Error('Duplicate pinned entry');found.add(name);
  const localOffset=h.readUInt32LE(42),local=await bytes(localOffset,30),method=h.readUInt16LE(10),compressed=h.readUInt32LE(20);
  if(local.readUInt32LE(0)!==0x04034b50||!compressed||![0,8].includes(method))throw new Error('Unsupported pinned ZIP entry');
  const start=localOffset+30+local.readUInt16LE(26)+local.readUInt16LE(28),target=path.join(destination,wanted.get(name)),temporary=target+'.tmp';
  try{const source=createReadStream(archive,{start,end:start+compressed-1});if(method===8)await pipeline(source,createInflateRaw(),createWriteStream(temporary));else await pipeline(source,createWriteStream(temporary));await rename(temporary,target);}finally{await unlink(temporary).catch(()=>{});}
 }
 if(found.size!==wanted.size)throw new Error('Missing pinned media/license entry');
} finally {await input.close();}
if(!await ready())throw new Error('Extracted media toolchain failed verification');
await copyFile(path.join(resources,'media-tools-manifest.json'),path.join(destination,'provenance.json'));
console.log('Pinned ffmpeg, LICENSE and README prepared for bundling');
