const {test}=require('node:test');const assert=require('node:assert/strict');
const {normalizeE2E,normalizePlaywrightJSON,entry,mergeCatalog}=require('../scripts/model.js');

test('e2e: serial members only get their own screenshot and explicitly shared video',()=>{
 const report={schemaVersion:'report-1',run:{results:[
 {id:'a',testId:'a',file:'a/login.ts',titlePath:['group','login'],serialGroupId:'g',targetId:'web',status:'failed',selected:true},
 {id:'b',testId:'b',file:'b/login.ts',titlePath:['group','login'],serialGroupId:'g',targetId:'web',status:'passed',selected:true},
 {id:'c',testId:'c',file:'c.ts',titlePath:['not selected'],selected:false,status:'skipped',attempts:[{artifacts:[{kind:'video',path:'old.webm'}]}]},
 ],serialGroups:[{id:'g',attempts:[{index:0,artifacts:[
 {id:'a-screen',kind:'screenshot',path:'a.png',producer:{kind:'attempt'}},
 {id:'b-screen',kind:'screenshot',path:'b.png',producer:{kind:'step',stepId:'b-step'}},
 {id:'video',kind:'video',path:'shared.webm',producer:{kind:'attempt'}},
 ],members:[{testId:'a',status:'failed',error:{message:'a failed'},failure:{screenshot:'a-screen'}},
 {testId:'b',status:'passed',steps:[{id:'b-step',artifacts:['b-screen']}]}]}]}]}};
 const m=normalizeE2E(report,'/tmp');
 assert.deepEqual(m.tests[0].attempts[0].media.map(x=>[x.name,x.shared]),[['a.png',false],['shared.webm',true]]);
 assert.equal(m.tests[0].attempts[0].index,1);
 assert.deepEqual(m.tests[1].attempts[0].media.map(x=>[x.name,x.shared]),[['b.png',false],['shared.webm',true]]);
 assert.equal(m.tests[2].status,'notRun');assert.deepEqual(m.tests[2].attempts,[]);
 assert.notEqual(m.tests[0].id,m.tests[1].id);
});
test('Playwright JSON: nested suites, expected failure, unexpected pass, repeats and retries',()=>{
 const make=(status,expectedStatus,results,projectName='chromium')=>({status,expectedStatus,projectName,results});
 const r={suites:[{title:'one.spec.ts',file:'one.spec.ts',suites:[{title:'checkout',file:'one.spec.ts',specs:[{title:'upgrade',file:'one.spec.ts',tests:[
 make('expected','failed',[{status:'failed'}]),make('unexpected','failed',[{status:'passed'}]),
 make('flaky','passed',[{status:'failed',error:{message:'first'}},{status:'passed'}],'firefox'),
 ]}]}]}]};
 const m=normalizePlaywrightJSON(r,'/tmp');
 assert.deepEqual(m.tests.map(t=>t.titlePath),Array(3).fill(['checkout','upgrade']));
 assert.deepEqual(m.tests.map(t=>t.status),['passed','failed','flaky']);
 assert.deepEqual(m.tests.map(t=>t.repeat),[0,1,0]);assert.equal(m.tests[2].attempts[0].error,'first');assert.equal(m.tests[2].attempts[1].error,'');
});
test('catalog merge keeps never-run tests and distinct environments without old results',()=>{
 const base={framework:'e2e',file:'a.ts',titlePath:['login'],target:'web'};
 const a=entry(base),b=entry({...base,target:'mobile'}),c=entry({...base,status:'passed',attempts:[{media:[]}]});
 const m=mergeCatalog([a,b],[c]);assert.equal(m.length,2);assert.equal(m[0].status,'passed');assert.equal(m[1].status,'notRun');assert.deepEqual(m[1].attempts,[]);
 assert.throws(()=>normalizeE2E({schemaVersion:'future',run:{results:[]}},'/tmp'),/report-1/);
});
