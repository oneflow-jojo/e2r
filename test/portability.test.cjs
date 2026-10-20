const {test}=require('node:test');const assert=require('node:assert/strict');
const {fs,path,repo,temp,run,readModel}=require('./helpers.cjs');

test('fresh Git clone: only committed source + npm ci can discover and run both frameworks', {timeout:150000},async t=>{
 const parent=await temp(t);const original=path.join(parent,'original');const cloned=path.join(parent,'second computer');
 await fs.mkdir(path.join(original,'e2r'),{recursive:true});
 for(const f of ['scripts','e2e-reporter.mjs','reporter.cjs'])await fs.cp(path.join(repo,f),path.join(original,'e2r',f),{recursive:true});
 for(const f of ['package.json','package-lock.json'])await fs.copyFile(path.join(repo,f),path.join(original,f));
 await fs.writeFile(path.join(original,'.gitignore'),'/node_modules/\n/e2r-report/\n/.e2e/\n/test-results/\n.e2r-tmp-*/\n');
 await fs.mkdir(path.join(original,'tests'));
 await fs.writeFile(path.join(original,'playwright.config.mjs'),`export default {testDir:'./tests',testMatch:'**/*.spec.mjs',reporter:[['./e2r/reporter.cjs']]};`);
 await fs.writeFile(path.join(original,'e2e.config.mts'),`import {e2rReporter} from './e2r/e2e-reporter.mjs';export default {tests:'tests/**/*.e2e.ts',reporters:['list',e2rReporter()],targets:[{name:'api',platform:'web'}]};`);
 await fs.writeFile(path.join(original,'tests','one.spec.mjs'),`import {test,expect} from '@playwright/test';test('portable playwright',()=>expect(1).toBe(1));`);
 await fs.writeFile(path.join(original,'tests','one.e2e.ts'),`import {test,expect} from 'e2e';test('portable e2e',()=>expect(1).toBe(1));`);
 await run(['git','init','--quiet'],original);
 await run(['git','add','.'],original);
 assert.match(await run(['git','ls-files','e2r/'],original),/scripts\/generate-report.js/);
 await run(['git','-c','user.name=e2r-test','-c','user.email=test@example.invalid','commit','--quiet','-m','portable fixture'],original);
 await run(['git','clone','--quiet',original,cloned],parent);
 await fs.rm(original,{recursive:true});
 await run(['npm','ci','--ignore-scripts','--no-audit','--no-fund'],cloned);
 await assert.rejects(fs.stat(path.join(cloned,'e2r/.git')));
 const generator=path.join(cloned,'e2r/scripts/generate-report.js');
 const env={E2E_TELEMETRY_DISABLED:'1'};
 for(const framework of ['e2e','playwright']){
   await run([process.execPath,generator,'--framework',framework,'--catalog-only'],cloned,{env});
   let m=await readModel(cloned);assert.equal(m.catalogComplete,true);assert.equal(m.tests.length,1);assert.equal(m.tests[0].status,'notRun');
   const runner=framework==='e2e'?'node_modules/e2e/dist/bin.js':'node_modules/@playwright/test/cli.js';
   let bin=path.join(cloned,runner);
   if(framework==='e2e') {const pkg=JSON.parse(await fs.readFile(path.join(cloned,'node_modules/e2e/package.json'),'utf8'));bin=path.resolve(cloned,'node_modules/e2e',typeof pkg.bin==='string'?pkg.bin:pkg.bin.e2e);}
   await run([process.execPath,bin,framework==='e2e'?'run':'test'],cloned,{env});
   m=await readModel(cloned);assert.equal(m.tests[0].status,'passed');
   assert.equal(await run(['git','status','--porcelain'],cloned),'');
   assert.match(await run(['git','check-ignore','e2r-report/report.html','e2r-report/report.media/a.webm'],cloned),/report.media/);
 }
});
