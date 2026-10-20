const {test}=require('node:test');const assert=require('node:assert/strict');
const {fs,path,repo,temp,run,consumer,readModel,browser,pathToFileURL}=require('./helpers.cjs');
const {generateReport}=require('../scripts/generate-report.js');
const cli=path.join(repo,'scripts/generate-report.js');

test('portable report: real video playback, escaped titles, copy fallback, owned cleanup and errors', {timeout:60000}, async t=>{
 const root=await temp(t);
 const title='登录 </script> & "安全"';
 const png=path.join(repo,'demo/test-results/login-flow-chromium/screenshot.png');
 const video=path.join(repo,'demo/test-results/login-flow-chromium/video.webm');
 const media=[{kind:'screenshot',path:png,mediaType:'image/png'},{kind:'video',path:video,mediaType:'video/webm'},
 {kind:'video',path:video,mediaType:'video/webm'}, {kind:'screenshot',path:'gone.png',mediaType:'image/png'},
 {kind:'video',url:'https://example.com/remote.mp4',mediaType:'video/mp4'}];
 const report={schemaVersion:'report-1',run:{id:'this-run',status:'passed',startedAt:'2026-10-20T10:00:00Z',finishedAt:'2026-10-20T10:00:02Z',
 results:[{id:'t1',file:'tests/login.ts',source:{file:'tests/login.ts',line:12},titlePath:[title],targetId:'web',selected:true,status:'passed',attempts:[{index:0,status:'passed',durationMs:2000,artifacts:media}]}],errors:[]}};
 const result=await generateReport({projectRoot:root,framework:'e2e',report,resultsDir:root});
 assert.equal(result.model.catalogComplete,false);assert.equal(result.model.tests[0].attempts[0].media[3].availability,'missing');
 const assets=path.join(root,'e2r-report/report.media');const files=await fs.readdir(assets);
 assert.equal(files.filter(f=>f.endsWith('.webm')).length,1);
 await fs.writeFile(path.join(assets,'user-notes.txt'),'keep me');
 const moved=path.join(root,'moved');await fs.cp(path.join(root,'e2r-report'),moved,{recursive:true});
 // Remove original files as a stronger check that the exported report is independent.
 await fs.rm(path.join(root,'e2r-report'),{recursive:true});
 const b=await browser(t);const page=await b.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('denied')}}}));
 await page.goto(pathToFileURL(path.join(moved,'report.html')).href);
 assert.equal(await page.locator('.test-title').textContent(),title);
 assert.equal(await page.locator('video').count(),0);
 await page.locator('.test-toggle').click();
 await page.locator('video').first().evaluate(async v=>{v.muted=true;await v.play()});
 await page.waitForFunction(()=>document.querySelector('video').currentTime>0.15);
 await page.locator('[data-copy]').click();
 assert.equal(await page.locator('#copy-modal').evaluate(x=>x.open),true);
 assert.match(await page.locator('#copy-text').inputValue(),/tests\/login.ts:12/);
 assert.match(await page.locator('#copy-text').inputValue(),/this-run/);
 await page.locator('[data-close="copy-modal"]').click();
 await page.locator('[data-tab="screenshot"]').click();
 await page.locator('.media-preview').evaluate(i=>i.decode());await page.locator('.media-preview').click();
 assert.equal(await page.locator('#image-modal').evaluate(x=>x.open),true);
 await page.locator('[data-close="image-modal"]').click();
 await page.locator('#search').fill('does not exist');assert.equal(await page.locator('.test-item').count(),0);
 await page.locator('#search').fill('');assert.equal(await page.locator('.test-item').count(),1);
 assert.deepEqual(errors,[]);
 // Publish again with no media: remove owned files, retain unrelated files.
 await fs.cp(moved,path.join(root,'e2r-report'),{recursive:true});report.run.results[0].attempts[0].artifacts=[];
 await generateReport({projectRoot:root,framework:'e2e',report,resultsDir:root});
 assert.deepEqual((await fs.readdir(assets)).sort(),['.e2r-manifest.json','user-notes.txt']);
 const html=await fs.readFile(result.output,'utf8');
 assert(!html.includes('data:video/'));assert(!html.includes('data:image/'));
 await assert.rejects(generateReport({framework:'e2e',projectRoot:root,report:{schemaVersion:'wrong'}}));
 assert.equal(await fs.readFile(result.output,'utf8'),html);
 await assert.rejects(generateReport({framework:'e2e',projectRoot:root,catalogOnly:true}));
 await fs.writeFile(path.join(root,'blocked'),'not a directory');
 await assert.rejects(generateReport({projectRoot:root,framework:'e2e',report,resultsDir:root,output:'blocked/report.html'}));
 assert.equal(await fs.readFile(result.output,'utf8'),html);
});

