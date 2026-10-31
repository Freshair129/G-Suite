import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cwd=path.join(root,'packages/ann-studio/src');
for(const [script,args] of [['typescript/bin/tsc',['--noEmit']],['vite/bin/vite.js',['build']]]){
 const result=spawnSync(process.execPath,[path.join(cwd,'node_modules',script),...args],{cwd,stdio:'inherit',windowsHide:true,timeout:300000});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status||1);
}
