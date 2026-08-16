// Stanowisko pomiarowe odczytu paragonów.
//
// PO CO: prompt w `functions/receipt-prompt.js` jest najczęściej strojonym elementem całej
// funkcji, a do tej pory jedynym sposobem sprawdzenia zmiany było wgranie funkcji i ręczne
// zrobienie zdjęcia. To narzędzie woła model DOKŁADNIE tak samo jak `parseReceipt`
// (ten sam prompt, ten sam format odpowiedzi, ta sama temperatura), przepuszcza wynik przez
// to samo sito `normalizeReceipt` co przeglądarka i porównuje z ręcznie spisanym wzorcem.
// Dzięki temu zmianę promptu widać w liczbach, a nie w odczuciach.
//
// UŻYCIE:
//   node tools/receipt-bench.mjs --fetch            # pobiera korpus zdjęć (raz)
//   node tools/receipt-bench.mjs                    # mierzy na pobranym korpusie
//   node tools/receipt-bench.mjs --model anthropic/claude-sonnet-5
//   node tools/receipt-bench.mjs --dir <katalog> --only r004,r012 --no-golden
//
// Korpus to czternaście zdjęć paragonów z Wikimedia Commons (wolne licencje) dobranych tak,
// żeby uderzać w konkretne pułapki: polskie PTU, rabat już wliczony w cenę, kaucja za
// butelkę, podatek doliczany po amerykańsku, zdjęcie obrócone o 90 stopni, obce języki
// i dwa zdjęcia, które paragonem NIE SĄ. Wzorce (`tools/receipt-corpus.json`) spisano
// ręcznie ze zdjęć w pełnej rozdzielczości; adresy źródeł są przy każdym wpisie, więc
// `--fetch` odtwarza korpus bez trzymania zdjęć w repozytorium.
//
// KLUCZ: zmienna OPEN_ROUTER_API_KEY albo OPENROUTER_API_KEY; wczytywany też z pliku .env
// wskazanego przez --env (domyślnie szukany w katalogu projektu i katalogu nadrzędnym).
// Klucz nie jest nigdzie wypisywany.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RECEIPT_SYSTEM_PROMPT, receiptUserPrompt } from '../functions/receipt-prompt.js';
import { normalizeReceipt } from '../src/receipt.js';
import { toGrosze } from '../functions/calc.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// ------------------------------------------------------------------ argumenty
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const CORPUS_FILE = path.join(HERE, 'receipt-corpus.json');
// Zdjęcia leżą poza repozytorium (są w .gitignore) — odtwarza je `--fetch`.
const DIR = arg('dir') || path.join(HERE, 'receipt-corpus');
const MODEL = arg('model', 'google/gemini-3.1-flash-lite');
const OUT = arg('out');
const ONLY = arg('only') ? new Set(arg('only').split(',').map((s) => s.trim())) : null;
const CONCURRENCY = Number(arg('concurrency', '4')) || 4;
const USE_GOLDEN = !flag('no-golden');

// ------------------------------------------------------------------ pobranie korpusu
// Zdjęcia nie leżą w repozytorium (kilkanaście megabajtów cudzych fotografii), tylko
// odtwarzają się z adresów zapisanych przy wzorcach. Commons odcina przy zbyt szybkim
// tempie, więc pobieramy po kolei z odstępem.
if (flag('fetch')) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(DIR, { recursive: true });
  const corpus = JSON.parse(await readFile(CORPUS_FILE, 'utf8'));
  const entries = Object.entries(corpus).filter(([k, v]) => !k.startsWith('_') && v._source);
  const UA = { 'User-Agent': 'BilliadaReceiptBench/1.0 (audyt odczytu paragonow)' };
  let ok = 0;
  for (const [file, meta] of entries) {
    const target = path.join(DIR, file);
    if (existsSync(target)) { ok++; process.stdout.write('='); continue; }
    let saved = false;
    for (let attempt = 0; attempt < 3 && !saved; attempt++) {
      try {
        const res = await fetch(meta._source, { headers: UA });
        if (res.status === 429) { await new Promise((r) => setTimeout(r, 8000)); continue; }
        if (!res.ok) break;
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(target, buf);
        saved = true; ok++; process.stdout.write('.');
      } catch { await new Promise((r) => setTimeout(r, 2000)); }
    }
    if (!saved) console.log(`\n  nie udalo sie: ${file} (${meta._source})`);
    await new Promise((r) => setTimeout(r, 1200));
  }
  console.log(`\nKorpus: ${ok}/${entries.length} zdjec w ${DIR}`);
  process.exit(ok === entries.length ? 0 : 1);
}

