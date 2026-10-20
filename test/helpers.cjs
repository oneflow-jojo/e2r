const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { chromium } = require('@playwright/test');
const repo = path.resolve(__dirname, '..');
async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'e2r-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true })); return root;
}
async function run(args, cwd, { env = {}, expected = 0 } = {}) {
  const command = args[0];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args.slice(1), { cwd, env: { ...process.env, ...env }, stdio: ['ignore','pipe','pipe'] });
    let text = '';
    child.stdout.on('data', b => text += b);child.stderr.on('data', b => text += b);
    child.on('error', reject);
    child.on('close', code => code === expected ? resolve(text) : reject(new Error(`${command} exited ${code} (expected ${expected})\n${text}`)));
  });
}
async function consumer(t) {
  const root = await temp(t);
  await fs.mkdir(path.join(root,'e2r'));
  for (const f of ['scripts','reporter.cjs','e2e-reporter.mjs']) await fs.cp(path.join(repo,f),path.join(root,'e2r',f),{recursive:true});
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({private:true,type:'module'}));
  await fs.symlink(path.join(repo,'node_modules'),path.join(root,'node_modules'),'dir');
  await fs.mkdir(path.join(root,'tests'));
  return root;
}
function parse(html) { return JSON.parse(html.match(/<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/)[1]); }
async function readModel(root) {return parse(await fs.readFile(path.join(root,'e2r-report/report.html'),'utf8'));}
async function browser(t) {const b=await chromium.launch();t.after(()=>b.close());return b;}
module.exports={fs,path,repo,temp,run,consumer,parse,readModel,browser,pathToFileURL};