test('Playwright: discovery, native reporter without JSON, filtered runs, rename and nested cwd', {timeout:120000}, async t=>{
 const root=await consumer(t);
 await fs.writeFile(path.join(root,'playwright.config.ts'),`export default {testDir:'./tests',workers:1,retries:1,reporter:[['./e2r/reporter.cjs']],use:{video:'on',screenshot:'on'},projects:[{name:'chromium',use:{browserName:'chromium'}},{name:'second',use:{browserName:'chromium'}}]};`);
 const source=`import {test,expect} from '@playwright/test';import fs from 'node:fs';
 test.describe('account',()=>{
 test('login',async({page})=>{fs.writeFileSync('test-body-ran','yes');await page.setContent('<h1>Login</h1>');await page.waitForTimeout(400)});
 test('retry',async({},info)=>{expect(info.retry).toBe(1)});
 test('expected failure',async()=>{test.fail();expect(1).toBe(2)});
 test.skip('skip',async()=>{});
 });`;
 await fs.writeFile(path.join(root,'tests','account.spec.ts'),source);
 await run([process.execPath,cli,'--framework','playwright','--catalog-only'],root);
 let m=await readModel(root);assert.equal(m.catalogComplete,true);assert.equal(m.tests.length,8);assert(m.tests.every(t=>t.status==='notRun'));
 await assert.rejects(fs.stat(path.join(root,'test-body-ran')));
 const pw=path.join(repo,'node_modules/@playwright/test/cli.js');
 await run([process.execPath,pw,'test','--project=chromium'],root);
 m=await readModel(root);assert.equal(m.tests.length,8);assert.equal(m.tests.find(t=>t.title==='retry'&&t.target==='chromium').status,'flaky');
 assert.equal(m.tests.find(t=>t.title==='expected failure'&&t.target==='chromium').status,'passed');
 assert(m.tests.filter(t=>t.target==='second').every(t=>t.status==='notRun'&&t.attempts.length===0));
 const login=m.tests.find(t=>t.title==='login'&&t.target==='chromium');assert(login.attempts[0].media.some(x=>x.type==='video'&&x.availability==='local'));
 // A new partial run must not inherit recordings or statuses from the first one.
 await run([process.execPath,pw,'test','--project=chromium','--grep=expected failure'],root);
 m=await readModel(root);assert.equal(m.tests.find(t=>t.title==='login'&&t.target==='chromium').status,'notRun');
 assert.deepEqual(m.tests.find(t=>t.title==='login'&&t.target==='chromium').attempts,[]);
 await fs.writeFile(path.join(root,'tests','account.spec.ts'),source.replace("'login'","'renamed'"));
 await run([process.execPath,path.join(root,'e2r/scripts/generate-report.js'),'--framework','playwright','--catalog-only'],path.join(root,'tests'));
 m=await readModel(root);assert(m.tests.some(t=>t.title==='renamed'));assert(!m.tests.some(t=>t.title==='login'));assert(m.tests.every(t=>t.status==='notRun'));
 await fs.rm(path.join(root,'tests','account.spec.ts'));
 await run([process.execPath,cli,'--framework','playwright','--catalog-only'],root);
 assert.deepEqual((await readModel(root)).tests,[]);
});

