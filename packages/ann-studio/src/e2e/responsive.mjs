import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const taxonomy = JSON.parse(await readFile(new URL('../../../../schemas/gmaiden-events.json', import.meta.url), 'utf8'));
const expectedLabels = taxonomy['x-events'].filter(event => event.id !== 'unused').map(event => event.label).sort();
const packageDir = fileURLToPath(new URL('..', import.meta.url));
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const server = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', '5175', '--strictPort'], { cwd: packageDir, stdio: 'inherit' });
async function waitForLayout(page, mode) {
  await page.waitForFunction(expected => {
    const assets = document.getElementById('asset-rail');
    const agent = document.getElementById('agent-rail');
    if (!assets || !agent) return false;
    if (expected === 'wide') return agent.classList.contains('shrink-0');
    if (expected === 'medium') return assets.classList.contains('shrink-0') && agent.classList.contains('absolute');
    return assets.classList.contains('absolute');
  }, mode);
}
async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Vite exited ${server.exitCode}`);
    try { if ((await fetch('http://127.0.0.1:5175/')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Vite did not start');
}
await waitForServer().catch(error => { server.kill(); throw error; });

let browser;
try {
 browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || undefined});
 for (const scale of [1, 1.25, 1.5]) {
  const context = await browser.newContext({viewport: {width: 960, height: 600}, deviceScaleFactor: scale});
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5175/', {waitUntil: 'networkidle'});
  await page.evaluate(async () => {
    const {useStudioStore} = await import('/src/store/useStudioStore.ts');
    const {GMAIDEN_EVENTS} = await import('/src/data/gmaiden-events.ts');
    const clips = Array.from({length: 101}, (_, i) => ({ id: `fixture-${i}`, name: `เสียงประกาศภาษาไทยผสม English long filename ${'W'.repeat(65)} ${i}`, start: 0, end: 3, event: GMAIDEN_EVENTS[i % GMAIDEN_EVENTS.length].id, color: '' }));
    useStudioStore.setState({view: 'studio', sourcePath: 'C:/fixture/เสียงทดสอบ-long-filename.wav', wavPath: 'C:/fixture/เสียงทดสอบ-long-filename.wav', duration: 3, clips, selectedClipId: clips[0].id});
  });
  const menu = page.getByLabel('More actions');
  await menu.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', {name:'Studio', exact:true}).focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', {name:'Studio', exact:true}).isVisible(), false, 'Escape should close the menu');
  assert.equal(await menu.evaluate(el => el === document.activeElement), true, 'closing menu should restore focus');
  await page.setViewportSize({width:1440,height:900});
  await waitForLayout(page, 'wide');
  await page.getByPlaceholder('พิมพ์คำสั่ง AI…').focus();
  await page.setViewportSize({width:1200,height:720});
  await waitForLayout(page, 'medium');
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Agent');
  await page.getByTitle('Refresh', {exact:true}).focus();
  await page.setViewportSize({width:960,height:600});
  await waitForLayout(page, 'compact');
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Assets');
  await page.setViewportSize({width:1200,height:720});
  await waitForLayout(page, 'medium');
  await page.getByRole('button', {name:'Agent', exact:true}).click();
  const agentInput = page.getByPlaceholder('พิมพ์คำสั่ง AI…');
  await agentInput.fill('ช่วย test draft');
  await agentInput.focus();
  await page.setViewportSize({width:960,height:600});
  await waitForLayout(page, 'compact');
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Agent');
  await page.getByRole('button', {name:'Agent', exact:true}).click();
  assert.equal(await agentInput.inputValue(), 'ช่วย test draft', 'Agent draft lost on layout transition');
  await page.getByRole('button', {name:'Agent', exact:true}).click();
  const clipName = page.getByPlaceholder('(ตั้งชื่อ clip)').first();
  await clipName.fill('แก้ไขแล้ว Mixed English ' + 'ย'.repeat(80));
  const expectedName = await clipName.inputValue();
  for (const [width, height] of [[960,600],[1024,768],[1280,720],[1440,900],[1920,1080]]) {
    await page.setViewportSize({width,height});
    await waitForLayout(page, width >= 1380 ? 'wide' : width >= 1000 ? 'medium' : 'compact');
    const result = await page.evaluate(() => {
      const failures = [];
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth) failures.push('document overflows');
      const card = document.querySelector('input[placeholder="(ตั้งชื่อ clip)"]')?.closest('.rounded-xl');
      if (!card) failures.push('populated clip card missing');
      else {
        if (card.scrollWidth > card.clientWidth + 1) failures.push(`clip card overflow ${card.scrollWidth}/${card.clientWidth}`);
        const bounds = card.getBoundingClientRect();
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(node);
          for (const rect of range.getClientRects()) if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) failures.push(`clip text escapes card: ${node.textContent.trim()}`);
        }
      }
      for (const b of document.querySelectorAll('button')) {
        const r=b.getBoundingClientRect(), style=getComputedStyle(b);
        if (!r.width || !r.height || style.visibility==='hidden') continue;
        for (const n of b.childNodes) {
          if (n.nodeType!==Node.TEXT_NODE || !n.textContent.trim()) continue;
          const range=document.createRange(); range.selectNodeContents(n);
          for (const t of range.getClientRects()) if(t.left < r.left-1 || t.right > r.right+1 || t.top < r.top-1 || t.bottom > r.bottom+1) failures.push(`${b.textContent.trim()} exceeds button`);
        }
      }
      return failures;
    });
    assert.deepEqual(result, [], `${width}x${height}: ${result.join('; ')}`);
    assert.equal(await clipName.inputValue(), expectedName, 'clip edit lost on resize');
    for (const label of ['บันทึก','ทดสอบ','ส่งออก','Assets','Agent','Save to Library','Export','ติดตั้ง G-Maiden']) assert.ok(await page.getByRole('button',{name:label,exact:true}).filter({visible:true}).count(), `${width}: missing visible ${label}`);
    if (width === 1440) {
      for (const [label, key] of [['Resize assets', 'ArrowLeft'], ['Resize agent', 'ArrowRight']]) {
        const separator = page.getByRole('separator', {name: label});
        const before = Number(await separator.getAttribute('aria-valuenow'));
        await separator.focus();
        await page.keyboard.press(key);
        const after = Number(await separator.getAttribute('aria-valuenow'));
        assert.ok(after < before, `${label} must resize using the keyboard`);
      }
    }
    if (width < 1380) {
      await page.getByRole('button', {name:'Agent', exact:true}).click();
      assert.ok(await page.getByPlaceholder('พิมพ์คำสั่ง AI…').isVisible(), 'Agent drawer unavailable');
      const modelBounds = await page.locator('#agent-rail').getByRole('button', {name: /^Local ·/}).boundingBox();
      const agentBounds = await page.locator('#agent-rail').boundingBox();
      assert.ok(modelBounds && agentBounds && modelBounds.y + modelBounds.height <= agentBounds.y + agentBounds.height + 1, `Agent model picker is clipped: ${JSON.stringify({modelBounds, agentBounds})}`);
      await page.getByPlaceholder('พิมพ์คำสั่ง AI…').focus();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByPlaceholder('พิมพ์คำสั่ง AI…').isVisible(), false);
      assert.equal(await page.getByRole('button', {name:'Agent', exact:true}).evaluate(el => el === document.activeElement), true, 'closing Agent drawer should restore focus to its control');
    }
    console.log(`PASS ${width}x${height} browser DPR ${scale}`);
  }
  await page.setViewportSize({width: 960, height: 600});
  await page.getByRole('button', {name:'ทดสอบ', exact:true}).click();
  const eventButtons = page.getByRole('button', {name: /^ทดสอบ event: /});
  await eventButtons.first().waitFor();
  const labels = await eventButtons.evaluateAll(buttons => buttons.map(button =>
    button.getAttribute('aria-label')?.match(/^ทดสอบ event: (.+) \(\d+ เสียง\)$/u)?.[1] ?? ''
  ));
  assert.deepEqual(labels.sort(), expectedLabels, 'each eligible event must have exactly one named preview');
  await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
  const eventOverflow = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].filter(el => /ติดตั้งลง G-Maiden|ติดตั้งจากคลัง/.test(el.textContent));
    return buttons.map(button => {
      const rect = button.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(button);
      return {name: button.textContent, rect: {left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom}, text: [...range.getClientRects()].map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})), viewport: {width:innerWidth,height:innerHeight}};
    });
  });
  assert.equal(eventOverflow.length, 2, 'both event install actions must exist');
  for (const item of eventOverflow) {
    assert.ok(item.rect.left >= 0 && item.rect.right <= item.viewport.width, `event toolbar button outside viewport: ${JSON.stringify(item)}`);
    assert.ok(item.text.every(r => r.left >= item.rect.left - 1 && r.right <= item.rect.right + 1 && r.top >= item.rect.top - 1 && r.bottom <= item.rect.bottom + 1), `event toolbar text outside button: ${JSON.stringify(item)}`);
  }
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  await page.getByLabel('More actions').click();
  await page.getByRole('button', {name:'Studio', exact:true}).click();
  await page.evaluate(() => { document.documentElement.style.zoom = '1.5'; });
  await page.getByRole('button', {name:'Save to Library', exact:true}).click();
  const dialogBounds = await page.getByText('บันทึกเข้าคลัง — เจ้าของเสียง').evaluate(el => {
    const panel = el.closest('.fixed').firstElementChild;
    const rect = panel.getBoundingClientRect();
    return {top: rect.top, bottom: rect.bottom, viewport: window.innerHeight};
  });
  assert.ok(dialogBounds.top >= 0 && dialogBounds.bottom <= dialogBounds.viewport, `zoomed dialog outside viewport: ${JSON.stringify(dialogBounds)}`);
  const dialog = page.getByText('บันทึกเข้าคลัง — เจ้าของเสียง').locator('xpath=ancestor::div[contains(@class, "fixed")]');
  for (const name of ['ชื่อเจ้าของเสียง (voice owner)', 'ชื่อเกม', 'ประเภทไฟล์', 'ความละเอียด']) {
    assert.equal(await dialog.getByLabel(name, {exact: true}).count(), 1, `missing accessible label: ${name}`);
  }
  assert.equal(await dialog.getByRole('textbox', {name: 'ชื่อ ENG คลิป 1', exact: true}).count(), 1, 'clip filename needs an accessible name');
  const close = dialog.getByRole('button', {name: 'ปิด', exact: true});
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'ยกเลิก', 'reverse Tab should wrap within the dialog');
  await page.keyboard.press('Tab');
  assert.equal(await close.evaluate(el => el === document.activeElement), true, 'Tab should wrap within the dialog');
  const save = dialog.getByRole('button', {name: 'Save', exact: true});
  const saveBox = await save.boundingBox();
  assert.ok(saveBox && saveBox.y >= 0 && saveBox.y + saveBox.height <= 600, 'dialog save button is unreachable');
  const lastName = dialog.locator('input').last();
  await lastName.scrollIntoViewIfNeeded();
  assert.ok(await lastName.isVisible(), 'last clip name is unreachable');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), false, 'Escape should close the library dialog');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Save to Library', 'focus should return to the opening control');
  console.log(`PASS zoomed populated dialog at browser DPR ${scale}`);
  await page.evaluate(async () => {
    document.documentElement.style.zoom = '';
    const {useStudioStore} = await import('/src/store/useStudioStore.ts');
    useStudioStore.setState({view:'profile', gmaidenConnected:true, gmaidenPath:'C:/fixture/' + 'long-path/'.repeat(20), packs:[], activePackId:null});
  });
  for (const label of ['G-Maiden Connected', 'ติดตั้ง .gann', 'เพิ่ม Pack']) {
    const box = await page.getByRole('button', {name:label, exact:true}).boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 960, `Profile action outside viewport: ${label} ${JSON.stringify(box)}`);
    const usable = await page.getByRole('button', {name:label, exact:true}).evaluate(el => {
      const rect = el.getBoundingClientRect();
      const panel = el.closest('.overflow-y-auto').getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let textFits = true;
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(walker.currentNode);
        if (range.getClientRects().length > 1) textFits = false;
        for (const part of range.getClientRects()) if (part.left < rect.left - 1 || part.right > rect.right + 1 || part.top < rect.top - 1 || part.bottom > rect.bottom + 1) textFits = false;
      }
      return rect.left >= panel.left && rect.right <= panel.right && (hit === el || el.contains(hit)) && textFits;
    });
    assert.equal(usable, true, `Profile action clipped or covered: ${label}`);
  }
  const quickPlay = await page.getByText('Quick Play', {exact:true}).boundingBox();
  assert.ok(quickPlay && quickPlay.x + quickPlay.width <= 960, `Quick Play outside viewport: ${JSON.stringify(quickPlay)}`);
  console.log(`PASS compact connected Profile at browser DPR ${scale}`);
  await context.close();
 }
} finally { if (browser) await browser.close(); server.kill(); }
