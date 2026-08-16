// Przebieg audytowy: prowadzi aplikację przez realną ścieżkę użycia w szerokości
// telefonu, zapisuje zrzuty każdego stanu i mierzy usterki układu, których nie widać
// w kodzie — wyjazd poza ekran, nachodzące się cele dotykowe, za małe przyciski.
import { mkdirSync } from 'node:fs';

import puppeteer from 'puppeteer';

const URL = 'http://localhost:5173/';

// Kontrakt responsywności z DESIGN.md wymaga czterech szerokości: 360 (mały telefon),
// 390 (odniesienie), 834 (tablet) i 1280 (desktop). Szerokość jest drugim argumentem:
//   node tools/audit-layout.mjs ./shots 834
// Zrzuty każdej szerokości lądują w osobnym podkatalogu, więc przebiegi się nie nadpisują.
const WIDTH = Number(process.argv[3]) || 390;
const TOUCH = WIDTH < 1024; // desktop dostaje mysz, telefon i tablet palec
const HEIGHT = Number(process.argv[4]) || (WIDTH >= 1024 ? 800 : WIDTH >= 768 ? 1112 : 844);

const OUT = `${process.argv[2] || './shots'}/w${WIDTH}`;
mkdirSync(OUT, { recursive: true });

const VIEWPORT = {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: TOUCH ? 2 : 1,
  isMobile: TOUCH,
  hasTouch: TOUCH,
};

