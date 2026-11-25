/** Optional packaged-app regression: OPENDIRECTOR_DESKTOP_BINARY=/path/to/executable node apps/desktop/scripts/html-smoke.mjs */
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDocument, createNode} from '../../../src/canvas/model.ts';
import {buildCanvasArchive} from '../../../src/canvas/canvasArchive.ts';
const {_electron} = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const binary = process.env.OPENDIRECTOR_DESKTOP_BINARY;
assert.ok(binary, 'Set OPENDIRECTOR_DESKTOP_BINARY to the packaged application executable');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const profile = await mkdtemp(join(tmpdir(), 'opendirector-html-'));
const html = await readFile(join(root,'tests/fixtures/interactive-html/experience.html'),'utf8');
const node = createNode('text',{x:220,y:160},{title:'Interactive HTML regression',text:html,textFormat:'html',htmlState:{choice:'b',seconds:15}});
node.width=850;node.height=520;
const archive=await buildCanvasArchive({...createDocument('HTML desktop regression'),nodes:[node],viewport:{x:0,y:0,zoom:1}});
const file=join(profile,'demo.canvas');await writeFile(file,new Uint8Array(await archive.blob.arrayBuffer()));
const app=await _electron.launch({executablePath:resolve(binary),env:{...process.env,OPENDIRECTOR_DESKTOP_DATA:profile},timeout:30000});
try {
 const page=await app.firstWindow();page.setDefaultTimeout(15000);
 await app.evaluate(({app,BrowserWindow})=>{app.focus({steal:true});const window=BrowserWindow.getAllWindows()[0];window.show();window.focus();});
 await page.waitForURL('opendirector://app/**');
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.evaluate(()=>{localStorage.setItem('opendirector.locale.v1','en-US');localStorage.setItem('opendirector.modelSetup.v1','dismissed')});
 await page.reload();await page.locator('.cw-workspace:not([inert])').waitFor();
 await page.locator('.cw-save-status').filter({hasText:/Saved/}).waitFor();
 const receipt=page.waitForResponse(response=>{
  try {const body=response.request().postDataJSON();return response.url().endsWith('/commands')&&body?.type==='creation.batch'&&body.payload.operations.some(op=>op.type==='canvas.configureText');}
  catch {return false;}
 });
 await page.locator('input[accept=".canvas,application/zip"]').setInputFiles(file);
 assert.equal((await (await receipt).json()).status,'applied');
 const frame=page.frameLocator('.cw-html-node iframe');
 await frame.getByRole('heading',{name:'Design your next scene'}).waitFor();
 await page.locator('.cw-workspace:not([inert])').waitFor();
 await frame.locator('html[data-opendirector-ready=true]').waitFor();
 await page.locator('.cw-save-status').filter({hasText:/Saved/}).waitFor();
 await app.evaluate(({app,BrowserWindow})=>{app.focus({steal:true});BrowserWindow.getAllWindows()[0].focus();});
 // Exercise the fast desktop loader repeatedly: a second load event after
 // document.write must not replace the live channel with an unconnected port.
 for (const seconds of ['22','24']) {
  // Exercise keyboard focus inside the iframe at the canvas's fitted zoom.
  await frame.locator('input[value=c]').focus();await frame.locator('input[value=c]').press('Space');
  assert.equal(await frame.locator('input[value=c]').isChecked(),true);
  await frame.locator('#seconds').fill(seconds);
  await frame.locator('#save').press('Enter');await page.getByRole('button',{name:'Save result',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Result saved'}).waitFor();
  await page.reload();await frame.locator('input[value=c]:checked').waitFor();
  assert.equal(await frame.locator('#seconds').inputValue(),seconds);
 }
 await page.getByRole('button',{name:'Edit source',exact:true}).click();
 assert.match(await page.locator('.cw-text-window textarea').inputValue(),/<!doctype html>/);
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await frame.locator('#compose').press('Enter');await page.getByRole('button',{name:'Add to assistant draft',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.cw-assistant-composer [contenteditable=true]')?.textContent?.includes('"seconds"'));
 assert.deepEqual(errors,[]);
 if(process.env.HTML_SCREENSHOT) await page.screenshot({path:resolve(process.env.HTML_SCREENSHOT)});
 console.log('Packaged HTML: import, repeated save/reload, source editing and assistant draft passed');
}finally{await app.close();}