// ------------------------------------------------------------------ klucz
const loadKey = async () => {
  const fromEnv = process.env.OPEN_ROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  if (fromEnv) return fromEnv.trim();
  const candidates = [arg('env'), path.join(ROOT, '.env'), path.join(ROOT, '..', '.env'),
    path.join(ROOT, 'functions', '.secret.local')].filter(Boolean);
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = await readFile(file, 'utf8');
    const m = text.match(/^\s*(?:OPEN_ROUTER_API_KEY|OPENROUTER_API_KEY)\s*=\s*"?([^"\r\n]+)"?/m);
    if (m) return m[1].trim();
  }
  return null;
};

// ------------------------------------------------------------------ zdjęcia
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

// Aplikacja wysyła zdjęcie zmniejszone do 1600 px dłuższego boku i przekodowane na JPEG 0.85.
// Odtwarzamy to, gdy w systemie jest `sharp` — inaczej pomiar byłby zbyt optymistyczny,
// bo model dostawałby ostrzejszy obraz niż w aplikacji.
let sharp = null;
try { ({ default: sharp } = await import('sharp')); } catch { /* opcjonalne */ }

const toDataUrl = async (file) => {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext];
  if (!mime) return null;
  const buf = await readFile(file);
  if (sharp) {
    const out = await sharp(buf).rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 }).toBuffer();
    return `data:image/jpeg;base64,${out.toString('base64')}`;
  }
  return `data:${mime};base64,${buf.toString('base64')}`;
};

// ------------------------------------------------------------------ wywołanie modelu
const callModel = async (key, dataUrls, hint) => {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: RECEIPT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: receiptUserPrompt(hint) },
          ...dataUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 4000,
  };
  const started = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'BilliadaBench' },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - started;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: `HTTP ${res.status}: ${text.slice(0, 200)}`, ms };
  }
  const payload = await res.json();
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) return { error: 'pusta odpowiedź modelu', ms };
  // To samo wyłuskanie JSON-a co w `parseReceipt` — narzędzie ma mierzyć tę samą ścieżkę,
  // po której idzie aplikacja, łącznie z odpornością na model odpowiadający prozą.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parseLoose = (s) => {
    try { return JSON.parse(s); } catch { /* niżej */ }
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(s.slice(first, last + 1)); } catch { /* niżej */ }
    }
    return null;
  };
  const parsed = parseLoose(cleaned);
  if (!parsed || typeof parsed !== 'object') {
    return { error: `odpowiedź nie jest JSON-em: ${cleaned.slice(0, 200)}`, ms };
  }
  return { raw: parsed, usage: payload.usage || {}, ms };
};

// ------------------------------------------------------------------ ocena
// Dopasowanie pozycji po KWOCIE (nazwa bywa inaczej rozwinięta, kwota nie kłamie).
// Zwraca liczbę trafień oraz listy nadmiarowych i brakujących.
const matchItems = (got, want) => {
  const pool = want.map((w) => ({ ...w, used: false }));
  const hits = [];
  const extra = [];
  for (const g of got) {
    const gG = toGrosze(g.amount);
    const idx = pool.findIndex((w) => !w.used && toGrosze(w.amount) === gG);
    if (idx >= 0) { pool[idx].used = true; hits.push({ got: g, want: pool[idx] }); }
    else extra.push(g);
  }
  return { hits, extra, missing: pool.filter((w) => !w.used) };
};