test('e2e: complete catalog before running, native reporter, retries and serial evidence', {timeout:150000}, async t=>{
 const root=await consumer(t);
 const http=require('node:http');const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<html><body><h1>Sample</h1><button>Go</button></body></html>')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const port=server.address().port;
 const net=require('node:net');const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const cdpPort=probe.address().port;await new Promise(r=>probe.close(r));
 const chrome=await require('@playwright/test').chromium.launch({args:['--remote-debugging-port='+cdpPort]});t.after(()=>chrome.close());
 await fs.writeFile(path.join(root,'e2e.config.ts'),`import {web} from '@e2e-dev/web';import {e2rReporter} from './e2r/e2e-reporter.mjs';export default {tests:'tests/**/*.e2e.ts',workers:1,video:'on',reporters:['list',e2rReporter()],targets:[{name:'web',engine:web({connect:{cdpEndpoint:()=> 'http://127.0.0.1:${cdpPort}'}}),app:{url:'http://127.0.0.1:${port}'}}]};`);
 await fs.writeFile(path.join(root,'tests','flow.e2e.ts'),`import {test,expect} from 'e2e';import fs from 'node:fs';
 test('ordinary',async({app})=>{fs.writeFileSync('test-body-ran','yes');await app.open();await app.screenshot('ordinary')});
 test('retry',{retries:1},async({app},info)=>{await app.open();await app.screenshot('retry');if(!fs.existsSync('retry-marker')){fs.writeFileSync('retry-marker','yes');throw new Error('try again')}});
 test.describe('checkout',{serial:true},()=>{
 test('first',async({app})=>{await app.open();await app.screenshot('first')});
 test('second',async({app})=>{await app.screenshot('second')});
 });
 test.skip('skip',async()=>{});`);
 await run([process.execPath,cli,'--framework','e2e','--catalog-only'],root,{env:{E2E_TELEMETRY_DISABLED:'1'}});
 let m=await readModel(root);assert.equal(m.tests.length,5);assert(m.tests.every(t=>t.status==='notRun'));
 await assert.rejects(fs.stat(path.join(root,'test-body-ran')));
 const pkg=JSON.parse(await fs.readFile(path.join(repo,'node_modules/e2e/package.json'),'utf8'));
 const bin=path.resolve(repo,'node_modules/e2e',typeof pkg.bin==='string'?pkg.bin:pkg.bin.e2e);
 await run([process.execPath,bin,'run'],root,{env:{E2E_TELEMETRY_DISABLED:'1'}});
 m=await readModel(root);assert.equal(m.catalogComplete,true);
 assert.equal(m.tests.find(t=>t.title==='retry').status,'flaky');
 for(const name of ['first','second']){
   const row=m.tests.find(t=>t.title===name);assert.equal(row.status,'passed');
   assert(row.attempts[0].media.some(x=>x.type==='video'&&x.shared));
   assert(row.attempts[0].media.some(x=>x.type==='screenshot'&&!x.shared));
   assert.equal(row.attempts[0].index,1);
 }
 await run([process.execPath,bin,'run','--grep=ordinary'],root,{env:{E2E_TELEMETRY_DISABLED:'1'}});
 m=await readModel(root);assert.equal(m.tests.find(t=>t.title==='first').status,'notRun');assert.deepEqual(m.tests.find(t=>t.title==='first').attempts,[]);
 await run([process.execPath,cli,'','.e2e/report.json','e2r-report/imported.html'],path.join(root,'tests'),{env:{E2E_TELEMETRY_DISABLED:'1'}});
 const imported=require('./helpers.cjs').parse(await fs.readFile(path.join(root,'e2r-report/imported.html'),'utf8'));
 assert.equal(imported.tests.find(t=>t.title==='ordinary').status,'passed');
});
