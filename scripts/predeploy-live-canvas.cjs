const { chromium } = require('@playwright/test');
const { writeFileSync, readFileSync, existsSync } = require('node:fs');
const baseUrl = process.env.LIVE_CANVAS_ORIGIN || 'http://127.0.0.1:3005';
process.env.VOZEB_ADMIN_BASE_URL = baseUrl;
const { getCookie, sessionFetch } = require('D:/agent-project/sever/.agents/skills/vozeb-admin/scripts/session.js');
const projectId = 'canvas-UCGnKMRS_Gdwxj-P6nLNE';
const report = existsSync('.predeploy-live-result.json') ? JSON.parse(readFileSync('.predeploy-live-result.json', 'utf8')) : { startedAt: new Date().toISOString(), cases: [] };
const save = () => writeFileSync('.predeploy-live-result.json', JSON.stringify(report, null, 2));
(async () => {
  const response = await sessionFetch('/api/auth/session');
  const session = await response.json();
  report.balanceBefore ??= session.user?.pointsBalance;
  const browser = await chromium.launch({ executablePath: 'C:/Users/taofb/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe', headless: false });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const cookie = await getCookie();
  await context.addCookies([{ name: 'vozeb_pro_session', value: cookie.slice(cookie.indexOf('=') + 1).split(';')[0], url: baseUrl }]);
  const page = await context.newPage();
  page.on('response', async response => {
    const path = new URL(response.url()).pathname;
    if (!/\/api\/(image-tasks|video-generation-tasks)$/.test(path) || response.request().method() !== 'POST') return;
    const payload = await response.json().catch(() => ({}));
    const body = response.request().postDataJSON();
    report.cases.push({ path, status: response.status(), taskId: payload.task?.id || payload.data?.task?.id, model: body.config?.model, referenceCount: body.referenceImages?.length || body.references?.length || body.videoReferences?.length || 0, submittedAt: new Date().toISOString() });
    save();
    console.log('Task submitted', report.cases.at(-1));
  });
  await page.goto(`${baseUrl}/canvas/${projectId}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('[data-canvas-surface]').waitFor({ timeout: 60000 });
  const collapse = page.getByRole('button', { name: '收起 Agent 面板' });
  if (await collapse.isVisible()) await collapse.click();
  console.log('Live canvas ready');
  save();
  const cases = [
    { name: 'text-image', type: 'image', model: 'gpt-image-2', prompt: 'Product photo of a small red ceramic teapot on a pale blue table, soft daylight, no text.' },
    { name: 'reference-image', type: 'image', model: 'gpt-image-2', prompt: 'Keep the same teapot shape as the reference image, change the teapot color to yellow, keep the pale blue table.', referenceCase: 'text-image' },
    { name: 'text-video', type: 'video', model: 'sd2.0-mini933-720p-x10s', prompt: 'A red ceramic teapot on a pale blue table, slow cinematic camera push in, soft daylight, stable shot.' },
    { name: 'image-video', type: 'video', model: 'sd2.0-mini933-720p-x10s', prompt: 'Use the reference teapot image. Gentle steam rises, camera slowly pushes in, preserve the teapot shape and colors.', referenceCase: 'text-image' },
    { name: 'video-reference', type: 'video', model: 'Minimax-H3-768p-933-10s', prompt: 'Use the reference video camera motion and timing. Show a red ceramic teapot on a pale blue table in soft daylight.', referenceNode: 'local-deepkey-mini' },
  ];
  for (const item of cases) {
    if (report.cases.some(x => x.name === item.name && x.taskId)) continue;
    const response = await sessionFetch(`/api/canvas/projects/${projectId}`);
    const project = (await response.json()).data.project;
    const id = `predeploy-${item.name}-${Date.now()}`;
    let reference = item.referenceNode;
    if (item.referenceCase) reference = report.cases.find(x => x.name === item.referenceCase)?.nodeId;
    if (item.referenceCase && !reference) { report.cases.push({ name: item.name, error: 'Reference prerequisite failed' }); save(); continue; }
    const node = { id, type: item.type, title: `Predeploy ${item.name}`, position: { x: 0, y: 0 }, width: 200, height: 200, metadata: { model: item.model, prompt: item.prompt, sourcePrompt: item.prompt, size: '16:9', quality: 'auto', vquality: '720', seconds: '10', count: 1, videoReferenceMode: 'reference' } };
    const next = { ...project, viewport: { x: 300, y: 80, k: 1 }, nodes: [...project.nodes, node], connections: [...project.connections, ...(reference ? [{ id: `reference-${id}`, fromNodeId: reference, toNodeId: id }] : [])] };
    const patched = await sessionFetch(`/api/canvas/projects/${projectId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: next, expectedUpdatedAt: project.updatedAt }) });
    if (!patched.ok) throw new Error(`Canvas setup ${patched.status}`);
    await page.goto(`${baseUrl}/canvas/${projectId}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const collapse = page.getByRole('button', { name: '收起 Agent 面板' });
    if (await collapse.isVisible()) await collapse.click();
    await page.locator(`[data-node-id="${id}"]`).click({ position: { x: 50, y: 50 }, timeout: 60000 });
    const panel = page.locator('[data-canvas-node-panel]');
    await panel.getByRole('textbox', { name: '节点提示词' }).fill(item.prompt);
    const endpoint = item.type === 'image' ? '/api/image-tasks' : '/api/video-generation-tasks';
    const taskResponse = page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.request().method() === 'POST', { timeout: 180000 });
    console.log('Starting UI generation', item.name);
    await panel.getByRole('button', { name: '生成', exact: true }).click();
    const submitted = await taskResponse;
    const payload = await submitted.json();
    const taskId = payload.task?.id || payload.data?.task?.id;
    const record = report.cases.find(x => x.taskId === taskId) || {};
    Object.assign(record, { name: item.name, taskId, status: submitted.status(), sourceNodeId: id });
    if (!report.cases.includes(record)) report.cases.push(record);
    save();
    if (!taskId) { record.error = JSON.stringify(payload).slice(0, 1000); save(); continue; }
    const start = Date.now();
    while (Date.now() - start < 25 * 60 * 1000) {
      const detail = await sessionFetch(`${item.type === 'image' ? '/api/image-tasks/' : '/api/video-tasks/'}${taskId}`);
      const data = await detail.json();
      const task = data.task || data.data?.task || data.data || data;
      record.taskStatus = task.status; record.elapsedSeconds = Math.round((Date.now() - start) / 1000); save();
      console.log(item.name, record.taskStatus, `${record.elapsedSeconds}s`);
      if (['success', 'error', 'failed', 'cancelled', 'needs_review'].includes(task.status)) {
        record.result = task.result; record.error = task.error || task.errorDetails;
        await page.locator('.canvas-topbar[data-save-status="saved"]').waitFor({ timeout: 60000 });
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.locator('[data-canvas-surface]').waitFor({ timeout: 60000 });
        const restored = await sessionFetch(`/api/canvas/projects/${projectId}`);
        const current = (await restored.json()).data.project;
        const output = current.nodes.find(n => n.metadata?.imageTask?.id === taskId || n.metadata?.videoTask?.id === taskId) || current.nodes.find(n => n.id === id && n.metadata?.content);
        record.nodeId = output?.id; record.persistedMedia = !!output?.metadata?.storageKey; save();
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
  }
  const after = await sessionFetch('/api/auth/session');
  report.balanceAfter = (await after.json()).user?.pointsBalance;
  report.finishedAt = new Date().toISOString(); save();
  console.log('Live acceptance complete', report.cases.map(x => ({ name: x.name, status: x.taskStatus, error: x.error })));
  await browser.close();
})().catch(error => { console.error(error.message); report.error = error.message; save(); process.exitCode = 1; });
