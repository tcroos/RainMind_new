const { chromium } = require('@playwright/test');
process.env.VOZEB_ADMIN_BASE_URL = 'http://127.0.0.1:3005';
const { getCookie, sessionFetch } = require('D:/agent-project/sever/.agents/skills/vozeb-admin/scripts/session.js');
(async () => {
 const browser = await chromium.launch({ executablePath:'C:/Users/taofb/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',headless:false });
 const context = await browser.newContext(); const cookie=await getCookie();
 await context.addCookies([{name:'vozeb_pro_session',value:cookie.slice(cookie.indexOf('=')+1).split(';')[0],url:'http://127.0.0.1:3005'}]);
 const page=await context.newPage(); await page.goto('http://127.0.0.1:3005/canvas/canvas-UCGnKMRS_Gdwxj-P6nLNE',{waitUntil:'domcontentloaded',timeout:120000});
 for(let attempt=0;attempt<24;attempt++) {
  const p=(await(await sessionFetch('/api/canvas/projects/canvas-UCGnKMRS_Gdwxj-P6nLNE')).json()).data.project;
  const n=p.nodes.find(n=>n.id==='predeploy-video-reference-1792423798605'); console.log({status:n?.metadata?.status,media:!!n?.metadata?.storageKey});
  if(n?.metadata?.status==='success'&&n.metadata.storageKey)break;
  await page.waitForTimeout(5000);
 }
 await browser.close();
})().catch(e=>{console.error(e.message);process.exitCode=1});