const scoreOne = (norm, golden) => {
  const wantItems = golden.items || [];
  const { hits, extra, missing } = matchItems(norm.items, wantItems);
  const precision = norm.items.length ? hits.length / norm.items.length : (wantItems.length ? 0 : 1);
  const recall = wantItems.length ? hits.length / wantItems.length : 1;
  const f1 = (precision + recall) ? (2 * precision * recall) / (precision + recall) : 0;

  const gotTotalG = toGrosze(norm.itemsTotal);
  const wantTotalG = wantItems.reduce((s, i) => s + toGrosze(i.amount), 0);

  // Modyfikatory oceniamy po SKUTKU FINANSOWYM, nie po nazwie: liczy się to, ile złotych
  // model dołożył do rachunku. Podatek wliczony błędnie doliczony = realne zawyżenie.
  const gotModG = norm.modifiers.reduce(
    (s, m) => s + (m.type === 'percent' ? Math.round(gotTotalG * m.value / 100) : toGrosze(m.value)), 0);
  const wantModG = (golden.modifiers || []).reduce(
    (s, m) => s + (m.type === 'percent' ? Math.round(wantTotalG * m.value / 100) : toGrosze(m.value)), 0);

  const gotReceiptG = norm.receiptTotal ? toGrosze(norm.receiptTotal) : 0;
  const wantReceiptG = golden.receiptTotal ? toGrosze(golden.receiptTotal) : 0;

  // Kwota, o którą pomyliłby się rachunek — najważniejsza liczba w całym pomiarze.
  const finalErrG = Math.abs((gotTotalG + gotModG) - (wantTotalG + wantModG));

  return {
    itemsGot: norm.items.length,
    itemsWant: wantItems.length,
    hits: hits.length,
    extra: extra.map((i) => `${i.description} ${i.amount}`),
    missing: missing.map((i) => `${i.description ?? ''} ${i.amount}`),
    precision, recall, f1,
    itemsTotalGot: gotTotalG / 100,
    itemsTotalWant: wantTotalG / 100,
    itemsTotalErr: Math.abs(gotTotalG - wantTotalG) / 100,
    modifiersGot: norm.modifiers.map((m) => `${m.description} ${m.type === 'percent' ? m.value + '%' : m.value}`),
    modifiersWant: (golden.modifiers || []).map((m) => `${m.description} ${m.type === 'percent' ? m.value + '%' : m.value}`),
    modifiersErr: Math.abs(gotModG - wantModG) / 100,
    receiptTotalGot: gotReceiptG / 100,
    receiptTotalWant: wantReceiptG / 100,
    receiptTotalOk: wantReceiptG ? Math.abs(gotReceiptG - wantReceiptG) <= 2 : null,
    currencyGot: norm.currency,
    currencyWant: golden.currency ?? null,
    currencyOk: golden.currency ? norm.currency === golden.currency : null,
    finalErr: finalErrG / 100,
    perfect: finalErrG <= 2 && hits.length === wantItems.length && norm.items.length === wantItems.length,
  };
};

// ------------------------------------------------------------------ przebieg
const key = await loadKey();
if (!key) {
  console.error('Brak klucza. Ustaw OPEN_ROUTER_API_KEY albo wskaż plik przez --env.');
  process.exit(1);
}

let golden = {};
if (USE_GOLDEN) {
  // Wzorce mieszkają w repozytorium obok narzędzia; w katalogu ze zdjęciami można je nadpisać.
  const local = path.join(DIR, 'golden.json');
  const gp = existsSync(local) ? local : CORPUS_FILE;
  if (!existsSync(gp)) {
    console.error(`Brak wzorców (${gp}). Użyj --no-golden, żeby tylko odczytać bez oceny.`);
    process.exit(1);
  }
  golden = JSON.parse(await readFile(gp, 'utf8'));
}

if (!existsSync(DIR)) {
  console.error(`Brak katalogu ${DIR}. Uruchom najpierw: node tools/receipt-bench.mjs --fetch`);
  process.exit(1);
}

const files = (await readdir(DIR))
  .filter((f) => MIME[path.extname(f).toLowerCase()])
  .filter((f) => !ONLY || ONLY.has(path.basename(f, path.extname(f))))
  .filter((f) => !USE_GOLDEN || golden[f])
  .sort();

if (!files.length) {
  console.error('Brak zdjęć do przetworzenia.');
  process.exit(1);
}

console.log(`Model: ${MODEL}`);
console.log(`Zdjęć: ${files.length}${sharp ? ' (skalowane jak w aplikacji: 1600 px, JPEG 85)' : ' (BEZ skalowania — brak sharp, wynik lekko optymistyczny)'}`);
console.log('');

