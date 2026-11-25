import assert from 'node:assert/strict';
import {launchBrowser} from './engine.mjs';
const base=process.env.CREATION_WEB_URL??'http://127.0.0.1:5179';
const headers={'X-OpenDirector-Request':'1'};
const health=await fetch(base+'/api/creation-test-health',{headers});assert.equal((await health.json()).isolated,true);
const browser=await launchBrowser();
try{
 const page=await browser.newPage({locale:'en-US',viewport:{width:1500,height:1050}});page.setDefaultTimeout(15000);
 await page.addInitScript(()=>{localStorage.setItem('opendirector.locale.v1','en-US');localStorage.setItem('opendirector.modelSetup.v1','dismissed')});
 const root=url=>url.origin===new URL(base).origin&&url.pathname==='/';
 await page.route(root,route=>route.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(base);
 const fixture=await page.evaluate(async()=>{
  const {createDocument,createNode}=await import('/src/canvas/model.ts');
  const {importWorkspaceDocument}=await import('/src/backend/workspace.ts');
  const {creationClient}=await import('/src/backend/creationClient.ts');
  const {releaseBackendProject}=await import('/src/backend/projects.ts');
  const response=await fetch('/api/model-configs',{headers:{'X-OpenDirector-Request':'1'}});const catalog=await response.json();
  const models=Array.isArray(catalog)?catalog:catalog.models;const model=models.find(m=>m.kind==='agent');
  const node=createNode('text',{x:200,y:100},{title:'Modify regression',text:'Shot 1: morning.\nShot 2: knock on the door.',prompt:'Change only shot 2 to holding a basin.',agentSettings:{modelConfigId:model.id,thinking:'auto',maxTokens:8192,operation:'modify'}});
  node.width=600;node.height=300;
  const doc=await importWorkspaceDocument({...createDocument('Text modify regression'),nodes:[node],viewport:{x:0,y:0,zoom:1}});
  const client=creationClient(doc.id);const snapshot=client.snapshot;
  const spec=snapshot.generationSpecs.find(s=>s.kind==='text');
  if(!spec.parameters.sourceAsset)throw Error('Unsaved authored text was not pinned');
  const sourceId=spec.parameters.sourceAsset.assetId;
  client.close();await releaseBackendProject();return {id:doc.id,nodeId:node.id,sourceId};
 });
 await page.unroute(root);await page.goto(`${base}/ai-tool/ai-canvas/${fixture.id}`);
 const node=page.locator(`.react-flow__node[data-id="${fixture.nodeId}"]`);await node.waitFor();
 await page.locator('.cw-save-status').filter({hasText:/Saved/}).waitFor();await node.click();
 const operation=page.getByRole('combobox',{name:'Text operation'});await operation.waitFor();assert.equal(await operation.inputValue(),'modify');
 await page.getByText('Current text included in Modify',{exact:true}).click();
 await page.locator('details pre').filter({hasText:'Shot 1: morning.'}).waitFor();
 await operation.selectOption('regenerate');await operation.selectOption('modify');
 await page.getByRole('button',{name:'Generate text',exact:true}).click();
 let snapshot;
 for(let attempt=0;attempt<100;attempt++) {
  snapshot=await(await page.request.get(`${base}/api/creation/projects/${fixture.id}`,{headers})).json();
  if(snapshot.jobs.some(job=>job.status==='succeeded')) break;
  await page.waitForTimeout(100);
 }
 assert.ok(snapshot.jobs.some(job=>job.status==='succeeded'),JSON.stringify(snapshot.jobs));
 const job=snapshot.jobs.at(-1);assert.equal(job.inputSnapshot.spec.parameters.operation,'modify');assert.equal(job.inputSnapshot.spec.prompt,'Change only shot 2 to holding a basin.');assert.ok(job.inputSnapshot.references.some(r=>r.asset.assetId===fixture.sourceId));
 const versions=await(await page.request.get(`${base}/api/creation/projects/${fixture.id}/items/${fixture.nodeId}/versions`,{headers})).json();
 assert.ok(versions.versions.some(v=>v.asset.id===fixture.sourceId));
 console.log('PASS: unsaved text pinned, operation selector and source preview, UI submission, immutable execution input, original in node history');
}finally{await browser.close();}
