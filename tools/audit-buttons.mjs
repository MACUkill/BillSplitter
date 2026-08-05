// Audyt martwych przycisków.
//
// Klika po kolei każdy widoczny przycisk na danym ekranie i sprawdza, czy cokolwiek
// się zmieniło: otwarte okno, zmiana ekranu, zmiana treści, toast, błąd w konsoli.
// Przycisk, po którym nie dzieje się NIC, jest kandydatem na martwy — w aplikacji
// o cudzych pieniądzach cicha awaria jest najgorszym rodzajem błędu.
import puppeteer from 'puppeteer';

const URL = 'http://localhost:5173/';
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

// Odcisk stanu: wszystko, co przycisk w tej aplikacji może realnie zmienić —
// ekran, okno, motyw, przewinięcie, stany przełączników, zwinięte sekcje, treść.
// Bez tego przycisk przewijający do sekcji albo przełączający motyw wyglądał
// na martwy, bo długość znaczników się nie zmieniała.
const SNAPSHOT = `(() => ({
  screen: [...document.querySelectorAll('[id$="-screen"]')].find(s => !s.classList.contains('hidden'))?.id || '?',
  modal: document.querySelector('.modal.active')?.id || '',
  len: document.body.innerHTML.length,
  toast: document.getElementById('toast-notification')?.textContent || '',
  url: location.search,
  theme: document.documentElement.dataset.theme || '',
  scroll: Math.round(window.scrollY / 20),
  pressed: [...document.querySelectorAll('[aria-pressed],[aria-current]')].map(e => (e.id || e.className) + ':' + (e.getAttribute('aria-pressed') || e.getAttribute('aria-current'))).join('|'),
  hidden: [...document.querySelectorAll('#settlements-content,#summary-content,#participants-checklist-modal,#nudges-bell,#install-pwa-btn,#ios-install-hint')].map(e => e.id + ':' + e.classList.contains('hidden')).join('|'),
  focus: document.activeElement?.id || document.activeElement?.tagName || '',
}))()`;

const run = async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });

  const click = async (sel) => {
    await page.waitForSelector(sel, { visible: true, timeout: 8000 });
    await page.evaluate((s) => document.querySelector(s).click(), sel);
  };
  const type = async (sel, text) => {
    await page.waitForSelector(sel, { visible: true, timeout: 8000 });
    await page.focus(sel);
    await page.keyboard.type(text);
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- Przygotowanie danych: grupa, rachunek, pozycje ---
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#start-screen:not(.hidden)', { timeout: 15000 });
  await type('#group-name', 'Test przycisków');
  for (const n of ['Michał', 'Kasia', 'Bartek']) { await type('#member-name-input', n); await click('#add-member-btn'); }
  await click('#create-group-btn');
  await page.waitForSelector('#join-screen:not(.hidden), #group-dashboard-screen:not(.hidden)', { timeout: 15000 });
  if (await page.$('#join-screen:not(.hidden)')) {
    await click('#name-selection-list button');
    await page.waitForSelector('#group-dashboard-screen:not(.hidden)', { timeout: 15000 });
  }
  await wait(1200);
  const groupUrl = page.url();

  await click('#create-new-bill-btn');
  await wait(500);
  await type('#new-bill-name', 'Rachunek testowy');
  await wait(200);
  await click('#confirm-create-bill-btn');
  await page.waitForSelector('#bill-screen:not(.hidden)', { timeout: 15000 });
  await wait(800);
  await page.evaluate(() => { const el = document.getElementById('total-bill-amount'); el.value = '300'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await wait(900);
  await click('#add-shared-cost-btn');
  await wait(500);
  await type('#shared-cost-desc', 'Pozycja testowa');
  await type('#shared-cost-amount', '60');
  await click('#save-shared-cost');
  await wait(900);
  const billUrl = page.url();

  const report = [];

  const auditScreen = async (label, url, prepare) => {
    // Zbieramy listę selektorów PRZED klikaniem — po kliknięciu DOM potrafi się przerysować.
    await page.goto(url, { waitUntil: 'networkidle2' });
    await wait(2000);
    if (prepare) await prepare();
    await wait(500);

    const targets = await page.evaluate(() => {
      const vis = (el) => {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      return [...document.querySelectorAll('button')]
        .filter((el) => vis(el) && !el.disabled && !el.closest('.modal'))
        .map((el, i) => {
          el.dataset.auditIdx = String(i);
          return {
            idx: i,
            id: el.id || '',
            cls: (el.className || '').toString().slice(0, 40),
            text: (el.textContent || '').trim().slice(0, 28) || el.getAttribute('aria-label') || el.title || '(ikona)',
          };
        });
    });

    for (const t of targets) {
      const before = await page.evaluate(SNAPSHOT);
      const errsBefore = consoleErrors.length;
      const clicked = await page.evaluate((i) => {
        const el = document.querySelector(`[data-audit-idx="${i}"]`);
        if (!el) return false;
        el.click();
        return true;
      }, t.idx);
      if (!clicked) continue;
      await wait(700);
      const after = await page.evaluate(SNAPSHOT);

      const changed = before.screen !== after.screen || before.modal !== after.modal
        || Math.abs(before.len - after.len) > 20 || before.toast !== after.toast
        || before.url !== after.url || before.theme !== after.theme
        || before.scroll !== after.scroll || before.pressed !== after.pressed
        || before.hidden !== after.hidden || before.focus !== after.focus;
      const newErrors = consoleErrors.slice(errsBefore);

      if (!changed || newErrors.length) {
        report.push({ screen: label, button: t.text, id: t.id, cls: t.cls, martwy: !changed, bledy: newErrors });
      }

      // Sprzątanie po kliknięciu: zamykamy okno i wracamy na badany ekran.
      await page.evaluate(() => document.querySelectorAll('.modal.active').forEach((m) => m.classList.remove('active')));
      if (after.screen !== before.screen || after.url !== before.url) {
        await page.goto(url, { waitUntil: 'networkidle2' });
        await wait(1600);
        if (prepare) await prepare();
        await wait(400);
        await page.evaluate((list) => {
          const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          [...document.querySelectorAll('button')].filter((el) => vis(el) && !el.disabled && !el.closest('.modal'))
            .forEach((el, i) => { el.dataset.auditIdx = String(i); });
        }, null);
      }
    }
  };

  await auditScreen('pulpit', groupUrl);
  await auditScreen('profil', groupUrl, async () => { await click('#nav-me'); await wait(900); });
  await auditScreen('rachunek', billUrl);

  await browser.close();
  console.log(JSON.stringify({ podejrzane: report, bledyKonsoli: [...new Set(consoleErrors)] }, null, 2));
};

run().catch((e) => { console.error('AUDIT FAILED:', e.message); process.exit(1); });
