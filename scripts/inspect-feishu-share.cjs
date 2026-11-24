const {chromium}=require('@playwright/test');
const fs=require('node:fs');
const root='C:/Users/taofb/AppData/Local/Temp/opencode';
(async()=>{
 const context=await chromium.launchPersistentContext(root+'/feishu-share-browser',{executablePath:'C:/Users/taofb/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe',headless:true,viewport:{width:1440,height:1000}});
 try {
 const page=context.pages()[0]||await context.newPage();
 await page.goto('https://hcn5dyc2gmu4.feishu.cn/wiki/KIS7wjb6MiLLHHkYsytcDrMZnyg?from=from_copylink',{waitUntil:'domcontentloaded',timeout:60000});
 await page.locator('body').waitFor();
 await page.waitForTimeout(3000);
 const password=page.locator('input[type="password"]');
 if(await password.count()){
  if (!process.env.FEISHU_SHARE_PASSWORD) throw new Error('Share password required in process environment');
  await password.first().fill(process.env.FEISHU_SHARE_PASSWORD);
  const submit=page.getByRole('button',{name:/确定|确认|访问|进入|提交/});
  if(await submit.count())await submit.first().click();else await password.first().press('Enter');
  await page.waitForTimeout(5000);
 }
 if(process.argv[2]){
  const label=page.getByText(process.argv[2],{exact:true});
  if(await label.count()) {await label.first().click();await page.waitForTimeout(3000);}
 }
 console.log(JSON.stringify({url:page.url(),text:(await page.locator('body').innerText()).slice(0,40000),inputs:await page.locator('input').evaluateAll(els=>els.map(e=>({type:e.type,placeholder:e.placeholder}))),frames:page.frames().map(f=>f.url())},null,2));
 for(const frame of page.frames().slice(1)){try{console.log(JSON.stringify({frame:frame.url(),text:(await frame.locator('body').innerText({timeout:3000})).slice(0,55000)}))}catch{}}
 await page.screenshot({path:root+'/feishu-share.png'});
 }finally{await context.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
