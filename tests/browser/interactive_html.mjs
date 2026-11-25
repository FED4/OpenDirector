/** Model-authored HTML: interaction, confirmed persistence, draft insertion and isolation. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { launchBrowser } from "./engine.mjs";
const base = process.env.CREATION_WEB_URL ?? "http://127.0.0.1:5179";
const headers = {"X-OpenDirector-Request": "1"};
const health = await fetch(`${base}/api/creation-test-health`, {headers});
assert.equal(health.ok, true); assert.equal((await health.json()).isolated, true);
const browser = await launchBrowser();
const page = await browser.newPage({locale: "en-US", viewport: {width: 1500, height: 1050}});
page.setDefaultTimeout(15000);
await page.addInitScript(() => {
  if (window !== window.top) return;
  localStorage.setItem("opendirector.locale.v1", "en-US");
  localStorage.setItem("opendirector.modelSetup.v1", "dismissed");
});
const errors = [];

page.on("pageerror", error => errors.push(error.message));
let leaks = 0;
const receiver = createServer((_req, res) => { leaks++; res.end("unexpected"); });
await new Promise(resolve => receiver.listen(0, "127.0.0.1", resolve));
const leakURL = `http://127.0.0.1:${receiver.address().port}/leak`;
try {
  const bootstrap = url => url.origin === new URL(base).origin && url.pathname === "/";
  await page.route(bootstrap, route => route.fulfill({contentType: "text/html", body: "<html></html>"}));
  await page.goto(base);
  const fixture = await page.evaluate(async () => {
    const {createDocument, createNode} = await import("/src/canvas/model.ts");
    const {importWorkspaceDocument} = await import("/src/backend/workspace.ts");
    const {releaseBackendProject} = await import("/src/backend/projects.ts");
    const html = `<!doctype html><html><head><style>
      body{margin:0;padding:32px;background:#f3f6fc;color:#14233c;font:16px system-ui}
      h1{font-size:26px} .options{display:flex;gap:12px} label{padding:18px;background:white;border-radius:12px;border:1px solid #dbe4f0}
      button{margin:24px 8px 0 0;padding:12px 18px;background:#345cf0;color:white;border:0;border-radius:8px;cursor:pointer}
      input[type=range]{width:90%} p{color:#52657c}
    </style></head><body><h1>Design your next scene</h1><p>Choose a direction and adjust the pacing.</p>
    <div class=options><label><input type=radio name=choice value=a>Quiet morning</label><label><input type=radio name=choice value=b checked>City in motion</label><label><input type=radio name=choice value=c>After sunset</label></div>
    <h3>Duration <output id=duration>15</output>s</h3><input id=seconds type=range min=5 max=30 value=15 oninput="duration.value=this.value">
    <div><button id=save>Save preferences</button><button id=compose>Add to chat</button></div><p id=status>Changes stay local until you submit.</p>
    <script>
    function payload(){return {choice:document.querySelector('input:checked').value,seconds:Number(seconds.value)}}
    opendirector.ready.then(state=>{if(state.choice)document.querySelector('input[value="'+state.choice+'"]').checked=true;if(state.seconds)duration.value=seconds.value=state.seconds;});
    save.onclick=async()=>{try{await opendirector.request({action:'submit',payload:payload()});status.textContent='Saved'}catch(error){status.textContent=error.message}};
    compose.onclick=async()=>{try{await opendirector.request({action:'compose',payload:payload()});}catch(error){status.textContent=error.message}};
    <\/script></body></html>`;
    const node = createNode("text", {x: 220, y: 150}, {title: "Interactive HTML · Scene explorer", text: html, textFormat: "html"});
    node.width = 850; node.height = 520;
    const saved = await importWorkspaceDocument({...createDocument("Interactive HTML regression"), nodes:[node], viewport:{x:0,y:0,zoom:1}});
    (await import("/src/backend/creationClient.ts")).creationClient(saved.id).close();
    await releaseBackendProject();
    return {id:saved.id, itemId:node.id};
  });
  await page.unroute(bootstrap);
  await page.goto(`${base}/ai-tool/ai-canvas/${fixture.id}`);
  const node = page.locator(`.react-flow__node[data-id="${fixture.itemId}"]`);
  const frame = node.frameLocator("iframe");
  await frame.getByRole("heading", {name:"Design your next scene"}).waitFor();
  await page.locator('.cw-save-status').filter({hasText:/Saved/}).waitFor();
  await frame.locator('input[value=c]').check();
  await frame.locator('#seconds').fill('22');
  await frame.locator('#save').click();
  await node.getByRole('button', {name:'Save result', exact:true}).click();
  await node.getByRole('status').filter({hasText:'Result saved'}).waitFor();
  const snapshot = async () => {
    const response = await page.request.get(`${base}/api/creation/projects/${fixture.id}`, {headers});
    assert.equal(response.ok(),true); return response.json();
  };
  let saved = (await snapshot()).canvasItems.find(item => item.id === fixture.itemId);
  assert.equal(saved.textFormat,'html'); assert.deepEqual(saved.htmlState,{choice:'c',seconds:22});
  await page.reload();
  await frame.locator('input[value=c]:checked').waitFor();
  assert.equal(await frame.locator('#seconds').inputValue(),'22');
  console.log('PASS: HTML renders, runs JS, saves with confirmation and restores state after reopening');
  await node.getByRole('button', {name:'Edit source',exact:true}).click();
  await page.locator('.cw-text-window textarea').waitFor();
  assert.match(await page.locator('.cw-text-window textarea').inputValue(), /<!doctype html>/);
  await page.getByRole('button', {name:'Done',exact:true}).click();
  await frame.getByRole('heading', {name:'Design your next scene'}).waitFor();
  console.log('PASS: closing source editor returns to the interactive HTML view');
  if (process.env.HTML_SCREENSHOT) await page.screenshot({path:process.env.HTML_SCREENSHOT});
  // Untrusted code cannot access the host or transmit bytes outside the runtime.
  const runtime = page.frames().find(item => item.url().includes('/html-runtime.html'));
  const isolation = await runtime.evaluate(async ({leakURL}) => {
    let parentBlocked=false; try { void parent.document.body; } catch { parentBlocked=true; }
    let fetchBlocked=false; try { await fetch(leakURL); } catch { fetchBlocked=true; }
    const image=new Image(); image.src=leakURL+'?image'; document.body.append(image);
    return {parentBlocked,fetchBlocked,node:typeof require,desktop:typeof window.opendirectorDesktop};
  },{leakURL});
  assert.deepEqual(isolation,{parentBlocked:true,fetchBlocked:true,node:'undefined',desktop:'undefined'});
  await runtime.evaluate(url => { location.href=url; },leakURL+'?navigation');
  await page.waitForTimeout(250);
  assert.equal(leaks,0,'Neither subresources nor frame navigation may access the network');
  console.log('PASS: cross-frame access, host APIs, fetch, image loads and external navigation are blocked');
  await page.reload();
  await frame.locator('#compose').waitFor();
  await page.locator('.cw-save-status').filter({hasText:/Saved/}).waitFor();
  await frame.locator('#compose').click();
  await node.getByRole('button',{name:'Add to assistant draft',exact:true}).click();
  const draft = page.locator('.cw-assistant-composer [contenteditable=true]');
  await page.waitForFunction(() => document.querySelector('.cw-assistant-composer [contenteditable=true]')?.textContent?.includes('"seconds"'));
  console.log('PASS: interaction inserts visible assistant draft without sending');
  // Check both interface catalogs with the same rendered runtime.
  await page.getByRole('button', {name:'中文',exact:true}).click();
  await node.locator('iframe[title="交互式 HTML 内容"]').waitFor();
  console.log('PASS: Chinese interface renders the same saved HTML');
  assert.deepEqual(errors,[]);
  console.log('Fixture:',JSON.stringify(fixture));
} finally { await browser.close(); await new Promise(resolve=>receiver.close(resolve)); }
