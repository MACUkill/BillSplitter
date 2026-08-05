// Przebieg audytowy: prowadzi aplikację przez realną ścieżkę użycia w szerokości
// telefonu, zapisuje zrzuty każdego stanu i mierzy usterki układu, których nie widać
// w kodzie — wyjazd poza ekran, nachodzące się cele dotykowe, za małe przyciski.
import { mkdirSync } from 'node:fs';

import puppeteer from 'puppeteer';

const OUT = process.argv[2] || './shots';
const URL = 'http://localhost:5173/';
mkdirSync(OUT, { recursive: true });

// iPhone 14: najczęstsza szerokość, przy której ta aplikacja realnie pracuje.
const VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const AUDIT = `(() => {
  const vw = document.documentElement.clientWidth;
  const out = { overflow: [], smallTaps: [], overlaps: [], scrollX: document.documentElement.scrollWidth > vw + 1 };

  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // 1. Cokolwiek wystaje poza prawą krawędź ekranu.
  for (const el of document.querySelectorAll('#app-container *, .deck, .modal.active *')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) {
      out.overflow.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 60),
        text: (el.textContent || '').trim().slice(0, 40),
        left: Math.round(r.left), right: Math.round(r.right),
      });
    }
  }

  // 2. Cele dotykowe poniżej 44 px — próg obu platform.
  const tappables = [...document.querySelectorAll('button, a, select, input[type=radio], input[type=checkbox], [role=button]')];
  for (const el of tappables) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 44 || r.width < 44) {
      out.smallTaps.push({
        cls: (el.className || '').toString().slice(0, 50),
        text: (el.textContent || '').trim().slice(0, 30) || el.getAttribute('aria-label') || el.title || '',
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  }

  // 3. Nachodzące się cele dotykowe — dwa przyciski w tym samym miejscu znaczą,
  //    że jeden z nich jest nieklikalny albo klika się przypadkiem.
  const boxes = tappables.filter(visible).map((el) => ({ el, r: el.getBoundingClientRect() }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox > 4 && oy > 4) {
        out.overlaps.push({
          a: ((a.el.textContent || '').trim().slice(0, 24) || a.el.className.toString().slice(0, 24)),
          b: ((b.el.textContent || '').trim().slice(0, 24) || b.el.className.toString().slice(0, 24)),
          area: Math.round(ox * oy),
        });
      }
    }
  }
  return out;
})()`;

const run = async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  const findings = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${name}.png` });
    const a = await page.evaluate(AUDIT);
    findings.push({ screen: name, ...a });
  };

  // Aplikacja przerysowuje listy przy każdym zapisie z bazy, więc uchwyt do elementu
  // potrafi się zdezaktualizować między znalezieniem a kliknięciem. Klikamy więc przez
  // selektor w kontekście strony i próbujemy ponownie, gdy węzeł zniknie w międzyczasie.
  const click = async (sel) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.waitForSelector(sel, { visible: true, timeout: 8000 });
      const ok = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el || el.disabled) return false;
        el.click();
        return true;
      }, sel);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`Nie udało się kliknąć: ${sel}`);
  };
  const type = async (sel, text) => {
    await page.waitForSelector(sel, { visible: true, timeout: 8000 });
    await page.focus(sel);
    await page.keyboard.type(text);
  };

  await page.goto(URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#start-screen:not(.hidden)', { timeout: 15000 });
  await shot('01-start');

  // Zakładanie grupy: nazwa + czterech uczestników przez żetony.
  await type('#group-name', 'Wyjazd w Bieszczady');
  for (const name of ['Michał', 'Kasia', 'Bartek', 'Zosia']) {
    await type('#member-name-input', name);
    await click('#add-member-btn');
  }
  await shot('02-start-wypelnione');

  await click('#create-group-btn');
  await page.waitForSelector('#join-screen:not(.hidden), #group-dashboard-screen:not(.hidden)', { timeout: 15000 });

  if (await page.$('#join-screen:not(.hidden)')) {
    await shot('03-dolaczanie');
    await click('#name-selection-list button');
    await page.waitForSelector('#group-dashboard-screen:not(.hidden)', { timeout: 15000 });
  }
  await new Promise((r) => setTimeout(r, 1200));
  await shot('04-pulpit-pusty');

  // Nowy rachunek.
  await click('#create-new-bill-btn');
  await new Promise((r) => setTimeout(r, 500));
  await shot('05-okno-nowy-rachunek');
  await type('#new-bill-name', 'Kolacja w karczmie');
  await new Promise((r) => setTimeout(r, 300));
  await click('#confirm-create-bill-btn');
  await page.waitForSelector('#bill-screen:not(.hidden)', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));
  await shot('06-rachunek-pusty');

  // Kwota + płatnik.
  await page.evaluate(() => {
    const el = document.getElementById('total-bill-amount');
    el.value = '480';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 900));
  await shot('07-rachunek-kwota');

  // Pozycje przez okno „Dodaj pozycję".
  for (const [desc, amount] of [['Pierogi ruskie', '48'], ['Żurek w chlebie', '38'], ['Kotlet schabowy z frytkami', '56'], ['Woda gazowana duża', '18']]) {
    await click('#add-shared-cost-btn');
    await new Promise((r) => setTimeout(r, 400));
    await type('#shared-cost-desc', desc);
    await type('#shared-cost-amount', amount);
    await click('#save-shared-cost');
    await new Promise((r) => setTimeout(r, 600));
  }
  await new Promise((r) => setTimeout(r, 600));
  await shot('08-zywy-paragon');

  // Odklikanie pozycji: przez indeks w kontekście strony, bo lista przerysowuje się
  // po każdym zapisie i uchwyty puppeteera stają się nieaktualne.
  for (const idx of [0, 1]) {
    await page.evaluate((i) => { const l = document.querySelectorAll('.receipt-line')[i]; if (l) l.click(); }, idx);
    await new Promise((r) => setTimeout(r, 900));
  }
  await shot('09-paragon-moje-pozycje');

  // Koszt wspólny.
  await click('#add-global-cost-btn');
  await new Promise((r) => setTimeout(r, 500));
  await shot('10-okno-koszt-wspolny');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));

  // Powrót na pulpit z danymi.
  await click('#back-to-dashboard-btn');
  await new Promise((r) => setTimeout(r, 1500));
  await shot('11-pulpit-z-rachunkiem');

  // Profil.
  await click('#nav-me');
  await new Promise((r) => setTimeout(r, 900));
  await shot('12-profil');

  // Motyw jasny — przełącznik stoi w nagłówku pokoju, więc najpierw wracamy na pulpit.
  await click('#nav-room');
  await new Promise((r) => setTimeout(r, 700));
  await click('#theme-toggle-btn');
  await new Promise((r) => setTimeout(r, 700));
  await shot('13-pulpit-jasny');

  // Ekran rachunku w jasnym motywie: tam mieszka znak aplikacji.
  await page.evaluate(() => { const c = document.querySelector('#bills-history-list .card'); if (c) c.click(); });
  await new Promise((r) => setTimeout(r, 1500));
  await shot('14-paragon-jasny');

  await browser.close();
  console.log(JSON.stringify({ errors: [...new Set(errors)], findings }, null, 2));
};

run().catch((e) => { console.error('AUDIT FAILED:', e.message); process.exit(1); });