const results = [];
let cursor = 0;
const worker = async () => {
  while (cursor < files.length) {
    const file = files[cursor++];
    const g = golden[file] || {};
    const url = await toDataUrl(path.join(DIR, file));
    const out = await callModel(key, [url], g.hint);
    if (out.error) {
      results.push({ file, error: out.error, ms: out.ms });
      process.stdout.write('E');
      continue;
    }
    const norm = normalizeReceipt(out.raw);
    const entry = { file, ms: out.ms, usage: out.usage, raw: out.raw, normalized: norm };
    if (USE_GOLDEN && g.items) entry.score = scoreOne(norm, g);
    results.push(entry);
    process.stdout.write(entry.score ? (entry.score.perfect ? '+' : '.') : '.');
  }
};
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
results.sort((a, b) => a.file.localeCompare(b.file));

// ------------------------------------------------------------------ raport
console.log('\n');
const scored = results.filter((r) => r.score);
const failed = results.filter((r) => r.error);

if (USE_GOLDEN && scored.length) {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (v, n = 6, d = 2) => String(v.toFixed(d)).padStart(n);
  console.log(pad('plik', 12) + pad('poz.', 10) + pad('trafn.', 8) + pad('bl.poz', 9) + pad('bl.mod', 9) + pad('BLAD', 9) + 'suma');
  console.log('-'.repeat(66));
  for (const r of scored) {
    const s = r.score;
    console.log(
      pad(r.file, 12)
      + pad(`${s.itemsGot}/${s.itemsWant}`, 10)
      + pad(num(s.f1 * 100, 4, 0) + '%', 8)
      + pad(num(s.itemsTotalErr), 9)
      + pad(num(s.modifiersErr), 9)
      + pad(num(s.finalErr), 9)
      + (s.receiptTotalOk === false ? 'suma ZLA' : s.receiptTotalOk === true ? 'ok' : '-'),
    );
  }
  const avg = (f) => scored.reduce((s, r) => s + f(r.score), 0) / scored.length;
  const perfect = scored.filter((r) => r.score.perfect).length;
  const within2gr = scored.filter((r) => r.score.finalErr <= 0.02).length;
  const currOk = scored.filter((r) => r.score.currencyOk === true).length;
  const currAll = scored.filter((r) => r.score.currencyOk !== null).length;
  console.log('-'.repeat(66));
  console.log(`ODCZYTY BEZBLEDNE      : ${perfect}/${scored.length} (${(perfect / scored.length * 100).toFixed(0)}%)`);
  console.log(`KWOTA KONCOWA CO DO GR : ${within2gr}/${scored.length} (${(within2gr / scored.length * 100).toFixed(0)}%)`);
  console.log(`Srednia trafnosc pozycji (F1): ${(avg((s) => s.f1) * 100).toFixed(1)}%`);
  console.log(`Sredni blad kwoty koncowej   : ${avg((s) => s.finalErr).toFixed(2)}`);
  console.log(`Waluta                       : ${currOk}/${currAll}`);
  const toks = results.filter((r) => r.usage).reduce((s, r) => s + (r.usage.total_tokens || 0), 0);
  const ms = results.reduce((s, r) => s + (r.ms || 0), 0) / results.length;
  console.log(`Tokeny razem: ${toks} | sredni czas odczytu: ${(ms / 1000).toFixed(1)} s`);
}
if (failed.length) {
  console.log(`\nBLEDY (${failed.length}):`);
  failed.forEach((r) => console.log(`  ${r.file}: ${r.error}`));
}

const outFile = OUT || path.join(DIR, `bench-${MODEL.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}.json`);
await writeFile(outFile, JSON.stringify({ model: MODEL, when: new Date().toISOString(), results }, null, 2));
console.log(`\nPelny raport: ${outFile}`);

// ------------------------------------------------------------------
// FORMAT golden.json — wzorce spisane RĘCZNIE ze zdjęcia, nigdy z odpowiedzi modelu:
//
// {
//   "r001.jpg": {
//     "currency": "PLN",
//     "hint": "restauracja",                        // opcjonalny kontekst, jak w aplikacji
//     "items":     [{ "description": "Pizza", "amount": 42.00 }],
//     "modifiers": [{ "description": "Napiwek", "type": "amount", "value": 10.00 }],
//     "receiptTotal": 52.00
//   }
// }
//
// Modyfikator WLICZONY w ceny (polskie „PTU", „w tym VAT") NIE należy do wzorca —
// oczekujemy, że model go pominie. Doliczany („Sales Tax") należy, ze znakiem dodatnim;
// rabat ze znakiem ujemnym.
