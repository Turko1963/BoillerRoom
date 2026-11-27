// Tel Aviv Stock Exchange: the companies people ask about, by Hebrew and English name, with their Yahoo symbol (.TA)
// and, for dual-listed shares, the New York counterpart. Yahoo cannot search in Hebrew, so names are matched here.
// Prices of .TA shares come from Yahoo in agorot; server/data/yahoo.js turns them into shekels.

// [TASE symbol, US counterpart or null, English names, Hebrew names]
const LIST = [
  ['TEVA.TA', 'TEVA', ['Teva'], ['טבע']],
  ['LUMI.TA', null, ['Leumi', 'Bank Leumi'], ['לאומי', 'בנק לאומי']],
  ['POLI.TA', null, ['Hapoalim', 'Bank Hapoalim'], ['הפועלים', 'בנק הפועלים', 'פועלים']],
  ['DSCT.TA', null, ['Discount', 'Israel Discount Bank'], ['דיסקונט', 'בנק דיסקונט']],
  ['MZTF.TA', null, ['Mizrahi', 'Mizrahi Tefahot'], ['מזרחי טפחות', 'מזרחי', 'טפחות']],
  ['FIBI.TA', null, ['First International', 'FIBI'], ['הבינלאומי', 'בינלאומי']],
  ['ESLT.TA', 'ESLT', ['Elbit', 'Elbit Systems'], ['אלביט', 'אלביט מערכות']],
  ['NICE.TA', 'NICE', ['NICE', 'Nice Systems'], ['נייס']],
  ['ICL.TA', 'ICL', ['ICL', 'Israel Chemicals'], ['כיל', 'כימיקלים לישראל']],
  ['TSEM.TA', 'TSEM', ['Tower', 'Tower Semiconductor'], ['טאואר']],
  ['NVMI.TA', 'NVMI', ['Nova'], ['נובה']],
  ['CAMT.TA', 'CAMT', ['Camtek'], ['קמטק']],
  ['ORA.TA', 'ORA', ['Ormat'], ['אורמת']],
  ['ENLT.TA', 'ENLT', ['Enlight'], ['אנלייט']],
  ['PERI.TA', 'PERI', ['Perion'], ['פריון']],
  ['KEN.TA', 'KEN', ['Kenon'], ['קנון']],
  ['BEZQ.TA', null, ['Bezeq'], ['בזק']],
  ['AZRG.TA', null, ['Azrieli'], ['עזריאלי']],
  ['MLSR.TA', null, ['Melisron'], ['מליסרון']],
  ['BIG.TA', null, ['Big Shopping Centers'], ['ביג']],
  ['AMOT.TA', null, ['Amot'], ['אמות']],
  ['ALHE.TA', null, ['Alony Hetz'], ['אלוני חץ']],
  ['DLEKG.TA', null, ['Delek Group', 'Delek'], ['דלק', 'קבוצת דלק']],
  ['NWMD.TA', null, ['NewMed', 'NewMed Energy'], ['ניו מד', 'ניומד']],
  ['ENOG.TA', null, ['Energean'], ['אנרג\'יאן', 'אנרגיאן']],
  ['OPCE.TA', null, ['OPC Energy', 'OPC'], ['או.פי.סי', 'אופיסי']],
  ['STRS.TA', null, ['Strauss'], ['שטראוס']],
  ['SAE.TA', null, ['Shufersal'], ['שופרסל']],
  ['SPEN.TA', null, ['Shapir'], ['שפיר']],
  ['SKBN.TA', null, ['Shikun & Binui', 'Shikun Binui'], ['שיכון ובינוי']],
  ['ELTR.TA', null, ['Electra'], ['אלקטרה']],
  ['HARL.TA', null, ['Harel'], ['הראל']],
  ['PHOE.TA', null, ['Phoenix'], ['הפניקס', 'פניקס']],
  ['CLIS.TA', null, ['Clal Insurance', 'Clal'], ['כלל ביטוח', 'כלל']],
  ['MGDL.TA', null, ['Migdal'], ['מגדל']],
  ['MMHD.TA', null, ['Menora', 'Menora Mivtachim'], ['מנורה', 'מנורה מבטחים']],
  ['ISCD.TA', null, ['Isracard'], ['ישראכרט']],
  ['ELAL.TA', null, ['El Al'], ['אל על']],
  ['FTAL.TA', null, ['Fattal'], ['פתאל']],
  ['TA35.TA', null, ['TA-35', 'TA 35', 'Tel Aviv 35'], ['תל אביב 35', 'ת"א 35', 'תא 35']]
];
// US companies and coins by their Hebrew name, so a Hebrew brief finds them too
const HE_GLOBAL = [
  ['AAPL', ['אפל']], ['NVDA', ['אנבידיה', 'אנווידיה', 'נבידיה']], ['TSLA', ['טסלה']], ['MSFT', ['מיקרוסופט']], ['AMZN', ['אמזון']],
  ['GOOGL', ['גוגל', 'אלפבית']], ['META', ['מטא', 'פייסבוק']], ['NFLX', ['נטפליקס']], ['INTC', ['אינטל']], ['AVGO', ['ברודקום']],
  ['PLTR', ['פלנטיר']], ['AMD', ['איי אם די', 'איי.אם.די']], ['JPM', ['ג\'יי פי מורגן', 'גיי פי מורגן']], ['KO', ['קוקה קולה']],
  ['BTC', ['ביטקוין', 'ביטכוין']], ['ETH', ['את\'ריום', 'איתריום', 'אתריום']], ['SOL', ['סולנה']], ['XRP', ['ריפל']], ['DOGE', ['דוג\'קוין', 'דוגקוין']],
  ['SPY', ['אס אנד פי', 'אס&פי', 'S&P 500']], ['QQQ', ['נאסד"ק', 'נאסדק']]
];
const CRYPTO = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'DOGE']);

