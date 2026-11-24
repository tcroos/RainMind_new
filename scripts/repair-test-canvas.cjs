process.env.VOZEB_ADMIN_BASE_URL = 'http://127.0.0.1:3005';
const { sessionFetch } = require('D:/agent-project/sever/.agents/skills/vozeb-admin/scripts/session.js');
const { writeFileSync, readFileSync } = require('node:fs');
(async () => {
 const path = '/api/canvas/projects/canvas-UCGnKMRS_Gdwxj-P6nLNE';
 const project = (await (await sessionFetch(path)).json()).data.project;
 writeFileSync('C:/Users/taofb/AppData/Local/Temp/opencode/canvas-before-size-repair.json', JSON.stringify(project));
 const report = JSON.parse(readFileSync('.predeploy-live-result.json','utf8'));
 const nodes = project.nodes.map((node,index) => {
  if (!['image','video'].includes(node.type)) return node;
  const result = report.cases.find(item => item.nodeId === node.id)?.result;
  let width = result?.width || node.metadata?.naturalWidth || node.width;
  let height = result?.height || node.metadata?.naturalHeight || node.height;
  if (node.type === 'image' && node.id.startsWith('predeploy-')) { width = 1672; height = 941; }
  const ratio = width / height;
  const size = ratio >= 1 ? {width:330*ratio,height:330} : {width:330,height:330/ratio};
  return {...node,...size,position:{x:(index%3)*900,y:Math.floor(index/3)*850},metadata:{...node.metadata,naturalWidth:width,naturalHeight:height}};
 });
 const response = await sessionFetch(path,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:{...project,nodes,viewport:{x:80,y:100,k:0.6}},expectedUpdatedAt:project.updatedAt})});
 if (!response.ok) throw new Error(`Save failed ${response.status}`);
 console.log(JSON.stringify({status:response.status,nodes:nodes.length,shortEdge:330,backup:'C:/Users/taofb/AppData/Local/Temp/opencode/canvas-before-size-repair.json'}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