const AUDIT = `(() => {
  const vw = document.documentElement.clientWidth;
  // Przewijanie w poziomie sprawdzamy na kontenerze, który realnie przewija.
  // Na dokumencie ta miara od 2026-08-16 zawsze pokazuje „nie ma", bo dokument ma
  // ukryte przepełnienie — sprawdzanie go dawałoby fałszywe „czysto".
  // (Ten blok mieszka w literale ze znacznikami wstecznymi, więc w komentarzach
  //  wewnątrz niego nie wolno użyć ani jednego takiego znaku.)
  const scRoot = document.getElementById('app-scroll') || document.documentElement;
  const out = { overflow: [], smallTaps: [], overlaps: [], covered: [], scrollX: scRoot.scrollWidth > vw + 1 };

  // PROSTOKĄT PO PRZYCIĘCIU, nie surowy.
  //
  // getBoundingClientRect zwraca miejsce, w którym element BYŁBY, gdyby nic go nie
  // przycinało. W arkuszu z przewijaną treścią to nieprawda: wiersz listy wyprzewinięty
  // pod stopkę nadal ma tam współrzędne, choć żaden jego piksel się tam nie maluje.
  // Bez tego audyt zgłaszał nachodzenie wiersza na przyciski stopki i krzyżyka na pole
  // waluty — dwie usterki, których na ekranie nie ma. Pogoń za takim zgłoszeniem kończy
  // się psuciem układu, który był w porządku.
  //
  // (Uwaga dla przyszłych zmian: ten blok żyje w SZABLONIE ZNAKOWYM, więc apostrof
  // odwrotny jest tu zakazany — zamyka literał i wywala cały skrypt.)
  const clippedRect = (el) => {
    let r = el.getBoundingClientRect();
    let box = { top: r.top, right: r.right, bottom: r.bottom, left: r.left };
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const ps = getComputedStyle(p);
      const clipsY = ps.overflowY === 'auto' || ps.overflowY === 'scroll' || ps.overflowY === 'hidden';
      const clipsX = ps.overflowX === 'auto' || ps.overflowX === 'scroll' || ps.overflowX === 'hidden';
      if (!clipsY && !clipsX) continue;
      const pr = p.getBoundingClientRect();
      if (clipsY) { box.top = Math.max(box.top, pr.top); box.bottom = Math.min(box.bottom, pr.bottom); }
      if (clipsX) { box.left = Math.max(box.left, pr.left); box.right = Math.min(box.right, pr.right); }
    }
    box.width = box.right - box.left;
    box.height = box.bottom - box.top;
    return box;
  };

  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    // Treść ZWINIĘTEGO <details> nie jest malowana, ale Chrome i tak zwraca dla niej
    // prostokąt: chowa ją przez content-visibility, a nie przez display none.
    const details = el.closest('details');
    if (details && !details.open && !el.closest('summary')) return false;
    const r = clippedRect(el);
    return r.width > 1 && r.height > 1;
  };

  // Element w rzędzie przewijanym w poziomie MA prawo wystawać poza ekran —
  // na tym polega rząd pigułek filtrów. Usterką jest wyjazd treści, której nie da
  // się dosunąć palcem, więc pytamy o przodka z własnym przewijaniem w poziomie.
  const inHorizontalScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      const scrolls = s.overflowX === 'auto' || s.overflowX === 'scroll';
      if (scrolls && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };

  // 1. Cokolwiek wystaje poza prawą krawędź ekranu.
  for (const el of document.querySelectorAll('#app-container *, .deck, .modal.active *')) {
    if (!visible(el)) continue;
    if (inHorizontalScroller(el)) continue;
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
  //    Obszar trafienia bywa większy od samego elementu: klasa hit-44 rozpycha go
  //    warstwą ::after. Mierzymy więc obszar realny, inaczej narzędzie zgłasza
  //    jako usterkę coś, co zostało naprawione właśnie tą techniką.
  const hitBox = (el) => {
    // Pole wyboru owinięte etykietą klika się całą etykietą — realnym celem jest
    // wiersz, nie kwadracik. Bez tego lista uczestników zgłasza kilkanaście
    // rzekomych usterek, choć palec trafia w cały wiersz.
    const label = el.closest('label');
    const box = label && label.contains(el) ? label : el;
    const r = box.getBoundingClientRect();
    let w = r.width, h = r.height;
    for (const pseudo of ['::after', '::before']) {
      const s = getComputedStyle(box, pseudo);
      if (!s || s.content === 'none' || s.position === 'static') continue;
      if (getComputedStyle(box).pointerEvents === 'none' || s.pointerEvents === 'none') continue;
      w = Math.max(w, parseFloat(s.width) || 0);
      h = Math.max(h, parseFloat(s.height) || 0);
    }
    return { w, h, r };
  };

  const tappables = [...document.querySelectorAll('button, a, select, input[type=radio], input[type=checkbox], [role=button]')];
  for (const el of tappables) {
    if (!visible(el)) continue;
    const { w, h } = hitBox(el);
    if (h < 44 || w < 44) {
      out.smallTaps.push({
        cls: (el.className || '').toString().slice(0, 50),
        text: (el.textContent || '').trim().slice(0, 30) || el.getAttribute('aria-label') || el.title || '',
        w: Math.round(w), h: Math.round(h),
      });
    }
  }

  // 3. Nachodzące się cele dotykowe — dwa przyciski w tym samym miejscu znaczą,
  //    że jeden z nich jest nieklikalny albo klika się przypadkiem.
  //    Przycisk w otwartym oknie leży NAD treścią strony, więc każda para
  //    „okno vs tło" nachodzi z definicji i nie jest usterką. Porównujemy
  //    wyłącznie elementy z tej samej warstwy.
  const layer = (el) => (el.closest('.modal.active') ? 'modal' : el.closest('.deck') ? 'deck' : 'page');
  // Porównujemy prostokąty PO PRZYCIĘCIU: nachodzenie liczy się na pikselach, które
  // naprawdę się malują, a nie na miejscu, w którym element leżałby bez przewijania.
  const boxes = tappables.filter(visible).map((el) => ({ el, r: clippedRect(el), layer: layer(el) }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      // Okno ma zasłonę i wyłącza tło — para „okno vs strona" nie jest usterką.
      const mixed = a.layer !== b.layer;
      if (mixed && (a.layer === 'modal' || b.layer === 'modal')) continue;
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox > 4 && oy > 4) {
        // Pasek nawigacji PŁYWA nad treścią i przy przewijaniu przechodzi nad
        // wszystkim po kolei — samo chwilowe nachodzenie nie jest usterką, bo
        // wystarczy przewinąć. Usterką jest treść, której spod paska WYJĄĆ SIĘ
        // NIE DA: taka, która przy końcu przewijania nadal siedzi pod paskiem.
        if (mixed) continue;
        out.overlaps.push({
          a: ((a.el.textContent || '').trim().slice(0, 24) || a.el.className.toString().slice(0, 24)),
          b: ((b.el.textContent || '').trim().slice(0, 24) || b.el.className.toString().slice(0, 24)),
          area: Math.round(ox * oy),
        });
      }
    }
  }

  // 4. Treść uwięziona pod paskiem. Liczymy w układzie dokumentu, nie ekranu:
  //    gdzie stanie pasek, gdy strona dojedzie do końca przewijania, i co wtedy
  //    zostanie pod nim. To jest jedyne nachodzenie z paskiem, którego użytkownik
  //    nie może rozwiązać ruchem palca.
  const deckEl = document.querySelector('.deck');
  if (deckEl && visible(deckEl) && !document.querySelector('.modal.active')) {
    const deckR = deckEl.getBoundingClientRect();
    // Przewija się kontener o identyfikatorze app-scroll, a nie dokument (patrz komentarz
    // przy nim w znacznikach), więc pozycję i zapas czytamy z niego: window.scrollY jest zerem.
    const sc = document.getElementById('app-scroll');
    const y = sc ? sc.scrollTop : (window.scrollY || 0);
    const maxScroll = sc
      ? Math.max(0, sc.scrollHeight - sc.clientHeight)
      : Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const bandTop = maxScroll + deckR.top;
    const bandBottom = maxScroll + deckR.bottom;
    for (const { el, r, layer } of boxes) {
      if (layer !== 'page') continue;
      const docTop = r.top + y, docBottom = r.bottom + y;
      const oy = Math.min(docBottom, bandBottom) - Math.max(docTop, bandTop);
      const ox = Math.min(r.right, deckR.right) - Math.max(r.left, deckR.left);
      if (ox > 4 && oy > 4) {
        out.covered.push({
          a: ((el.textContent || '').trim().slice(0, 24) || el.className.toString().slice(0, 24)),
          b: 'pasek nawigacji',
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
  await type('#join-code-input', 'AB12CD34');
  await new Promise((r) => setTimeout(r, 300));
  await shot('01a-start-kod');
  await page.evaluate(() => { const i = document.getElementById('join-code-input'); if (i) i.value = ''; });

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

  // Wybór osób w oknie nowego rachunku: te same wiersze, co przy pozycji paragonu,
  // plus lupa rozwijająca pole wyszukiwania.
  await click('#edit-participants-btn-modal');
  await new Promise((r) => setTimeout(r, 500));
  await shot('05a-nowy-rachunek-osoby');
  await page.evaluate(() => { const b = document.querySelector('#new-bill-people .person-search-toggle'); if (b) b.click(); });
  await new Promise((r) => setTimeout(r, 500));
  await type('#new-bill-people .person-search-input', 'kas');
  await new Promise((r) => setTimeout(r, 400));
  await shot('05b-nowy-rachunek-szukanie');
  await page.evaluate(() => { const b = document.querySelector('#new-bill-people .person-search-toggle'); if (b) b.click(); });
  await click('#edit-participants-btn-modal');
  await new Promise((r) => setTimeout(r, 400));

  await type('#new-bill-name', 'Kolacja w karczmie');
  await new Promise((r) => setTimeout(r, 300));
  await click('#confirm-create-bill-btn');
  await page.waitForSelector('#bill-screen:not(.hidden)', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));
  await shot('06-rachunek-pusty');

  // Wskazanie płatnika przechodzi przez okno potwierdzenia (decyzja o cudzych
  // pieniądzach nie wchodzi w życie samym stuknięciem w listę).
  await click('#payer-select');
  await new Promise((r) => setTimeout(r, 500));
  await shot('06a-wybor-platnika');
  await page.evaluate(() => { const b = document.querySelector('#choice-options .choice-option:nth-child(2)'); if (b) b.click(); });
  await new Promise((r) => setTimeout(r, 500));
  await shot('06b-potwierdzenie-platnika');
  await click('#confirm-ok-btn');
  await new Promise((r) => setTimeout(r, 900));

  // Kwota + płatnik.
  await page.evaluate(() => {
    const el = document.getElementById('total-bill-amount');
    el.value = '480';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 900));
  await shot('07-rachunek-kwota');

  // Rachunek startuje podziałem PO RÓWNO, więc sekcja pozycji jest schowana:
  // w tym trybie nie ma czego rozpisywać. Przełączamy na „ze swoimi kosztami",
  // żeby audyt zobaczył żywy paragon.
  await click('#bill-mode-own');
  await new Promise((r) => setTimeout(r, 900));
  await shot('07a-rachunek-tryb-wlasne-koszty');

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

  // Sam wydruk w kadrze. Audyt do 2026-08-16 fotografował ekran rachunku wyłącznie
  // od góry, więc bohater tego ekranu — paragon z ząbkowanymi krawędziami — nie trafiał
  // na żaden zrzut i zmiany w nim sprawdzało się wyłącznie okiem na telefonie.
  await page.evaluate(() => document.getElementById('items-section')?.scrollIntoView({ block: 'start' }));
  await new Promise((r) => setTimeout(r, 500));
  await shot('09a-paragon-w-kadrze');

  // Koszt wspólny.
  await click('#add-global-cost-btn');
  await new Promise((r) => setTimeout(r, 500));
  await shot('10-okno-koszt-wspolny');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));

  // Koszt wspólny zapisany: sekcja ma teraz nagłówek, zdanie o dzieleniu po równo
  // i wiersz z kwotą na osobę — czyli wszystko, czego audyt nie widział, dopóki
  // lista kosztów wspólnych była pusta.
  await click('#add-global-cost-btn');
  await new Promise((r) => setTimeout(r, 400));
  await type('#global-cost-value', '10');
  await click('#save-global-cost');
  await new Promise((r) => setTimeout(r, 900));
  await page.evaluate(() => document.getElementById('global-costs-section')?.scrollIntoView({ block: 'center' }));
  await new Promise((r) => setTimeout(r, 400));
  await shot('10a-koszty-wspolne');

  // Powrót na pulpit z danymi.
  await click('#back-to-dashboard-btn');
  await new Promise((r) => setTimeout(r, 1500));
  await shot('11-pulpit-z-rachunkiem');

  // Rozliczenia — własne miejsce w pasku, nie sekcja pulpitu.
  await click('#nav-settle');
  await new Promise((r) => setTimeout(r, 700));
  await shot('12-rozliczenia');

  // Rejestr wpłat: osobne miejsce spod rozliczeń. Przycisk pojawia się dopiero,
  // gdy jest choć jedna wpłata, więc najpierw ją zapisujemy.
  await page.evaluate(() => { const b = document.querySelector('#settlements-list .receive-btn'); if (b) b.click(); });
  await new Promise((r) => setTimeout(r, 700));
  if (await page.$('#settle-modal.active')) {
    await shot('12a-ureguluj');
    await click('#settle-record-btn');
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (await page.$('#open-settlements-log:not(.hidden)')) {
    await click('#open-settlements-log');
    await new Promise((r) => setTimeout(r, 700));
    await shot('12b-rejestr-wplat');
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 400));
  }

  // Rachunki — druga zakładka pulpitu.
  await click('#nav-bills');
  await new Promise((r) => setTimeout(r, 700));
  await shot('13-rachunki');

  // Skrzynka — arkusz spod dzwonka, oba segmenty.
  await click('#nav-room');
  await new Promise((r) => setTimeout(r, 400));
  await click('#nudges-bell');
  await new Promise((r) => setTimeout(r, 700));
  await shot('13a-skrzynka-dla-ciebie');
  await click('.inbox-mode-btn[data-inbox="all"]');
  await new Promise((r) => setTimeout(r, 500));
  await shot('13b-skrzynka-wszystko');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 400));

  // Ustawienia pokoju — arkusz spod nazwy pokoju.
  await click('#nav-room');
  await new Promise((r) => setTimeout(r, 500));
  await click('#room-settings-btn');
  await new Promise((r) => setTimeout(r, 700));
  await shot('14-ustawienia-pokoju');
  await click('#room-qr-toggle');
  await new Promise((r) => setTimeout(r, 600));
  await shot('14a-ustawienia-pokoju-qr');
  await page.evaluate(() => { const b = document.querySelector('#room-settings-modal .sheet-body'); if (b) b.scrollTop = b.scrollHeight; });
  await new Promise((r) => setTimeout(r, 500));
  await shot('14b-ustawienia-pokoju-dol');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));

  // Profil.
  await click('#nav-me');
  await new Promise((r) => setTimeout(r, 900));
  await shot('15-profil');

  // Znak: arkusz spod awatara, a z niego paleta kolorów.
  await click('#profile-mark-btn');
  await new Promise((r) => setTimeout(r, 700));
  await shot('15a-twoj-znak');
  await click('#profile-color-btn');
  await new Promise((r) => setTimeout(r, 700));
  await shot('15b-paleta-koloru');
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 500));

  // Motyw jasny — przełącznik mieszka w sekcji „Aplikacja" na ekranie profilu.
  await click('#theme-toggle-btn');
  await new Promise((r) => setTimeout(r, 700));
  await shot('16-profil-jasny');

  await click('#nav-room');
  await new Promise((r) => setTimeout(r, 700));
  await shot('17-pulpit-jasny');

  // Ekran rachunku w jasnym motywie: tam mieszka znak aplikacji.
  await click('#nav-bills');
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => { const c = document.querySelector('#bills-history-list .card'); if (c) c.click(); });
  await new Promise((r) => setTimeout(r, 1500));
  await shot('18-paragon-jasny');

  await browser.close();
  console.log(JSON.stringify({ viewport: `${WIDTH}x${HEIGHT}`, errors: [...new Set(errors)], findings }, null, 2));
};

run().catch((e) => { console.error('AUDIT FAILED:', e.message); process.exit(1); });