export const BENCH = { symbol: 'TA35.TA', name: 'TA-35' };
const byTase = new Map(LIST.map(r => [r[0], r])), byUs = new Map(LIST.filter(r => r[1]).map(r => [r[1], r]));
const strip = s => String(s).replace(/[֑-ׇ]/g, '').replace(/[״”“]/g, '"').replace(/[׳’‘`]/g, "'");
// a Hebrew word may carry one attached prefix letter: "בטבע", "ולאומי", "שאלביט"
const heRe = name => new RegExp(`(^|[^\\u05D0-\\u05EA])[בהולמשכ]?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\u05D0-\\u05EA])`);
const enRe = name => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

export const isTase = symbol => /\.TA$/i.test(symbol || '');
/** Does the brief ask about Tel Aviv ("Tel Aviv", "TASE", "בורסה", "ת"א")? Then a dual-listed name means the .TA share. */
export const wantsTase = brief => /\b(tel[\s-]?aviv|tase)\b|בורס|תל[\s-]?אביב|ת"א|תא35/i.test(strip(brief));
/** The New York counterpart of a Tel Aviv share, or the Tel Aviv one of a US share: { symbol, tase } or null. */
export function counterpart(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (byTase.has(s)) return byTase.get(s)[1] ? { symbol: byTase.get(s)[1], tase: false } : null;
  if (byUs.has(s)) return { symbol: byUs.get(s)[0], tase: true };
  return null;
}
/** A Tel Aviv base ticker typed without ".TA" (LUMI, POLI): its .TA symbol, or null. */
// (only shares listed in Tel Aviv alone: TEVA typed alone is the New York share)
export const taseTicker = k => { const r = byTase.get(String(k).toUpperCase() + '.TA'); return r && !r[1] ? r[0] : null; };
/** Hebrew name in the brief -> { symbol, kind } (Tel Aviv first, then US companies and coins); null when none. */
export function fromHebrew(brief) {
  const b = strip(brief);
  if (!/[א-ת]/.test(b)) return null;
  // longest names first, so "בנק לאומי" wins over a shorter accidental match
  const all = [...LIST.flatMap(r => r[3].map(n => [n, r[0], 'stock'])), ...HE_GLOBAL.flatMap(([k, ns]) => ns.map(n => [n, k, CRYPTO.has(k) ? 'crypto' : 'stock']))].sort((x, y) => y[0].length - x[0].length);
  for (const [n, k, kind] of all) if (heRe(strip(n)).test(b)) return { symbol: k, kind };
  return null;
}
/** English company name of a Tel Aviv share in the brief ("Leumi", "Bank Hapoalim") -> .TA symbol, or null. */
export function fromEnglish(brief) {
  const all = LIST.flatMap(r => r[2].map(n => [n, r])).sort((x, y) => y[0].length - x[0].length);
  for (const [n, r] of all) if (enRe(n).test(brief)) return r[1] && !wantsTase(brief) ? null : r[0]; // dual-listed by English name: New York unless Tel Aviv is asked for
  return null;
}
export const NAMES = Object.fromEntries(LIST.map(r => [r[0], { en: r[2][0], he: r[3][0] }]));
export const SYMBOLS = LIST.map(r => r[0]);
