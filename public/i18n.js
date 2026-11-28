/* Hebrew for both pages (the code screen and the room). One shared file, no build step.
 *
 *  window.I18N.lang          'en' or 'he' (remembered in localStorage, key bsc_lang)
 *  window.I18N.set(lang)     switch; the page flips to right-to-left and every text on it is translated in place
 *  window.I18N.t(text)       the Hebrew for one English text (exact phrases first, then sentence templates)
 *
 * How it works: the pages keep writing English. A MutationObserver translates text nodes and the title, placeholder and
 * aria-label attributes as they appear, and keeps the English so switching back restores it. Text the room types
 * letter by letter goes through I18N.t() before typing. The round's own text (desk reports, debate, memo) arrives
 * already in Hebrew from the server (POST /api/rounds with lang: 'he'). Numbers with a sign, % or a currency are wrapped
 * in left-to-right isolates so "+4.2%" never turns into "4.2%+" inside Hebrew.
 */
(function () {
  'use strict';
  var KEY = 'bsc_lang';
  var lang = 'en';
  try { lang = localStorage.getItem(KEY) === 'he' ? 'he' : 'en'; } catch (e) { /* private mode: English */ }

  /* ---------- exact phrases ---------- */
  var E = {
    // shared, header and the code screen
    'Boiler Room | BackStage Capital': 'Boiler Room | BackStage Capital',
    'by BackStage Capital': 'מבית BackStage Capital',
    'Private desk. Invited members only.': 'דסק פרטי. בהזמנה בלבד.',
    'Friends only.': 'חברים בלבד.',
    'Seven friends are waiting inside. Enter your six digit code to join them.': 'שבעה חברים מחכים בפנים. הקלידו את הקוד בן שש הספרות כדי להצטרף.',
    'Invitation only': 'בהזמנה בלבד',
    'Skip intro': 'דלגו על הפתיח',
    'Every market has a front stage.': 'לכל שוק יש במה קדמית.',
    'Could not reach the desk. Try again.': 'אין חיבור לדסק. נסו שוב.',
    'Not on the list': 'לא ברשימה',
    'Too many attempts. Try again in 15 minutes': 'יותר מדי ניסיונות. נסו שוב בעוד 15 דקות',
    'The members code is not set up on the server': 'קוד החברים לא הוגדר בשרת',
    'Sounds on': 'צלילים פועלים', 'Sounds off': 'צלילים כבויים', 'Sounds on or off': 'הפעלה או כיבוי של צלילים',
    'Sounds on or off (the volatility alert always rings)': 'הפעלה או כיבוי של צלילים (התראת התנודתיות מצלצלת תמיד)',
    'Sounds off. The volatility alert still rings': 'הצלילים כבויים. התראת התנודתיות עדיין תצלצל',
    'Language': 'שפה', 'English': 'English', 'עברית': 'עברית',
    '7 desks online': '7 דסקים מחוברים',
    'Trading mode': 'מצב מסחר', 'Trader': 'סוחר', 'Investor': 'משקיע',
    'Short term: days to a few weeks': 'טווח קצר: מימים ועד כמה שבועות', 'Long term: months to years': 'טווח ארוך: מחודשים ועד שנים',
    'Brain: who does the thinking': 'המוח: מי חושב', 'Rules': 'חוקים', 'Both': 'שניהם',
    'Rule-based desks: free and instant': 'דסקים מבוססי חוקים: חינם ומיידי',
    "Claude reads the data, writes each desk's view, the debate and the memo": 'Claude קורא את הנתונים וכותב את עמדת כל דסק, את הדיון ואת המזכר',
    "Gemini reads the data, writes each desk's view, the debate and the memo": 'Gemini קורא את הנתונים וכותב את עמדת כל דסק, את הדיון ואת המזכר',
    'Claude and Gemini both read every desk: agreement raises confidence, disagreement lowers it': 'Claude ו-Gemini קוראים כל דסק: הסכמה מעלה את הביטחון, מחלוקת מורידה אותו',
    'Connecting to market data': 'מתחבר לנתוני שוק',
    'Live data · Paper trading': 'נתונים חיים · מסחר על הנייר', 'Demo data, fictional companies': 'נתוני הדגמה, חברות בדויות',
    'Lock the room': 'נעילת החדר', 'Switch between light and dark': 'מעבר בין בהיר לכהה',
    'Wall Street today': 'וול סטריט היום', 'Top gainers': 'העליות הגדולות', 'Top losers': 'הירידות הגדולות',
    'Stock gainers': 'מניות עולות', 'Stock losers': 'מניות יורדות', 'Crypto gainers': 'מטבעות עולים', 'Crypto losers': 'מטבעות יורדים',
    'Server offline': 'השרת לא זמין',
    // the floor and the desks
    'The floor': 'הרצפה', 'Floor Manager details': 'פרטי מנהל הרצפה', 'Floor Manager': 'מנהל הרצפה',
    'Market Analyst': 'אנליסט שוק', 'Filings Specialist': 'מומחה דוחות', 'Fundamental Analyst': 'אנליסט פונדמנטלי', 'Technical Analyst': 'אנליסט טכני',
    'M&A Specialist': 'מומחה מיזוגים ורכישות', 'Risk and Leverage': 'סיכון ומינוף', 'Dealer': 'דילר',
    'Market': 'שוק', 'Filings': 'דוחות', 'Fundamental': 'פונדמנטלי', 'Technical': 'טכני', 'M&A': 'מיזוגים', 'Risk': 'סיכון',
    'Waiting for your brief': 'מחכה לתדריך שלך', 'Standing by': 'בהמתנה', 'Lead': 'מוביל',
    'Briefed': 'קיבל תדריך', 'Filing report': 'מגיש דוח', 'Briefing the room': 'מתדרך את החדר', 'Room is working': 'החדר עובד', 'Brief the room': 'תדרכו את החדר',
    'Gathering live market data': 'אוסף נתוני שוק חיים', 'Briefing the research desks': 'מתדרך את דסקי המחקר',
    'Research is in. Asking Risk for limits': 'המחקר הגיע. מבקש מגבולות מהסיכון',
    'Asking the Dealer for an execution plan': 'מבקש מהדילר תוכנית ביצוע', 'Dealer, show me how you would work it.': 'דילר, תראה לי איך היית מבצע את זה.',
    'Opening the floor for debate': 'פותח את הרצפה לדיון', 'All seven reports are in. Challenge each other before we vote.': 'כל שבעת הדוחות הגיעו. תתעמתו לפני ההצבעה.',
    'Calling the vote': 'קורא להצבעה', 'Debate is closed. Cast your votes.': 'הדיון סגור. הצביעו.', 'Counting the votes': 'סופר קולות',
    'Decision made. Ticket ready for you': 'ההחלטה התקבלה. הכרטיס מוכן בשבילך', 'Decision made. We stay flat': 'ההחלטה התקבלה. נשארים בחוץ',
    'Could not reach the server': 'אין חיבור לשרת',
    'Sentiment': 'סנטימנט', 'Cash quality': 'איכות מזומנים', 'Fair value': 'שווי הוגן', 'Max position': 'פוזיציה מרבית', 'Slippage': 'החלקה', 'Deal odds': 'סיכוי לעסקה', 'RSI': 'RSI',
    'Votes buy': 'מצביע קנייה', 'Votes short': 'מצביע שורט', 'Votes hold': 'מצביע המתנה', 'Votes sell': 'מצביע מכירה',
    'Bullish': 'שורי', 'Bearish': 'דובי', 'Neutral': 'ניטרלי', 'Buy': 'קנייה', 'Short': 'שורט', 'Hold': 'המתנה', 'Sell': 'מכירה',
    'buy': 'קנייה', 'short': 'שורט', 'hold': 'המתנה', 'sell': 'מכירה',
    // what each desk does (the sheet)
    'Takes your brief, splits it into tasks for the seven desks, weighs what comes back and makes the call.': 'לוקח את התדריך שלך, מחלק אותו למשימות לשבעת הדסקים, שוקל את מה שחוזר ומקבל את ההחלטה.',
    'Reads the market around the company: sector flows, competitors, news and sentiment.': 'קורא את השוק סביב החברה: תזרימים בסקטור, מתחרים, חדשות וסנטימנט.',
    'Reads annual and quarterly reports line by line, including the footnotes and earnings calls.': 'קורא דוחות שנתיים ורבעוניים שורה אחר שורה, כולל הביאורים ושיחות המשקיעים.',
    'Works out what the business is worth: cash flows, margins, returns and debt.': 'מחשב כמה העסק שווה: תזרימי מזומנים, שולי רווח, תשואות וחוב.',
    'Decides how big the position can be, how much leverage it can carry and where the stop goes.': 'קובע כמה גדולה יכולה להיות הפוזיציה, כמה מינוף היא סוחבת ואיפה הסטופ.',
    'Plans and works the order so the room gets filled without moving the price.': 'מתכנן ומבצע את הפקודה כך שהחדר יקבל ביצוע בלי להזיז את המחיר.',
    'Looks at the company as a deal: who could buy it, at what multiple, and what stands in the way.': 'מסתכל על החברה כעסקה: מי יכול לקנות אותה, באיזה מכפיל, ומה עומד בדרך.',
    'Reads the chart: trend, momentum, support and resistance.': 'קורא את הגרף: מגמה, מומנטום, תמיכה והתנגדות.',
    'Works with': 'עובד עם', 'Task routing': 'חלוקת משימות', 'Vote weighting': 'שקלול הצבעות', 'Decision memo': 'מזכר החלטה',
    'Latest decision': 'ההחלטה האחרונה', 'Latest report': 'הדוח האחרון', 'Close': 'סגירה',
    'Analyst ratings': 'דירוגי אנליסטים', 'Analyst price targets': 'מחירי יעד של אנליסטים', 'Balance sheet': 'מאזן', 'Realized volatility': 'תנודתיות בפועל',
    'Book exposure': 'חשיפת התיק', 'Margin rules': 'כללי בטחונות', 'Daily volume': 'מחזור יומי', 'Slice planner': 'מתכנן מנות', 'RSI and moving averages': 'RSI וממוצעים נעים',
    'SEC EDGAR 10-K figures': 'נתוני 10-K מ-SEC EDGAR', 'SEC filing list': 'רשימת דיווחים ל-SEC', 'SEC 13D filings': 'דיווחי 13D ל-SEC', 'SEC merger filings': 'דיווחי מיזוג ל-SEC',
    'CoinGecko token supply': 'היצע אסימונים ב-CoinGecko', 'CoinGecko market data': 'נתוני שוק מ-CoinGecko', 'CoinGecko exchange volume': 'מחזורי בורסות מ-CoinGecko',
    'CoinGecko sectors': 'סקטורים ב-CoinGecko', 'CoinGecko and Binance flow': 'תזרימים מ-CoinGecko ו-Binance', 'Yahoo and Binance candles': 'נרות מ-Yahoo ו-Binance',
    // the work lines while a desk works
    'Scanning sector flows': 'סורק תזרימים בסקטור', 'Reading 240 headlines': 'קורא 240 כותרות', 'Checking peer guidance': 'בודק תחזיות של מתחרים', 'Scoring sentiment': 'מדרג סנטימנט',
    'Opening the annual report': 'פותח את הדוח השנתי', 'Reading the footnotes': 'קורא את הביאורים', 'Comparing four quarters': 'משווה ארבעה רבעונים', 'Scoring the earnings call': 'מדרג את שיחת המשקיעים',
    'Building the cash flow model': 'בונה מודל תזרים מזומנים', 'Stress testing margins': 'מבצע מבחן קיצון לשולי הרווח', 'Comparing peer multiples': 'משווה מכפילים של מתחרים', 'Setting fair value': 'קובע שווי הוגן',
    'Measuring volatility': 'מודד תנודתיות', 'Checking book exposure': 'בודק את חשיפת התיק', 'Running the drawdown test': 'מריץ מבחן ירידה', 'Setting size and stop': 'קובע גודל וסטופ',
    'Reading the order book': 'קורא את ספר הפקודות', 'Profiling daily volume': 'ממפה את המחזור היומי', 'Planning the slices': 'מתכנן את המנות', 'Drafting the ticket': 'מנסח את הכרטיס',
    'Pulling recent deal multiples': 'שולף מכפילים של עסקאות אחרונות', 'Mapping likely bidders': 'ממפה רוכשים אפשריים', 'Reading ownership filings': 'קורא דיווחי בעלות', 'Checking regulatory hurdles': 'בודק מכשולים רגולטוריים',
    'Loading two years of prices': 'טוען שנתיים של מחירים', 'Marking support and resistance': 'מסמן תמיכה והתנגדות', 'Reading momentum': 'קורא מומנטום', 'Checking volume on the move': 'בודק מחזור בתנועה',
    // panels around the floor
    'Scout’s pick': 'הבחירה של הסייר', 'Find the next big trade': 'מצאו את העסקה הגדולה הבאה', 'Find a long term winner': 'מצאו מנצחת לטווח ארוך',
    'Send the scout to find the next big opportunity': 'שלחו את הסייר למצוא את ההזדמנות הגדולה הבאה',
    'Scout is flying': 'הסייר בדרך', 'The scout is scanning today’s movers': 'הסייר סורק את המניות הבולטות היום',
    'Is it a long term opportunity?': 'האם זו הזדמנות לטווח ארוך?', 'What is the trade?': 'מה העסקה?', 'in the last 24 hours': 'ב-24 השעות האחרונות',
    'Volatility alerts': 'התראות תנודתיות', 'Alerts': 'התראות', 'Oil volatility watch': 'מעקב תנודתיות בנפט', 'Volatility alert': 'התראת תנודתיות',
    'Rings when a new alert arrives: 3 of the 5 warning signs line up. Turning it on is silent. Keeps watching after you log out, while the site is open in a tab.': 'מצלצל כשמגיעה התראה חדשה: 3 מתוך 5 סימני האזהרה מתיישרים. ההפעלה שקטה. ממשיך לעקוב גם אחרי יציאה, כל עוד האתר פתוח בלשונית.',
    'Symbol to watch': 'סימול למעקב', 'Watch': 'מעקב', 'Switch': 'החלפה', 'Oil (WTI)': 'נפט (WTI)', 'Brent': 'ברנט', 'Gold': 'זהב',
    'Preview the alert': 'תצוגה מקדימה של ההתראה', 'Stop watching': 'הפסקת המעקב', 'Stopped watching': 'המעקב הופסק',
    'Pick a symbol and press Watch. Oil is the default.': 'בחרו סימול ולחצו מעקב. ברירת המחדל היא נפט.', 'Checking the five signs…': 'בודק את חמשת הסימנים…',
    'Fear index': 'מדד הפחד', 'Futures curve': 'עקום החוזים', 'Price breakout': 'פריצת מחיר', 'Event calendar': 'יומן אירועים', 'Crowded positioning': 'פוזיציות צפופות', 'Geopolitics and news': 'גאופוליטיקה וחדשות',
    'calm': 'רגוע', 'watch': 'במעקב', 'alert': 'התראה', 'Calm': 'רגוע', 'Watch out': 'שימו לב', 'Alert': 'התראה',
    'Not enough price history': 'אין מספיק היסטוריית מחירים', 'CFTC positioning not available': 'נתוני פוזיציות של CFTC לא זמינים', 'Futures positioning not available': 'נתוני פוזיציות בחוזים לא זמינים',
    'News not available': 'חדשות לא זמינות', 'No escalation headlines in 2 days': 'אין כותרות הסלמה ביומיים האחרונים', 'No market-moving events in the next 36 hours': 'אין אירועים מזיזי שוק ב-36 השעות הקרובות',
    'Silence': 'השתקה', 'Volatility expected': 'צפויה תנודתיות',
    'The crowd: what traders and social media think of the decision': 'הקהל: מה סוחרים והרשתות החברתיות חושבים על ההחלטה',
    'Crowd': 'הקהל', 'After the vote': 'אחרי ההצבעה', 'The crowd vs the room': 'הקהל מול החדר', 'What they think': 'מה הם חושבים',
    'Brief the room first. When the desks have voted, the crowd shows what Reddit, traders and the news think of the decision.': 'קודם תדרכו את החדר. אחרי שהדסקים יצביעו, הקהל יראה מה Reddit, הסוחרים והחדשות חושבים על ההחלטה.',
    'The crowd needs live market data: demo companies are fictional.': 'הקהל צריך נתוני שוק חיים: חברות ההדגמה בדויות.',
    'Reading Reddit, traders and the news…': 'קורא את Reddit, את הסוחרים ואת החדשות…', 'No read': 'אין קריאה', 'no read': 'אין קריאה',
    'Not available right now': 'לא זמין כרגע', 'Not among the tickers Reddit is talking about today': 'לא בין המניות שמדברים עליהן ב-Reddit היום',
    'Not enough crowd data to compare with the room': 'אין מספיק נתוני קהל להשוואה עם החדר',
    'Reddit (via ApeWisdom)': 'Reddit (דרך ApeWisdom)', 'Options traders': 'סוחרי אופציות', 'Short sellers': 'מוכרים בחסר', 'Market mood (VIX)': 'מצב הרוח בשוק (VIX)',
    'News headlines': 'כותרות חדשות', 'CoinGecko voters': 'מצביעי CoinGecko', 'Binance futures traders': 'סוחרי חוזים ב-Binance', 'Binance top traders': 'הסוחרים הגדולים ב-Binance',
    'Funding rate': 'ריבית מימון', 'Crypto Fear & Greed': 'מדד הפחד והחמדנות בקריפטו',
    'bullish': 'שורי', 'bearish': 'דובי', 'neutral': 'ניטרלי', 'mixed': 'מעורב', 'positive': 'חיובי', 'negative': 'שלילי',
    'Professor Bubbles: open the history class, every brief and what would have happened': 'פרופסור בועות: פתחו את שיעור ההיסטוריה, כל תדריך ומה היה קורה',
    'Prof. Bubbles': 'פרופ׳ בועות', 'History: what if we had followed?': 'היסטוריה: מה אם היינו מקשיבים?',
    'History class': 'שיעור היסטוריה', 'Professor Bubbles’ history class': 'שיעור ההיסטוריה של פרופסור בועות',
    'Every brief you gave the room, and what would have happened if you had opened the position it offered.': 'כל תדריך שנתתם לחדר, ומה היה קורה אילו פתחתם את הפוזיציה שהוא הציע.',
    'Opening the books': 'פותח את הספרים', 'Replaying every ticket against the real prices since.': 'משחזר כל כרטיס מול המחירים האמיתיים מאז.',
    'History unavailable': 'ההיסטוריה לא זמינה', 'No lessons yet': 'עדיין אין שיעורים', 'Brief the room, and every call shows up here with what happened next.': 'תדרכו את החדר, וכל החלטה תופיע כאן עם מה שקרה אחריה.',
    'No price data': 'אין נתוני מחיר', 'Demo round': 'סבב הדגמה', 'could not replay this one': 'לא ניתן לשחזר את זה', 'fictional company, nothing to replay': 'חברה בדויה, אין מה לשחזר',
    'Tickets offered': 'כרטיסים שהוצעו', 'Won / lost / open': 'הצליחו / נכשלו / פתוחים', 'If we had followed all': 'אילו הקשבנו לכולם', 'Best': 'הטובה ביותר', 'Worst': 'הגרועה ביותר',
    'Stayed flat': 'נשארנו בחוץ', 'still open': 'עדיין פתוחה', 'closed at the horizon': 'נסגרה באופק',
    // the command bar
    'Brief for the room': 'תדריך לחדר', 'Brief the room. Try: Should we buy NVDA?': 'תדרכו את החדר. נסו: לקנות NVDA?', 'Brief the room. Try: Should we buy HLXN?': 'תדרכו את החדר. נסו: לקנות HLXN?',
    'Brief the room. Try: Is MSFT worth owning?': 'תדרכו את החדר. נסו: שווה להחזיק MSFT?', 'Brief the room. Try: Is HLXN worth owning?': 'תדרכו את החדר. נסו: שווה להחזיק HLXN?',
    'Should we buy NVDA?': 'לקנות NVDA?', 'Is TSLA a short here?': 'שורט על TSLA כאן?', 'Is BTC a buy after this move?': 'לקנות BTC אחרי התנועה הזאת?',
    'Should we buy Bank Leumi?': 'לקנות את בנק לאומי?', 'Is Teva worth owning on the Tel Aviv exchange?': 'שווה להחזיק את טבע בבורסה בתל אביב?',
    'Should we buy HLXN?': 'לקנות HLXN?', 'Is VRDA a short into earnings?': 'שורט על VRDA לקראת הדוחות?', 'Takeover talk around ORBT. Do we play it?': 'יש דיבורים על השתלטות על ORBT. משחקים על זה?',
    'Is MSFT worth owning for five years?': 'שווה להחזיק MSFT לחמש שנים?', 'Should we start a long term position in ETH?': 'לפתוח פוזיציה ארוכת טווח ב-ETH?', 'Is INTC a compounder or a trap?': 'INTC היא מכונת צמיחה או מלכודת?',
    'Is HLXN worth owning for five years?': 'שווה להחזיק HLXN לחמש שנים?', 'Should we start a long term position in VRDA?': 'לפתוח פוזיציה ארוכת טווח ב-VRDA?', 'Is ORBT a compounder or a trap?': 'ORBT היא מכונת צמיחה או מלכודת?',
    'The room is busy. Wait for the decision': 'החדר עסוק. חכו להחלטה', 'Market data is not loaded yet': 'נתוני השוק עוד לא נטענו',
    'Finish this round before switching mode': 'סיימו את הסבב לפני החלפת מצב', 'Finish this round before switching brain': 'סיימו את הסבב לפני החלפת מוח',
    'Type a brief first, for example a ticker and a question': 'קודם כתבו תדריך, למשל סימול ושאלה',
    'Rules: the desks follow fixed rules. Free and instant': 'חוקים: הדסקים פועלים לפי כללים קבועים. חינם ומיידי',
    'Both: Claude and Gemini read every desk. Where they agree the room is surer; where they differ it is more careful': 'שניהם: Claude ו-Gemini קוראים כל דסק. כשהם מסכימים החדר בטוח יותר; כשהם חלוקים הוא זהיר יותר',
    // the side panel
    'Wire': 'מברק', 'Scoreboard': 'לוח תוצאות', 'Performance': 'ביצועים', 'Asset performance': 'ביצועי הנכס', 'Positions': 'פוזיציות',
    'The room is quiet': 'החדר שקט', 'Messages between the manager and the desks show up here once you brief the room.': 'ההודעות בין המנהל לדסקים יופיעו כאן אחרי שתתדרכו את החדר.',
    'No decision yet': 'עדיין אין החלטה', 'Brief the room and the manager’s memo lands here.': 'תדרכו את החדר ומזכר המנהל יגיע לכאן.',
    'Decision in progress': 'ההחלטה בתהליך', 'The memo lands here when the manager makes the call.': 'המזכר יגיע לכאן כשהמנהל יחליט.',
    'How the desks voted': 'איך הדסקים הצביעו', 'What the debate changed': 'מה הדיון שינה', 'Nobody changed position.': 'אף אחד לא שינה עמדה.',
    'Trade ticket': 'כרטיס עסקה', 'Entry': 'כניסה', 'Stop': 'סטופ', 'Target': 'יעד', 'Size': 'גודל', 'Leverage': 'מינוף', 'Horizon': 'אופק', 'Reward to risk': 'סיכוי לסיכון', 'Execution': 'ביצוע',
    'Approve ticket': 'אישור הכרטיס', 'Run again': 'הרצה חוזרת', 'Sending the ticket': 'שולח את הכרטיס', 'Dealer is working the order': 'הדילר מבצע את הפקודה',
    'Order at the broker': 'הפקודה אצל הברוקר', 'checking…': 'בודק…', 'Symbol': 'סימול', 'Order': 'פקודה', 'Price now': 'מחיר עכשיו', 'Stop at the broker': 'סטופ אצל הברוקר',
    'Position value': 'שווי הפוזיציה', 'Send to broker': 'שליחה לברוקר', 'Send to paper broker': 'שליחה לברוקר הנייר', 'Paper only': 'רק על הנייר', 'Sending to the broker': 'שולח לברוקר',
    'Sign in with your own code to send orders': 'כדי לשלוח פקודות היכנסו עם הקוד האישי',
    'Loading the scoreboard': 'טוען את לוח התוצאות', 'Grading calls against real prices.': 'מדרג החלטות מול מחירים אמיתיים.', 'Scoreboard unavailable': 'לוח התוצאות לא זמין',
    'Room vs benchmark': 'החדר מול המדד', 'Room (account)': 'החדר (החשבון)', 'Closed trades': 'עסקאות סגורות', 'Win rate': 'שיעור הצלחה', 'Average': 'ממוצע', 'Profit factor': 'מקדם רווח',
    'Total': 'סה״כ', 'Worst drawdown': 'הירידה הגרועה ביותר', 'S&P 500, from the first day of the demo': 'S&P 500, מהיום הראשון של הדמו', 'room ·': 'החדר ·',
    'Paper portfolio': 'תיק על הנייר', 'Open positions': 'פוזיציות פתוחות', 'Exposure': 'חשיפה', 'Open P&L': 'רווח והפסד פתוח', 'Realized': 'ממומש', 'Win Rate': 'שיעור הצלחה',
    'No approved tickets yet. Approve a ticket and it is tracked here against real prices.': 'עדיין אין כרטיסים מאושרים. אשרו כרטיס והוא יימדד כאן מול מחירים אמיתיים.',
    'Track record': 'רקורד', 'Calls graded': 'החלטות שדורגו', 'Waiting for their horizon': 'מחכות לאופק שלהן', 'Calls right': 'החלטות נכונות', 'Average edge': 'יתרון ממוצע',
    'Brains': 'מוחות', 'no graded calls yet': 'עדיין אין החלטות מדורגות', 'no graded calls': 'אין החלטות מדורגות', 'Latest graded calls': 'החלטות שדורגו לאחרונה', 'right': 'צדק', 'wrong': 'טעה',
    'Each brain is graded on its own calls going forward. The AI brains cannot be tested on past years fairly: the models may already know what happened.': 'כל מוח מדורג על ההחלטות שלו מכאן והלאה. אי אפשר לבחון את מוחות ה-AI בהגינות על שנים קודמות: ייתכן שהמודלים כבר יודעים מה קרה.',
    "Vote weights now follow each desk's record: desks that are right more often get a bigger vote.": 'משקלי ההצבעה עוקבים עכשיו אחרי הרקורד של כל דסק: דסקים שצודקים יותר מקבלים קול גדול יותר.',
    'target hit': 'היעד הושג', 'stopped out': 'נסגר בסטופ', 'closed at horizon': 'נסגר באופק', 'open': 'פתוחה',
    'No asset yet': 'עדיין אין נכס', "Brief the room and the asset's performance shows up here.": 'תדרכו את החדר וביצועי הנכס יופיעו כאן.', 'Reading the price history.': 'קורא את היסטוריית המחירים.',
    'Performance unavailable': 'הביצועים לא זמינים', 'Period': 'תקופה', 'Today': 'היום', 'This week': 'השבוע', 'Month to date': 'מתחילת החודש', 'Year to date': 'מתחילת השנה',
    '1 month': 'חודש', '3 months': '3 חודשים', '6 months': '6 חודשים', '1 year': 'שנה', '2 years': 'שנתיים', '3 years': '3 שנים', '5 years': '5 שנים', 'Last session': 'יום המסחר האחרון',
    '24 hours': '24 שעות', '52 week range': 'טווח 52 שבועות', 'Since its first day on Binance': 'מהיום הראשון ב-Binance', 'Since IPO': 'מאז ההנפקה',
    'Loading positions': 'טוען פוזיציות', 'Asking the broker.': 'שואל את הברוקר.', 'No broker on this server': 'אין ברוקר בשרת הזה', 'Execution is paper only.': 'הביצוע על הנייר בלבד.',
    'Broker not connected': 'הברוקר לא מחובר', 'Broker unavailable': 'הברוקר לא זמין', 'Balance': 'יתרה', 'Equity': 'הון', 'Open risk': 'סיכון פתוח', 'Open trades': 'עסקאות פתוחות',
    'No open positions. Send a ticket from the Decision memo.': 'אין פוזיציות פתוחות. שלחו כרטיס ממזכר ההחלטה.', 'Close half': 'סגירת חצי', 'Close all': 'סגירת הכול', 'Closed': 'נסגרו',
    'Add second half': 'הוספת החצי השני', 'take half at +1.5R': 'מימוש חצי ברמת +1.5R', 'half taken': 'חצי מומש', 'see broker': 'ראו אצל הברוקר', 'Connect cTrader demo': 'חיבור cTrader דמו',
    'Connect broker': 'חיבור ברוקר', 'Broker offline': 'הברוקר מנותק', 'Broker account (cTrader). Tap for positions': 'חשבון ברוקר (cTrader). הקישו לפוזיציות',
    'Positions at the broker (cTrader demo)': 'פוזיציות אצל הברוקר (cTrader דמו)',
    'Close every open position at the broker now?': 'לסגור עכשיו את כל הפוזיציות הפתוחות אצל הברוקר?',
    'Rules on every order: risk 1% of the balance, at most 5% open risk and 5 trades, no new trades after 3% down today or 6% this week, none within 5 sessions of earnings, no crypto. Stops sit at the broker; the room moves them up and takes profit by itself, and asks you before adding risk.': 'הכללים לכל פקודה: סיכון של 1% מהיתרה, לכל היותר 5% סיכון פתוח ו-5 עסקאות, אין עסקאות חדשות אחרי ירידה של 3% היום או 6% השבוע, אין עסקאות 5 ימי מסחר לפני דוחות, אין קריפטו. הסטופים יושבים אצל הברוקר; החדר מעלה אותם ומממש רווחים בעצמו, ושואל אתכם לפני הוספת סיכון.',
    'No decision yet. Brief the room to get one.': 'עדיין אין החלטה. תדרכו את החדר כדי לקבל אחת.',
    'Working on it. The report shows up here as soon as it is filed.': 'עובד על זה. הדוח יופיע כאן ברגע שיוגש.', 'No report yet. Brief the room to put this desk to work.': 'עדיין אין דוח. תדרכו את החדר כדי להפעיל את הדסק הזה.',
    'Tel Aviv': 'תל אביב', 'New York': 'ניו יורק',
    // Bull vs Bear
    'Bull vs Bear': 'שור מול דוב', 'Bulls against Bears': 'השוורים מול הדובים', 'Bulls': 'שוורים', 'Bears': 'דובים', 'Waiting for the bell': 'מחכים לפעמון', 'Wall Street floor': 'רצפת וול סטריט',
    'The bell rings': 'הפעמון מצלצל', 'The bull lines up the last charge': 'השור מתכונן להסתערות האחרונה', 'The bear lines up the last blow': 'הדוב מתכונן למכה האחרונה',
    'Knockout. The bulls take it': 'נוקאאוט. השוורים לוקחים', 'Knockout. The bears take it': 'נוקאאוט. הדובים לוקחים', 'Draw. Nobody wins this round': 'תיקו. אף אחד לא מנצח בסבב הזה',
    'Nobody gains': 'אף אחד לא מרוויח', 'The bears gain ground': 'הדובים מתקדמים', 'The bulls gain ground': 'השוורים מתקדמים', 'The middle gain ground': 'המרכז מתחזק',
    'Trade plan': 'תוכנית עסקה', 'Where to get in, where to get out and how to manage the trade': 'איפה נכנסים, איפה יוצאים ואיך מנהלים את העסקה',
    'No plan yet': 'עדיין אין תוכנית', 'Brief the room. When the desks have voted, the plan shows where to get in, where to get out and how to manage the trade.': 'תדרכו את החדר. אחרי שהדסקים יצביעו, התוכנית תראה איפה נכנסים, איפה יוצאים ואיך מנהלים את העסקה.',
    'All in, managed': 'הכול בכניסה, עם ניהול', 'Scale in': 'כניסה בשלבים', 'How to run the trade': 'איך מנהלים את העסקה', 'Account': 'חשבון', 'Risk %': 'סיכון %',
    'Account size': 'גודל החשבון', 'Risk per trade in %': 'סיכון לעסקה באחוזים', 'Price levels': 'רמות מחיר',
    'Stop loss': 'סטופ לוס', 'Take profit': 'טייק פרופיט', 'Take profit 1': 'טייק פרופיט 1', 'Take profit 2': 'טייק פרופיט 2', 'Break-even': 'נקודת איזון', 'Time stop': 'סטופ זמן', 'Add': 'הוספה',
    '1 share': 'מניה אחת', 'sell half at +1.5R': 'מכירת חצי ברמת +1.5R', 'buy back half at +1.5R': 'קניית חצי בחזרה ברמת +1.5R',
    'if the price moves against us by 0.5R, buy the second half, same stop': 'אם המחיר זז נגדנו ב-0.5R, קונים את החצי השני, אותו סטופ',
    'if the price moves against us by 0.5R, sell the second half, same stop': 'אם המחיר זז נגדנו ב-0.5R, מוכרים את החצי השני, אותו סטופ',
    'close if it has gone nowhere': 'סוגרים אם העסקה לא זזה', 'Most profit of the two.': 'הרווחית מבין השתיים.', 'Smaller losing runs, a little less profit.': 'רצפי הפסד קטנים יותר, קצת פחות רווח.',
    'Copy for the broker agent': 'העתקה לסוכן הברוקר', 'Save image': 'שמירה כתמונה', 'Plan copied. Paste it to the broker agent': 'התוכנית הועתקה. הדביקו אותה לסוכן הברוקר', 'Plan saved as an image': 'התוכנית נשמרה כתמונה',
    'Levels the desks are watching': 'רמות שהדסקים עוקבים אחריהן', 'above the price': 'מעל המחיר', 'below the price': 'מתחת למחיר', 'No trade on': 'אין עסקה ב-',
    'The room passes. Brief it again when the price reaches one of these levels.': 'החדר מוותר הפעם. תדרכו אותו שוב כשהמחיר יגיע לאחת מהרמות האלה.', 'Paper analysis, not advice.': 'ניתוח על הנייר, לא ייעוץ.',
    'days to a few weeks': 'מימים ועד כמה שבועות', 'months to years': 'מחודשים ועד שנים', 'Research desks, you have the floor.': 'דסקי המחקר, הבמה שלכם.',
    'No action': 'ללא פעולה', 'The vote count': 'ספירת הקולות', 'Weighted score': 'ציון משוקלל', 'Buy line': 'קו קנייה', 'Short line': 'קו שורט', 'Sell line': 'קו מכירה', 'The vote said': 'ההצבעה אמרה',
    'Brain: Rules, a deterministic rules engine (no AI)': 'מוח: חוקים, מנוע כללים דטרמיניסטי (בלי AI)', 'Data sources': 'מקורות הנתונים',
    "learned from each desk's graded record": 'נלמדו מהרקורד המדורג של כל דסק', "the mode's standard weights": 'המשקלים הרגילים של המצב',
    'The analysis': 'הניתוח', 'Direction': 'כיוון', 'Benchmark': 'מדד ייחוס', 'Trigger': 'טריגר', 'Invalidation': 'תנאי ביטול', 'Bullish scenario': 'תרחיש שורי', 'Bearish scenario': 'תרחיש דובי', 'Expected excess return': 'תשואה עודפת צפויה',
    'Sell means closing or reducing a holding. It is not a short position, so there is no entry, stop or target to place.': 'מכירה פירושה סגירה או הקטנה של אחזקה. זו לא פוזיציית שורט, ולכן אין כניסה, סטופ או יעד.',
    'Against the benchmark': 'מול מדד הייחוס', 'Costs taken off': 'עלויות שנוכו', 'not known yet': 'עדיין לא ידוע', 'not known': 'לא ידוע', 'Is the conviction worth anything?': 'האם לביטחון יש ערך?',
    "Each call is graded at its own horizon (the end of the ticket's window, set when it was made) against its benchmark over the same days (S&P 500, TA-35 or Bitcoin). Average edge is the move in the direction of the call; against the benchmark is what the call earned net of costs minus simply holding the benchmark.": 'כל החלטה מדורגת באופק שלה (סוף חלון הכרטיס, שנקבע כשהתקבלה) מול מדד הייחוס שלה באותם ימים (S&P 500, ת״א 35 או ביטקוין). יתרון ממוצע הוא התנועה בכיוון ההחלטה; מול מדד הייחוס הוא מה שההחלטה הרוויחה בניכוי עלויות, פחות פשוט להחזיק את המדד.',
    'Execution': 'ביצוע', 'Profile': 'פרופיל', 'Instrument': 'מכשיר', 'Broker symbol': 'סימול אצל הברוקר', 'Reference price': 'מחיר ייחוס', 'Broker quote': 'ציטוט מהברוקר', 'Costs': 'עלויות',
    'Admissible': 'כשירות', 'Plan status': 'מצב התוכנית', 'Broker': 'ברוקר', 'Execution profile': 'פרופיל ביצוע', 'unknown': 'לא ידוע', 'No broker (research only)': 'בלי ברוקר (מחקר בלבד)', 'Colmex Israel CFD': 'Colmex ישראל CFD',
    'research only': 'מחקר בלבד', 'needs a fresh broker quote': 'דורש ציטוט עדכני מהברוקר', 'terms not verified': 'התנאים לא אומתו', 'nothing to place': 'אין מה לבצע', 'not admissible': 'לא כשיר', 'ready to place by hand': 'מוכן לביצוע ידני',
    'not connected: no broker quote': 'לא מחובר: אין ציטוט מהברוקר', 'the price the analysis used, not a quote': 'המחיר שהניתוח השתמש בו, לא ציטוט',
    'Before costs: hypothetical, not a net result.': 'לפני עלויות: היפותטי, לא תוצאה נטו.', 'Costs not verified: no net figure, and no claim of an edge, gross or net.': 'העלויות לא אומתו: אין נתון נטו, ואין טענה ליתרון, לא ברוטו ולא נטו.',
    'Research only. Any result here is hypothetical and before costs: it is not a net result.': 'מחקר בלבד. כל תוצאה כאן היפותטית ולפני עלויות: היא לא תוצאה נטו.',
    'Colmex Israel CFD, picked by hand. Not connected; no term verified yet, so costs and availability are unknown.': 'Colmex ישראל CFD, נבחר ידנית. לא מחובר; אף תנאי לא אומת עדיין, ולכן העלויות והזמינות לא ידועות.',
    'The analysis and its prediction are unchanged by the profile.': 'הניתוח והתחזית שלו לא משתנים בגלל הפרופיל.', 'No broker: research only.': 'בלי ברוקר: מחקר בלבד.', 'No position in this plan.': 'אין פוזיציה בתוכנית הזו.',
    'No fresh broker quote: this plan cannot be placed as it is (the analysis stands).': 'אין ציטוט עדכני מהברוקר: אי אפשר לבצע את התוכנית כפי שהיא (הניתוח עומד בעינו).',
    'Against the benchmark (hypothetical)': 'מול מדד הייחוס (היפותטי)', 'Costs taken off (assumed, not verified)': 'עלויות שנוכו (הנחה, לא מאומת)', 'Risk': 'סיכון', 'Position value': 'שווי הפוזיציה', 'Without leverage': 'בלי מינוף', 'Margin': 'מרג׳ין', 'Currency': 'מטבע', 'Gaps': 'פערי פתיחה', 'Worst run in the test': 'הרצף הגרוע בבדיקה', 'none needed': 'לא נדרש',
    'unknown without a broker: margin is what the broker holds, not the risk; the risk is the whole position value': 'לא ידוע בלי ברוקר: מרג׳ין הוא מה שהברוקר מחזיק, לא הסיכון; הסיכון הוא כל שווי הפוזיציה',
    'not measured for this asset. A stop does not cap the loss: a price can open past it.': 'לא נמדד לנכס הזה. סטופ לא מגביל את ההפסד: מחיר יכול להיפתח מעבר לו.',
    'n/a': 'אין נתון', 'Scout': 'הסייר', 'of book': 'מהתיק', 'Briefs': 'תדריכים', 'Lessons, newest first': 'שיעורים, מהחדש לישן',
    'Each ticket is replayed over the real daily prices since the call: the first touch of the stop or the target closes it, otherwise it is marked at the last price. Paper results, not advice.': 'כל כרטיס משוחזר על המחירים היומיים האמיתיים מאז ההחלטה: הנגיעה הראשונה בסטופ או ביעד סוגרת אותו, אחרת הוא מוערך במחיר האחרון. תוצאות על הנייר, לא ייעוץ.',
    'Room against the S&P 500, day by day': 'החדר מול S&P 500, יום אחרי יום',
    'The US market is closed: orders go in from 9:30 to 16:00 New York time': 'השוק האמריקאי סגור: פקודות נכנסות בין 9:30 ל-16:00 שעון ניו יורק',
    'No crypto at the broker: the backtest found no edge in coins': 'אין קריפטו אצל הברוקר: הבדיקה ההיסטורית לא מצאה יתרון במטבעות',
    'Tel Aviv shares stay paper for now: the broker link trades US shares': 'מניות תל אביב נשארות בינתיים על הנייר: החיבור לברוקר סוחר במניות אמריקאיות',
    'Broker trades follow the tested trader plan; investor tickets stay paper': 'עסקאות אצל הברוקר עוקבות אחרי תוכנית הסוחר שנבדקה; כרטיסי משקיע נשארים על הנייר',
    'Too small to split in halves (safe mode): use method C or a bigger account': 'קטן מדי לחלוקה לחצאים (מצב בטוח): השתמשו בשיטה C או בחשבון גדול יותר',
    'The broker is not connected': 'הברוקר לא מחובר', 'This ticket was already sent to the broker': 'הכרטיס הזה כבר נשלח לברוקר', 'This preview expired. Check the order again': 'התצוגה המקדימה פגה. בדקו את הפקודה שוב',
    'The price moved and the size changed. Check the order again': 'המחיר זז והגודל השתנה. בדקו את הפקודה שוב',
    'No closed trades yet. The comparison starts with the first one.': 'עדיין אין עסקאות סגורות. ההשוואה מתחילה בראשונה.',
    'On plan and ahead of the S&P 500: the numbers support a small live start (0.5% risk), if you decide so.': 'לפי התוכנית ולפני S&P 500: המספרים תומכים בהתחלה קטנה בכסף אמיתי (סיכון 0.5%), אם תחליטו כך.',
    'The trades behave like the backtest, but the account is behind the S&P 500 so far. Keep going on demo.': 'העסקאות מתנהגות כמו בבדיקה ההיסטורית, אבל החשבון מאחורי S&P 500 בינתיים. ממשיכים בדמו.',
    'The trades are weaker than the backtest. Stay on demo and look at what is different before any live money.': 'העסקאות חלשות מהבדיקה ההיסטורית. נשארים בדמו ובודקים מה שונה לפני כסף אמיתי.',
    'Method C; "test" is the 10 year backtest with the same rules. 1R is the risk taken on a trade.': 'שיטה C; "בבדיקה" היא הבדיקה ההיסטורית של 10 שנים עם אותם כללים. 1R הוא הסיכון שנלקח בעסקה.',
    'Method B; "test" is the 10 year backtest with the same rules. 1R is the risk taken on a trade.': 'שיטה B; "בבדיקה" היא הבדיקה ההיסטורית של 10 שנים עם אותם כללים. 1R הוא הסיכון שנלקח בעסקה.',
    'Hebrew needs an AI model on the server (ANTHROPIC_API_KEY or GEMINI_API_KEY)': 'עברית דורשת מודל AI בשרת (ANTHROPIC_API_KEY או GEMINI_API_KEY): הסבב באנגלית',
    'No ticker found in the brief. Name a stock or coin, for example NVDA, Apple or BTC': 'לא נמצא סימול בתדריך. ציינו מניה או מטבע, למשל NVDA, אפל, בנק לאומי או BTC',
    'brief is required': 'צריך תדריך', 'Sign in first': 'קודם צריך להיכנס', 'The room decided to hold. There is no ticket to execute': 'החדר החליט להמתין. אין כרטיס לביצוע',
    'This ticket was already executed': 'הכרטיס הזה כבר בוצע'
  };

  /* ---------- sentence templates: {0}, {1}... in order; a captured part is translated too when it is a known phrase ---------- */
  var P = [
    ['Earnings {0}: no new trade within {1} sessions of the report', 'דוחות ב-{0}: אין עסקה חדשה {1} ימי מסחר לפני הדוח'], ['Already {0} open trades (the most is {1})', 'כבר {0} עסקאות פתוחות (המקסימום {1})'],
    ['Daily stop: {0} today (limit {1})', 'עצירה יומית: {0} היום (גבול {1})'], ['Weekly stop: {0} this week (limit {1})', 'עצירה שבועית: {0} השבוע (גבול {1})'], ['{0} is not tradable on this account', '{0} לא סחיר בחשבון הזה'],
    ['The price ({0}) is already past the stop ({1})', 'המחיר ({0}) כבר עבר את הסטופ ({1})'], ['The price ({0}) ran too close to the target: less than 1 to 1 left', 'המחיר ({0}) התקרב מדי ליעד: נשאר פחות מ-1 ל-1'],
    ['Open risk is {0} of {1} allowed', 'הסיכון הפתוח {0} מתוך {1} מותר'], ['The smallest size the broker allows risks {0}, more than the {1} limit', 'הגודל המינימלי שהברוקר מאפשר מסכן {0}, יותר מהגבול של {1}'],
    ['Too early to judge: {0} closed trades in {1} days. The plan is 4 to 6 weeks and at least 20 trades.', 'מוקדם לשפוט: {0} עסקאות סגורות ב-{1} ימים. התוכנית היא 4 עד 6 שבועות ולפחות 20 עסקאות.'],
    ['Too early to judge: {0} closed trade in {1} days. The plan is 4 to 6 weeks and at least 20 trades.', 'מוקדם לשפוט: עסקה סגורה {0} ב-{1} ימים. התוכנית היא 4 עד 6 שבועות ולפחות 20 עסקאות.'],
    ['Too early to judge: {0} closed trades in {1} day. The plan is 4 to 6 weeks and at least 20 trades.', 'מוקדם לשפוט: {0} עסקאות סגורות ביום {1}. התוכנית היא 4 עד 6 שבועות ולפחות 20 עסקאות.'],
    ['Too early to judge: {0} closed trade in {1} day. The plan is 4 to 6 weeks and at least 20 trades.', 'מוקדם לשפוט: עסקה סגורה {0} ביום {1}. התוכנית היא 4 עד 6 שבועות ולפחות 20 עסקאות.'],
    ['{0} {1} ({2}) · {3}', '{0} {1} ({2}) · {3}', 1], ['{0} · {1}, {2}', '{0} · {1}, {2}', 1],
    ['or a limit between {0} and {1}', 'או לימיט בין {0} ל-{1}'], ['{0}% away · 1R = {1}', 'במרחק {0}% · 1R = {1}'], ['{0} shares', '{0} מניות'],
    ['risks {0} ({1}% of {2})', 'מסכן {0} ({1}% מתוך {2})'], ['once a daily close reaches it (+1R), move the stop to {0}', 'כשסגירה יומית מגיעה אליה (+1R), מזיזים את הסטופ ל-{0}'],
    ['for the rest, or trail the stop {0} behind the best close (2 ATR)', 'ליתרה, או סטופ נגרר {0} מאחורי הסגירה הטובה ביותר (2 ATR)'], ['{0} sessions', '{0} ימי מסחר'],
    ['close if it is still short of {0} (+0.5R); close after {1} sessions in any case', 'סוגרים אם עדיין מתחת ל-{0} ‏(+0.5R); סוגרים אחרי {1} ימי מסחר בכל מקרה'],
    ['{0} now, {1} on the add', '{0} עכשיו, {1} בהוספה'], ['risks at most {0} if both fill ({1}% of {2} on the full size)', 'מסכן לכל היותר {0} אם שתיהן מתבצעות ({1}% מתוך {2} על הגודל המלא)'],
    ['close it all at the target ({0} to 1)', 'סוגרים הכול ביעד ({0} ל-1)'], ['{0} · {1}% conviction · {2} mode', '{0} · ביטחון {1}% · מצב {2}'], ['No trade on {0}', 'אין עסקה ב-{0}'],
    ['Tested on 10 years of US stocks: {0} trades, {1}% won, {2}R a trade, profit factor {3}, worst run {4}R', 'נבדק על 10 שנים של מניות אמריקאיות: {0} עסקאות, {1}% הצליחו, {2}R לעסקה, מקדם רווח {3}, רצף הגרוע ביותר {4}R'],
    ['{0}. Paper analysis, not advice.', '{0}. ניתוח על הנייר, לא ייעוץ.'], ['{0}. Most profit of the two.', '{0}. הרווחית מבין השתיים.'], ['{0}. Smaller losing runs, a little less profit.', '{0}. רצפי הפסד קטנים יותר, קצת פחות רווח.'],
    ['Could not copy: {0}', 'לא ניתן להעתיק: {0}'], ['Could not save the image: {0}', 'לא ניתן לשמור את התמונה: {0}'],
    ['New brief in {0} mode ({1}): “{2}” Research desks, you have the floor.', 'תדריך חדש במצב {0} ({1}): “{2}” דסקי המחקר, הבמה שלכם.'],
    ['Points: bulls {0}, bears {1}, hold {2}, of {3}. {4}. Weights: {5}.', 'נקודות: שוורים {0}, דובים {1}, המתנה {2}, מתוך {3}. {4}. משקלים: {5}.'],
    ['Overruled by {0}: {1} (limit {2}, value {3})', 'נפסל על ידי {0}: {1} (גבול {2}, ערך {3})'], ['Overruled by {0}: {1}', 'נפסל על ידי {0}: {1}'],
    ['{0}: bulls {1}%. Conviction {2}%: {3}. {4}', '{0}: שוורים {1}%. ביטחון {2}%: {3}. {4}'], ['{0}: bulls {1}%. Conviction {2}%: {3}.', '{0}: שוורים {1}%. ביטחון {2}%: {3}.'],
    ['{0} → {1} · ×{2} = {3}', '{0} ← {1} · ×{2} = {3}'], ['{0} · ×{1} = {2}', '{0} · ×{1} = {2}'],
    ['{0} · as of {1} · {2}', '{0} · נכון ל-{1} · {2}'], ['{0} · {1}', '{0} · {1}', 1],
    ['Ignored text from {0} that tried to give instructions: “{1}”', 'התעלמנו מטקסט של {0} שניסה לתת הוראות: “{1}”'],
    ['No action · {0}', 'ללא פעולה · {0}'], ['Watch · {0}', 'מעקב · {0}'], ['Sell · {0}', 'מכירה · {0}'],
    ['Data: {0}.', 'נתונים: {0}.'], ['{0}. {1} Stop and target from {2}.', '{0}. {1} הסטופ והיעד לפי {2}.'],
    ['the stop is {0} away: {1}% of {2} does not buy one share', 'הסטופ במרחק {0}: {1}% מתוך {2} לא קונים אפילו מניה אחת'],
    ['{0}% a trade, {1}% a year to borrow', '{0}% לעסקה, {1}% לשנה לשאילה'], ['{0} of {1} (earlier half) · {2} of {3} (later half, untouched)', '{0} מתוך {1} (המחצית המוקדמת) · {2} מתוך {3} (המחצית המאוחרת, שלא נגענו בה)'],
    ['{0}% right', '{0}% צדקו'], ['{0}% right (95%: {1} to {2}%)', '{0}% צדקו (95%: {1} עד {2}%)'],
    ['Trades by conviction band, {0} so far: the earlier half shows what each band delivered, the later half checks it. Under 10 trades a band is "not known". Conviction is the margin of the vote, not a probability, until these numbers say otherwise.', 'עסקאות לפי רצועת ביטחון, {0} עד עכשיו: המחצית המוקדמת מראה מה כל רצועה הניבה, המאוחרת בודקת את זה. מתחת ל-10 עסקאות רצועה היא "לא ידוע". הביטחון הוא פער ההצבעה, לא הסתברות, עד שהמספרים האלה יגידו אחרת.'],
    ['"{0}" matches more than one company: {1}. Brief the room with the ticker you mean.', '"{0}" מתאים ליותר מחברה אחת: {1}. תדרכו את החדר עם הסימול שהתכוונתם אליו.'],
    ['{0} ({1}) was found, but it has no recent prices: it may be delisted or suspended.', '{0} ({1}) נמצאה, אבל אין לה מחירים עדכניים: ייתכן שנמחקה מהמסחר או שהמסחר בה הושעה.'],
    ['Twitter was taken private in October 2022 (it is now X Corp.) and no longer trades on any exchange.', 'טוויטר הפכה לחברה פרטית באוקטובר 2022 (היום X Corp.) ואינה נסחרת באף בורסה.'],
    ['{0} · version {1} · not connected', '{0} · גרסה {1} · לא מחובר'], ['{0} (a CFD on {1})', '{0} (CFD על {1})'], ['{0} (a CFD on {1}) · prices in {2}', '{0} (CFD על {1}) · מחירים ב-{2}'], ['{0} · prices in {1}', '{0} · מחירים ב-{1}'],
    ['Not verified for this profile: {0}.', 'לא אומת בפרופיל הזה: {0}.'], ['{0}: {1} {2}', '{0}: {1} {2}', 1],
    ['{0} ({1}% of the account)', '{0} ({1}% מהחשבון)'], ['needs {0}x: the position is worth more than the account', 'דורש פי {0}: הפוזיציה שווה יותר מהחשבון'], ['at most {0} for {1}', 'לכל היותר {0} עבור {1}'],
    ['the position is in {0}; an account in another currency adds exchange rate risk, not included here', 'הפוזיציה ב-{0}; חשבון במטבע אחר מוסיף סיכון שער, שלא נכלל כאן'],
    ['worst overnight gap in a year {0}% down, {1}% up; {2} of {3} sessions opened past a stop this far away. A stop does not cap the loss.', 'פער הפתיחה הגרוע בשנה: {0}% ירידה, {1}% עלייה; {2} מתוך {3} ימי מסחר נפתחו מעבר לסטופ במרחק כזה. סטופ לא מגביל את ההפסד.'],
    ['{0}R, about {1} at your risk per trade (hypothetical)', '{0}R, כ-{1} לפי הסיכון שלכם לעסקה (היפותטי)'],
    ['about {0} lost if it exits at the stop ({1}% of {2}); a gap can lose more', 'כ-{0} הפסד אם יוצאים בסטופ ({1}% מתוך {2}); פער פתיחה יכול להפסיד יותר'],
    ['about {0} lost at the stop if both fill ({1}% of {2} on the full size); a gap can lose more', 'כ-{0} הפסד בסטופ אם שתיהן מתבצעות ({1}% מתוך {2} על הגודל המלא); פער פתיחה יכול להפסיד יותר'],
    ['{0}% of {1} buys {2}: too little to split in halves', '{0}% מתוך {1} קונים {2}: מעט מדי לחלוקה לחצאים'],
    ['Hypothetical backtest on 10 years of US stocks, after assumed costs (not verified): {0} trades, {1}% won, {2}R a trade, profit factor {3}, worst run {4}R', 'בדיקה היסטורית היפותטית על 10 שנים של מניות אמריקאיות, אחרי עלויות משוערות (לא מאומת): {0} עסקאות, {1}% הצליחו, {2}R לעסקה, מקדם רווח {3}, הרצף הגרוע {4}R'],
    ['{0} of {1} (calibration) · {2} of {3} (test, untouched)', '{0} מתוך {1} (כיול) · {2} מתוך {3} (מבחן, שלא נגענו בו)'],
    ['Trades by conviction band, split by the date of the decision, fixed in advance: training before {0} (the only period the vote weights learn from), calibration until {1}, test after it (never used to set anything). So far {2} training, {3} calibration, {4} test trades. Under {5} trades a band is "not known". Conviction is the margin of the vote, not a probability, until these numbers say otherwise.{6}', 'עסקאות לפי רצועת ביטחון, מחולקות לפי תאריך ההחלטה, שנקבע מראש: אימון לפני {0} (התקופה היחידה שממנה משקלי ההצבעה לומדים), כיול עד {1}, מבחן אחריו (לא משמש לקבוע דבר). עד עכשיו {2} אימון, {3} כיול, {4} מבחן. מתחת ל-{5} עסקאות רצועה היא "לא ידוע". הביטחון הוא פער ההצבעה, לא הסתברות, עד שהמספרים האלה יגידו אחרת.{6}'],
    [' {0} calls could not be graded (no prices any more): counted, not dropped.', ' {0} החלטות לא ניתנו לדירוג (אין יותר מחירים): נספרו, לא הושמטו.'],
    ['Digit {0} of 6', 'ספרה {0} מתוך 6'],
    ['{0} Method {1}; "test" is the 10 year backtest with the same rules. 1R is the risk taken on a trade.', '{0} שיטה {1}; "בבדיקה" היא הבדיקה ההיסטורית של 10 שנים עם אותם כללים. 1R הוא הסיכון שנלקח בעסקה.'],
    ['Bullish {0}', 'שורי {0}'], ['Bearish {0}', 'דובי {0}'], ['Neutral {0}', 'ניטרלי {0}'],
    ['Now Bullish {0}', 'עכשיו שורי {0}'], ['Now Bearish {0}', 'עכשיו דובי {0}'], ['Now Neutral {0}', 'עכשיו ניטרלי {0}'],
    ['{0} conviction', 'ביטחון {0}'], ['{0} bps', '{0} נ״ב'], ['{0}% of book', '{0}% מהתיק'], ['{0} of book', '{0} מהתיק'],
    ['to {0}', 'אל {0}'],
    ['{0} scores for the bulls', '{0} קולע לטובת השוורים'], ['{0} swings for the bears', '{0} מכה לטובת הדובים'], ['{0} sits on the fence', '{0} יושב על הגדר'],
    ['{0} charges for the bulls', '{0} מסתער לטובת השוורים'], ['{0} charges for the bears', '{0} מסתער לטובת הדובים'], ['{0} weighs in from the middle', '{0} מתערב מהמרכז'],
    ['{0} changes sides. {1}', '{0} מחליף צד. {1}'], ['{0} backs off. {1}', '{0} נסוג. {1}'], ['{0} digs in. {1}', '{0} מתבצר. {1}'],
    ['Final round. {0} backs the bulls', 'סיבוב אחרון. {0} תומך בשוורים'], ['Final round. {0} backs the bears', 'סיבוב אחרון. {0} תומך בדובים'], ['Final round. {0} stays neutral', 'סיבוב אחרון. {0} נשאר ניטרלי'],
    ['Research is in on {0}. Risk, tell me how big this can be.', 'המחקר על {0} הגיע. סיכון, תגיד לי כמה גדול זה יכול להיות.'],
    ['New brief in {0} mode ({1}): {2}', 'תדריך חדש במצב {0} ({1}): {2}'], ['New brief in {0} mode ({1})', 'תדריך חדש במצב {0} ({1})'],
    ['Votes are in: {0} buy, {1} hold, {2} short, weighted by confidence and by {3} mode.', 'הקולות נספרו: {0} קנייה, {1} המתנה, {2} שורט, בשקלול לפי ביטחון ולפי מצב {3}.'],
    ['Votes are in: {0} buy, {1} hold, {2} sell, weighted by confidence and by {3} mode.', 'הקולות נספרו: {0} קנייה, {1} המתנה, {2} מכירה, בשקלול לפי ביטחון ולפי מצב {3}.'],
    ['{0} buy, {1} hold, {2} short. Votes are weighted by confidence and by mode. Tap a bot to read its report.', '{0} קנייה, {1} המתנה, {2} שורט. הקולות משוקללים לפי ביטחון ולפי מצב. הקישו על בוט כדי לקרוא את הדוח שלו.'],
    ['{0} buy, {1} hold, {2} sell. Votes are weighted by confidence and by mode. Tap a bot to read its report.', '{0} קנייה, {1} המתנה, {2} מכירה. הקולות משוקללים לפי ביטחון ולפי מצב. הקישו על בוט כדי לקרוא את הדוח שלו.'],
    ['Call: {0} {1} at {2} conviction. Memo is ready.', 'החלטה: {0} {1} בביטחון {2}. המזכר מוכן.'], ['Call: {0} at {1} conviction. Memo is ready.', 'החלטה: {0} בביטחון {1}. המזכר מוכן.'],
    ['Call: Hold on {0}. Memo is ready.', 'החלטה: המתנה ב-{0}. המזכר מוכן.'],
    ['{0} {1} at {2}% conviction', '{0} {1} בביטחון {2}%'], ['Short {0}', 'שורט {0}'], ['Buy {0}', 'קנייה {0}'], ['Hold {0}', 'המתנה {0}'], ['Sell {0}', 'מכירה {0}'],
    ['{0}, last {1}', '{0}, אחרון {1}', 1], ['last {0}', 'אחרון {0}', 1], ['{0} mode, {1}', 'מצב {0}, {1}', 1], ['Brain: {0}, {1}', 'מוח: {0}, {1}'],
    ['{0} mode: {1}. {2} lead the vote', 'מצב {0}: {1}. {2} מובילים את ההצבעה'], ['{0} mode. Waiting for your brief', 'מצב {0}. מחכה לתדריך שלך'],
    ['{0} ({1}): each desk reads the data and argues its case. A round takes up to a minute', '{0} ({1}): כל דסק קורא את הנתונים ומנמק את עמדתו. סבב לוקח עד דקה'],
    ['{0} is not set up yet: add {1} to the .env file on the server', '{0} עוד לא הוגדר: הוסיפו את {1} לקובץ ‎.env בשרת'],
    ['Gathering data. {0} desks are thinking', 'אוסף נתונים. הדסקים של {0} חושבים'], ['Thinking with {0}', 'חושב עם {0}'],
    ['Live data on {0}: last {1}. {2}', 'נתונים חיים על {0}: אחרון {1}. {2}'],
    ['Prices from Binance, news from Yahoo Finance.', 'מחירים מ-Binance, חדשות מ-Yahoo Finance.'], ['Prices, ratings and news from Yahoo Finance, filings from SEC EDGAR.', 'מחירים, דירוגים וחדשות מ-Yahoo Finance, דיווחים מ-SEC EDGAR.'],
    ['Tel Aviv Stock Exchange, prices in shekels from Yahoo Finance, measured against the TA-35, filings from SEC EDGAR through the New York listing.', 'הבורסה לניירות ערך בתל אביב, מחירים בשקלים מ-Yahoo Finance, מול מדד ת״א 35, דיווחים מ-SEC EDGAR דרך הרישום בניו יורק.'],
    ['Tel Aviv Stock Exchange, prices in shekels from Yahoo Finance, measured against the TA-35.', 'הבורסה לניירות ערך בתל אביב, מחירים בשקלים מ-Yahoo Finance, מול מדד ת״א 35.'],
    ['Also trades in {0} as {1}: {2}, which is {3} at {4} per dollar. {5} is {6} {7}.', 'נסחרת גם ב{0} בסימול {1}: {2}, שהם {3} לפי {4} לדולר. {5} {6} {7}.'],
    ['{0}% above', 'גבוה ב-{0}% מ'], ['{0}% below', 'נמוך ב-{0}% מ'], ['level with', 'שווה ל'],
    ['Base rate: {0}', 'שיעור בסיס: {0}'],
    ['on {0} past days that looked like today ({1}), the price was higher {2} sessions later {3}% of the time, {4}% on average (few similar days: a weak guide).', 'ב-{0} ימים בעבר שנראו כמו היום ({1}), המחיר היה גבוה יותר {2} ימי מסחר אחר כך ב-{3}% מהמקרים, {4}% בממוצע (מעט ימים דומים: מדד חלש).'],
    ['on {0} past days that looked like today ({1}), the price was higher {2} sessions later {3}% of the time, {4}% on average.', 'ב-{0} ימים בעבר שנראו כמו היום ({1}), המחיר היה גבוה יותר {2} ימי מסחר אחר כך ב-{3}% מהמקרים, {4}% בממוצע.'],
    ['Ticket approved. Working {0} slices.', 'הכרטיס אושר. מבצע {0} מנות.'], ['Slice {0} of {1} at {2}', 'מנה {0} מתוך {1} ב-{2}'], ['Filled at {0}', 'בוצע ב-{0}'],
    ['All {0} slices filled. Average price {1}.', 'כל {0} המנות בוצעו. מחיר ממוצע {1}.'], ['Order filled at an average of {0}', 'הפקודה בוצעה במחיר ממוצע של {0}'],
    ['Confirm: {0} {1} {2}', 'אישור: {0} {1} {2}'], ['Filled: {0} at {1}', 'בוצע: {0} ב-{1}'], ['Filled at the broker: {0} {1} at {2}', 'בוצע אצל הברוקר: {0} {1} ב-{2}'],
    ['Sent to the broker: bought {0} {1} at {2}, stop {3} at the broker.', 'נשלח לברוקר: נקנו {0} {1} ב-{2}, סטופ {3} אצל הברוקר.'], ['Sent to the broker: sold {0} {1} at {2}, stop {3} at the broker.', 'נשלח לברוקר: נמכרו {0} {1} ב-{2}, סטופ {3} אצל הברוקר.'],
    ['{0} at market', '{0} בשוק'], ['Buy {0} at market', 'קנייה של {0} בשוק'], ['Sell {0} at market', 'מכירה של {0} בשוק'], ['{0} · method {1}', '{0} · שיטה {1}'],
    ['Account · {0}', 'חשבון · {0}'], ['{0} today', '{0} היום'], ['risk {0}', 'סיכון {0}'], ['stop {0}', 'סטופ {0}'], ['Next: {0}', 'הבא: {0}'],
    ['{0} {1} · entry {2} · day {3}', '{0} {1} · כניסה {2} · יום {3}'], ['Close {0} now?', 'לסגור את {0} עכשיו?'], ['Closed {0} position', 'נסגרה פוזיציה {0}'], ['Closed {0} positions', 'נסגרו {0} פוזיציות'],
    ['Stop to break-even at {0} (+1R)', 'סטופ לנקודת האיזון ב-{0} ‏(+1R)'], ['Take half at {0} (+1.5R)', 'מימוש חצי ב-{0} ‏(+1.5R)'], ['Add the second half at {0} (+1R, needs your OK)', 'הוספת החצי השני ב-{0} ‏(+1R, דורש את אישורכם)'],
    ['Trailing 2 ATR behind the best close; time stop after 30 sessions', 'סטופ נגרר 2 ATR מאחורי הסגירה הטובה ביותר; סטופ זמן אחרי 30 ימי מסחר'],
    ['· {0} days on demo', '· {0} ימים בדמו'], ['· {0} day on demo', '· יום {0} בדמו'], ['· test {0}', '· בבדיקה {0}'],
    ['A call is graded against the real price {0} sessions after it is made. Average edge is the move in the direction of the call.', 'החלטה מדורגת מול המחיר האמיתי {0} ימי מסחר אחרי שהתקבלה. יתרון ממוצע הוא התנועה בכיוון ההחלטה.'],
    ['{0} · vote {1}', '{0} · משקל {1}'], ['{0} of {1} right', '{0} מתוך {1} צדקו'], ['{0} right of {1}', '{0} צדקו מתוך {1}'],
    ['The room starts learning after {0} graded calls in this mode ({1} so far). Until then every desk keeps its standard vote.', 'החדר מתחיל ללמוד אחרי {0} החלטות מדורגות במצב הזה ({1} עד עכשיו). עד אז לכל דסק משקל הצבעה רגיל.'],
    ['Desks in {0} mode', 'דסקים במצב {0}'], ['Loading {0}', 'טוען {0}'], ['Low {0}', 'נמוך {0}'], ['High {0}', 'גבוה {0}'], ['Since IPO ({0})', 'מאז ההנפקה ({0})'], ['Since its first day on Binance ({0})', 'מהיום הראשון ב-Binance ({0})'],
    ['{0} from the high, {1} from the low. Daily closes, last one {2}.', '{0} מהשיא, {1} מהשפל. סגירות יומיות, האחרונה ב-{2}.'], ['{0} from the high, {1} from the low. Daily closes (demo prices), last one {2}.', '{0} מהשיא, {1} מהשפל. סגירות יומיות (מחירי הדגמה), האחרונה ב-{2}.'],
    ['On the {0} hold calls the price moved {1}% on average while we stayed flat.', 'ב-{0} החלטות ההמתנה המחיר זז בממוצע {1}% בזמן שנשארנו בחוץ.'], ['call {0}', 'החלטה {0}'],
    ['price since {0} ({1} to {2})', 'המחיר מאז {0} (מ-{1} ל-{2})'],
    ['Volatility expected on {0}', 'צפויה תנודתיות ב-{0}'], ['Watching {0}. The bell rings when 3 of 5 signs line up', 'עוקב אחרי {0}. הפעמון יצלצל כש-3 מתוך 5 סימנים יתיישרו'],
    ['{0} of 5 warning signs', '{0} מתוך 5 סימני אזהרה'], ['Checked at {0}', 'נבדק ב-{0}'], ['{0}, {1} with the overall read', '{0}, {1} עם הקריאה הכוללת'],
    ['The crowd is unavailable: {0}', 'הקהל לא זמין: {0}'], ['Could not load market data: {0}', 'לא ניתן לטעון נתוני שוק: {0}'], ['Could not load the chart: {0}', 'לא ניתן לטעון את הגרף: {0}'], ['Could not reach the server: {0}', 'אין חיבור לשרת: {0}'],
    ['Is {0} worth owning for the long term after today’s {1}?', 'שווה להחזיק את {0} לטווח ארוך אחרי ה-{1} של היום?'], ['Is {0} a buy after today’s jump?', 'לקנות את {0} אחרי הקפיצה של היום?'], ['Is {0} a short after today’s drop?', 'שורט על {0} אחרי הנפילה של היום?'],
    ['today on {0} times normal volume', 'היום, במחזור של פי {0} מהרגיל'],
    ['Claude and Gemini agreed on {0} of {1} desks', 'Claude ו-Gemini הסכימו על {0} מתוך {1} דסקים'],
    ['Fact-check: {0} findings checked{1}', 'בדיקת עובדות: נבדקו {0} ממצאים{1}'], [', all supported', ', כולם נתמכים'], [', {0} corrected, {1} replaced by the rules finding', ', {0} תוקנו, {1} הוחלפו בממצא של החוקים'],
    ['Every desk, the debate and the memo were written by {0}.', 'כל דסק, הדיון והמזכר נכתבו על ידי {0}.'], ['Fell back to rules for: {0}', 'חזרה לחוקים עבור: {0}'], ['Written by {0}', 'נכתב על ידי {0}'],
    ['Live data from Yahoo Finance, Binance and SEC EDGAR. Execution is paper only. Version {0} from {1}.', 'נתונים חיים מ-Yahoo Finance, Binance ו-SEC EDGAR. הביצוע על הנייר בלבד. גרסה {0} מ-{1}.'],
    ['Live data · Paper trading · v{0}', 'נתונים חיים · מסחר על הנייר · v{0}'], ['Demo data, fictional companies · v{0}', 'נתוני הדגמה, חברות בדויות · v{0}'],
    ['cTrader {0} account {1}: balance, today\'s P&L and open risk (of {2} allowed). Tap for positions', 'חשבון cTrader {0} {1}: יתרה, רווח והפסד היום וסיכון פתוח (מתוך {2} מותר). הקישו לפוזיציות'],
    ['Market Analyst: {0}', 'אנליסט שוק: {0}'],
    // the crowd panel (server texts)
    ['#{0} most talked about on Reddit: {1} mentions in 24 h ({2} on the day before), {3} upvotes', 'מקום {0} בשיח ב-Reddit: {1} אזכורים ב-24 שעות ({2} לעומת היום הקודם), {3} הצבעות'],
    ['#{0} most talked about on Reddit: {1} mentions in 24 h, {2} upvotes', 'מקום {0} בשיח ב-Reddit: {1} אזכורים ב-24 שעות, {2} הצבעות'],
    ['{0}% of tagged posts bullish ({1} bull, {2} bear)', '{0}% מהפוסטים המתויגים שוריים ({1} שוריים, {2} דוביים)'],
    ['{0}% of CoinGecko voters say it goes up today', '{0}% ממצביעי CoinGecko אומרים שהוא יעלה היום'], ['{0}% of Binance futures accounts are long', '{0}% מחשבונות החוזים ב-Binance בלונג'],
    ['{0}% of Binance futures accounts are long: crowded', '{0}% מחשבונות החוזים ב-Binance בלונג: צפוף'],
    ['The biggest accounts hold {0}% of their positions long (long/short {1})', 'החשבונות הגדולים מחזיקים {0}% מהפוזיציות שלהם בלונג (לונג/שורט {1})'],
    ['{0}/100, {1}', '{0}/100, {1}'], ['{0} recent headlines, tone {1}', '{0} כותרות אחרונות, טון {1}'],
    ['VIX {0}: investors are calm, even complacent', 'VIX {0}: המשקיעים רגועים, אפילו שאננים'], ['VIX {0}: investors are fearful', 'VIX {0}: המשקיעים מפוחדים'], ['VIX {0}: some nerves', 'VIX {0}: קצת עצבים'], ['VIX {0}: steady', 'VIX {0}: יציב'],
    ['{0}% of the shares are sold short: a heavy bet against it', '{0}% מהמניות מוחזקות בשורט: הימור כבד נגדה'], ['{0}% of the shares are sold short: a sizeable bet against it', '{0}% מהמניות מוחזקות בשורט: הימור משמעותי נגדה'],
    ['{0}% of the shares are sold short: few bet against it', '{0}% מהמניות מוחזקות בשורט: מעטים מהמרים נגדה'], ['{0}% of the shares are sold short: a normal amount', '{0}% מהמניות מוחזקות בשורט: כמות רגילה'],
    ['The crowd agrees with the room: {0}, and the room says {1}', 'הקהל מסכים עם החדר: {0}, והחדר אומר {1}'], ['The crowd disagrees: it is {0} while the room says {1}', 'הקהל לא מסכים: הוא {0} בזמן שהחדר אומר {1}'],
    ['Half agree: the crowd is {0} and the room says {1}', 'חצי הסכמה: הקהל {0} והחדר אומר {1}'], ['{0}. The crowd is one-sided, which often means the trade is crowded', '{0}. הקהל חד-צדדי, ולרוב זה אומר שהעסקה צפופה'],
    ['go short', 'לשורט'], ['stay flat', 'להישאר בחוץ'],
    // the alert bell (server texts)
    ['{0} {1} ({2} in 5 days): above {3}, fear is high', '{0} {1} ‏({2} ב-5 ימים): מעל {3}, הפחד גבוה'], ['{0} {1} ({2} in 5 days): jumping fast', '{0} {1} ‏({2} ב-5 ימים): קופץ מהר'], ['{0} {1} ({2} in 5 days): below {3} and steady', '{0} {1} ‏({2} ב-5 ימים): מתחת ל-{3} ויציב'],
    ['{0}: no data', '{0}: אין נתונים'], ['Daily swings this week are {0}x the 60 day norm: breaking out', 'התנודות היומיות השבוע הן פי {0} מהנורמה של 60 יום: פריצה'], ['Daily swings this week are {0}x the 60 day norm', 'התנודות היומיות השבוע הן פי {0} מהנורמה של 60 יום'],
    ['Hedge funds net {0} {1} contracts, {2}th percentile of 3 years: crowded long', 'קרנות הגידור נטו ב{0} של {1} חוזים, אחוזון {2} של 3 שנים: לונג צפוף'], ['Hedge funds net {0} {1} contracts, {2}th percentile of 3 years: crowded short', 'קרנות הגידור נטו ב{0} של {1} חוזים, אחוזון {2} של 3 שנים: שורט צפוף'],
    ['Hedge funds net {0} {1} contracts, {2}th percentile of 3 years', 'קרנות הגידור נטו ב{0} של {1} חוזים, אחוזון {2} של 3 שנים'], ['long', 'לונג'],
    ['{0} escalation headlines in 2 days, e.g. “{1}”', '{0} כותרות הסלמה ביומיים, למשל “{1}”'], ['{0} escalation headline in 2 days, e.g. “{1}”', 'כותרת הסלמה אחת ביומיים: “{1}”'],
    ['Front month {0} over the next, {1}; {2} points in 5 days: the curve flipped', 'החוזה הקרוב {0} מעל הבא, {1}; {2} נקודות ב-5 ימים: העקום התהפך'], ['Front month {0} over the next, {1}; {2} points in 5 days: moving sharply', 'החוזה הקרוב {0} מעל הבא, {1}; {2} נקודות ב-5 ימים: זז בחדות'],
    ['Front month {0} over the next, {1}; {2} points in 5 days', 'החוזה הקרוב {0} מעל הבא, {1}; {2} נקודות ב-5 ימים'], ['backwardation', 'בקוורדיישן'], ['contango', 'קונטנגו'],
    ['Volatility expected: {0} warning signs: {1}. Tap to silence.', 'צפויה תנודתיות: {0} סימני אזהרה: {1}. הקישו להשתקה.'],
    // generic shapes last: used only when every part with words in it translates too
    ['{0} of {1}', '{0} מתוך {1}', 1], ['{0}: {1}', '{0}: {1}', 1], ['{0} · {1}', '{0} · {1}', 1], ['✕ {0}', '✕ {0}', 1],
    ['Fed rate decision', 'החלטת הריבית של הפד'], ['EIA weekly oil inventories', 'מלאי הנפט השבועי של EIA'], ['API inventory report', 'דוח המלאים של API'], ['Baker Hughes rig count', 'ספירת אסדות Baker Hughes'], ['EIA natural gas storage', 'מלאי הגז הטבעי של EIA'], ['Earnings report', 'דוח רבעוני']
  ];

  var rx = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  var CP = P.map(function (p) { return [new RegExp('^' + rx(p[0]).replace(/\\\{(\d)\\\}/g, '([\\s\\S]+?)') + '$'), p[1], !!p[2], p[0].replace(/\{\d\}/g, '').length]; })
    // the most specific template first: the one with the most fixed text
    .sort(function (a, b) { return b[3] - a[3]; });
  // numbers with a sign, a currency or a unit: kept left to right inside Hebrew (LRI ... PDI)
  // a sign counts only at the start or after a space or bracket: the hyphen in "ב-$171" is Hebrew, not a minus
  var LRI = '⁦', PDI = '⁩';
  var NUM = /(?:(?<=^|[\s(])[+\-−])?[$₪]?\d[\d,.]*\d(?:%|x|R|bn|m|k|tn)?|(?:(?<=^|[\s(])[+\-−])?[$₪]?\d(?:%|x|R|bn|m|k|tn)?/g;
  var iso = function (s) {
    if (s.indexOf(LRI) >= 0) return s;
    return s.replace(NUM, function (m) { return /[+\-−$₪%]|\dR$|\dx$/.test(m) ? LRI + m + PDI : m; });
  };
  var memo = new Map();
  function core(c, depth) {
    if (Object.prototype.hasOwnProperty.call(E, c)) return E[c];
    if (depth > 2 || !/[A-Za-z]/.test(c)) return null;
    for (var i = 0; i < CP.length; i++) {
      var g = c.match(CP[i][0]);
      if (!g) continue;
      var parts = g.slice(1).map(function (v) { return core(v, depth + 1); });
      // a generic shape: every part must translate, except a proper name (capitalised words, a ticker); a sentence must not be cut up
      if (CP[i][2] && parts.some(function (x, k) { return x == null && /(^|[\s(])[a-z]{2,}/.test(g[k + 1]); })) continue;
      return CP[i][1].replace(/\{(\d)\}/g, function (_, n) { return parts[+n] == null ? g[+n + 1] : parts[+n]; });
    }
    // "Sentence." and "Sentence" are the same phrase
    var dot = c.match(/^([\s\S]+?)([.:!?]+)$/);
    if (dot) { var t = core(dot[1], depth + 1); if (t != null) return t + dot[2]; }
    return null;
  }
  function t(s) {
    if (lang !== 'he' || typeof s !== 'string' || !s) return s;
    if (memo.has(s)) return memo.get(s);
    var m = s.match(/^(\s*)([\s\S]*?)(\s*)$/), r = core(m[2], 0), out = r == null ? s : m[1] + r + m[3];
    if (/[֐-׿]/.test(out) || !/[A-Za-z]/.test(out)) out = iso(out);
    if (memo.size > 5000) memo.clear();
    memo.set(s, out);
    return out;
  }

  /* ---------- the page: text nodes and attributes, translated in place, English kept ---------- */
  var SKIP = 'script,style,canvas,textarea,input,select,[translate="no"],.notranslate';
  var ATTRS = ['title', 'placeholder', 'aria-label'];
  var TXT = new WeakMap(), ATT = new WeakMap();
  function doText(n) {
    var p = n.parentElement;
    if (!p || p.closest(SKIP)) return;
    var v = n.nodeValue, rec = TXT.get(n);
    if (rec && v === rec.he) return;
    if (lang !== 'he') return;
    var he = t(v);
    if (he !== v) { TXT.set(n, { en: v, he: he }); n.nodeValue = he; } else TXT.delete(n);
  }
  function doAttrs(el) {
    if (el.closest && el.closest(SKIP) && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
    var rec = ATT.get(el) || {};
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a);
      if (v == null || (rec[a] && v === rec[a].he) || lang !== 'he') continue;
      var he = t(v);
      if (he !== v) { rec[a] = { en: v, he: he }; el.setAttribute(a, he); }
    }
    ATT.set(el, rec);
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) { if (root.matches && root.matches('script,style')) return; doAttrs(root); }
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }
  function restore() {
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) { var r = TXT.get(n); if (r && n.nodeValue === r.he) n.nodeValue = r.en; TXT.delete(n); }
      else { var a = ATT.get(n); if (a) { for (var k in a) if (n.getAttribute(k) === a[k].he) n.setAttribute(k, a[k].en); ATT.delete(n); } }
    }
  }
  var obs = new MutationObserver(function (ms) {
    if (lang !== 'he') return;
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttrs(m.target);
      else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
    }
  });

  /* ---------- right to left, the Hebrew font ---------- */
  function css() {
    if (document.getElementById('i18n-css')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Rubik:wght@400..800&display=swap';
    document.head.appendChild(l);
    var s = document.createElement('style');
    s.id = 'i18n-css';
    // Rubik draws the Hebrew; the Latin fonts stay first so tickers and numbers keep their look.
    // The tape, the charts and number cells stay left to right.
    s.textContent = 'html[lang=he] body{font-family:var(--body),Rubik,system-ui,sans-serif}' +
      'html[lang=he] .brand,html[lang=he] h1,html[lang=he] h2,html[lang=he] h3,html[lang=he] .verdict{font-family:var(--display),Rubik,system-ui,sans-serif}' +
      'html[lang=he] .tape,html[lang=he] .tk-t,html[lang=he] canvas,html[lang=he] .digits,html[lang=he] .codes,html[lang=he] #tk,html[lang=he] .clock{direction:ltr}' +
      'html[lang=he] .tile strong,html[lang=he] .ticket strong,html[lang=he] #px,html[lang=he] #chg,html[lang=he] .pf-row b{unicode-bidi:isolate}' +
      '.lang-b{min-width:38px;font-weight:700;font-size:13px;letter-spacing:.02em}';
    document.head.appendChild(s);
  }
  function setDir() {
    var h = document.documentElement;
    h.lang = lang; h.dir = lang === 'he' ? 'rtl' : 'ltr';
    if (lang === 'he') css();
    var bs = document.querySelectorAll('[data-lang-toggle]');
    for (var i = 0; i < bs.length; i++) { bs[i].textContent = lang === 'he' ? 'EN' : 'עב'; bs[i].setAttribute('aria-label', lang === 'he' ? 'Switch to English' : 'מעבר לעברית'); bs[i].title = lang === 'he' ? 'English' : 'עברית'; }
  }
  function set(l) {
    l = l === 'he' ? 'he' : 'en';
    if (l === lang) return;
    lang = l;
    try { localStorage.setItem(KEY, l); } catch (e) { /* not remembered */ }
    memo.clear();
    setDir();
    if (l === 'he') walk(document.body); else restore();
    document.title = l === 'he' ? t(document.title) : (document.title = TITLE);
    window.dispatchEvent(new CustomEvent('i18n:change', { detail: { lang: l } }));
  }
  var TITLE = document.title;
  function start() {
    TITLE = document.title;
    setDir();
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    if (lang === 'he') { walk(document.body); document.title = t(TITLE); }
    document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-lang-toggle]'); if (b) { e.preventDefault(); set(lang === 'he' ? 'en' : 'he'); } });
  }
  setDir();
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  window.I18N = { get lang() { return lang; }, set: set, t: t, iso: iso, E: E, P: P };
})();
