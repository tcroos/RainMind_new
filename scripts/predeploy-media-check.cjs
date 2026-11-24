const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
process.env.VOZEB_ADMIN_BASE_URL = 'http://127.0.0.1:3005';
const { sessionFetch } = require('D:/agent-project/sever/.agents/skills/vozeb-admin/scripts/session.js');
(async () => {
  const project = (await (await sessionFetch('/api/canvas/projects/canvas-UCGnKMRS_Gdwxj-P6nLNE')).json()).data.project;
  const report = [];
  for (const node of project.nodes.filter(n => n.id.startsWith('predeploy') && n.metadata?.status === 'success' && n.metadata?.content)) {
    const response = await sessionFetch(node.metadata.content);
    if (!response.ok) { report.push({ id: node.id, status: response.status }); continue; }
    const file = `C:/Users/taofb/AppData/Local/Temp/opencode/${node.id}.${node.type === 'video' ? 'mp4' : 'png'}`;
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' });
    report.push({ id: node.id, type: node.type, downloaded: true, bytes: fs.statSync(file).size, decodeExit: decoded.status, error: decoded.stderr?.slice(0, 1000), promptRetained: !!(node.metadata.sourcePrompt || node.metadata.prompt), referenceCount: node.metadata.videoReferences?.length });
    console.log(report.at(-1));
  }
  const points = await (await sessionFetch('/api/points?page=1&pageSize=15')).json();
  const current = await (await sessionFetch('/api/auth/session')).json();
  fs.writeFileSync('.predeploy-media-result.json', JSON.stringify({ media: report, balance: current.user.pointsBalance, ledger: points.records.filter(r => r.createdAt >= '2026-10-19T14:29:00Z').map(r => ({ type: r.type, model: r.model, amount: r.amount, sourceRecordId: r.sourceRecordId })) }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
