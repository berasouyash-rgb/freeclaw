// ═══════════════════════════════════════════════════════════════════
// preloaderI18n — all-languages copy for the boot layer.
// ═══════════════════════════════════════════════════════════════════
// The preloader is a thin layer — only a handful of strings need
// translating (status labels, error copy, actions). The browser locale
// is detected from navigator.languages / navigator.language (with a
// languagechange listener), resolved to a catalog entry (zh-TW vs zh-CN,
// pt-BR → pt, nb/no → nb, fil/tl → fil …), and every unresolved locale
// falls back to English. The catalog is flat and small on purpose — the
// machine states themselves (INITIALIZING/LOADING/…) never change, only
// the human-readable text does.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";

export type PreloaderTextKey =
	| "starting"
	| "loading"
	| "verifying"
	| "ready"
	| "error"
	| "retry"
	| "continue"
	| "errorMsg";

type LocaleStrings = Record<PreloaderTextKey, string>;

const EN: LocaleStrings = {
	starting: "Starting",
	loading: "Preparing your workspace",
	verifying: "Verifying",
	ready: "Ready",
	error: "Something needs attention",
	retry: "Retry",
	continue: "Continue",
	errorMsg:
		"We couldn't fully prepare your workspace. You can retry, or continue with a limited experience.",
};

/** Locale → strings. Add a language here to make the preloader speak it. */
export const PRELOADER_STRINGS: Record<string, LocaleStrings> = {
	en: EN,
	es: {
		starting: "Iniciando",
		loading: "Preparando tu espacio de trabajo",
		verifying: "Verificando",
		ready: "Listo",
		error: "Algo requiere atención",
		retry: "Reintentar",
		continue: "Continuar",
		errorMsg:
			"No pudimos preparar completamente tu espacio de trabajo. Puedes reintentar o continuar con una experiencia limitada.",
	},
	fr: {
		starting: "Démarrage",
		loading: "Préparation de votre espace de travail",
		verifying: "Vérification",
		ready: "Prêt",
		error: "Quelque chose nécessite votre attention",
		retry: "Réessayer",
		continue: "Continuer",
		errorMsg:
			"Nous n'avons pas pu préparer entièrement votre espace de travail. Vous pouvez réessayer ou continuer avec une expérience limitée.",
	},
	de: {
		starting: "Starten",
		loading: "Ihr Arbeitsbereich wird vorbereitet",
		verifying: "Wird geprüft",
		ready: "Bereit",
		error: "Etwas erfordert Ihre Aufmerksamkeit",
		retry: "Erneut versuchen",
		continue: "Weiter",
		errorMsg:
			"Wir konnten Ihren Arbeitsbereich nicht vollständig vorbereiten. Sie können es erneut versuchen oder mit einer eingeschränkten Erfahrung fortfahren.",
	},
	it: {
		starting: "Avvio",
		loading: "Preparazione dell'area di lavoro",
		verifying: "Verifica",
		ready: "Pronto",
		error: "Qualcosa richiede attenzione",
		retry: "Riprova",
		continue: "Continua",
		errorMsg:
			"Non siamo riusciti a preparare completamente il tuo spazio di lavoro. Puoi riprovare o continuare con un'esperienza limitata.",
	},
	pt: {
		starting: "Iniciando",
		loading: "Preparando seu espaço de trabalho",
		verifying: "Verificando",
		ready: "Pronto",
		error: "Algo precisa de atenção",
		retry: "Tentar novamente",
		continue: "Continuar",
		errorMsg:
			"Não foi possível preparar totalmente seu espaço de trabalho. Você pode tentar novamente ou continuar com uma experiência limitada.",
	},
	nl: {
		starting: "Starten",
		loading: "Uw werkruimte wordt voorbereid",
		verifying: "Controleren",
		ready: "Klaar",
		error: "Er is aandacht nodig",
		retry: "Opnieuw proberen",
		continue: "Doorgaan",
		errorMsg:
			"We konden uw werkruimte niet volledig voorbereiden. U kunt het opnieuw proberen of doorgaan met een beperkte ervaring.",
	},
	pl: {
		starting: "Uruchamianie",
		loading: "Przygotowywanie przestrzeni roboczej",
		verifying: "Weryfikowanie",
		ready: "Gotowe",
		error: "Coś wymaga uwagi",
		retry: "Ponów",
		continue: "Kontynuuj",
		errorMsg:
			"Nie udało nam się w pełni przygotować Twojej przestrzeni roboczej. Możesz spróbować ponownie lub kontynuować z ograniczonym doświadczeniem.",
	},
	ru: {
		starting: "Запуск",
		loading: "Подготовка рабочего пространства",
		verifying: "Проверка",
		ready: "Готово",
		error: "Требуется внимание",
		retry: "Повторить",
		continue: "Продолжить",
		errorMsg:
			"Не удалось полностью подготовить ваше рабочее пространство. Вы можете повторить попытку или продолжить с ограниченными возможностями.",
	},
	uk: {
		starting: "Запуск",
		loading: "Підготовка робочого простору",
		verifying: "Перевірка",
		ready: "Готово",
		error: "Потрібна увага",
		retry: "Повторити",
		continue: "Продовжити",
		errorMsg:
			"Не вдалося повністю підготувати ваш робочий простір. Ви можете повторити спробу або продовжити з обмеженими можливостями.",
	},
	tr: {
		starting: "Başlatılıyor",
		loading: "Çalışma alanınız hazırlanıyor",
		verifying: "Doğrulanıyor",
		ready: "Hazır",
		error: "Dikkat gerektiren bir şey var",
		retry: "Yeniden dene",
		continue: "Devam et",
		errorMsg:
			"Çalışma alanınız tam olarak hazırlanamadı. Yeniden deneyebilir veya sınırlı bir deneyimle devam edebilirsiniz.",
	},
	ar: {
		starting: "جارٍ التشغيل",
		loading: "جارٍ تجهيز مساحة العمل",
		verifying: "جارٍ التحقق",
		ready: "جاهز",
		error: "هناك ما يحتاج إلى انتباه",
		retry: "إعادة المحاولة",
		continue: "متابعة",
		errorMsg:
			"تعذّر تجهيز مساحة العمل بالكامل. يمكنك إعادة المحاولة أو المتابعة بتجربة محدودة.",
	},
	he: {
		starting: "מתחיל",
		loading: "מכין את סביבת העבודה",
		verifying: "מוודא",
		ready: "מוכן",
		error: "משהו דורש תשומת לב",
		retry: "נסה שוב",
		continue: "המשך",
		errorMsg:
			"לא הצלחנו להכין את סביבת העבודה במלואה. ניתן לנסות שוב או להמשיך עם חוויה מוגבלת.",
	},
	hi: {
		starting: "प्रारंभ हो रहा है",
		loading: "आपका कार्यक्षेत्र तैयार हो रहा है",
		verifying: "सत्यापित हो रहा है",
		ready: "तैयार",
		error: "कुछ ध्यान देने की आवश्यकता है",
		retry: "पुनः प्रयास करें",
		continue: "जारी रखें",
		errorMsg:
			"हम आपका कार्यक्षेत्र पूरी तरह तैयार नहीं कर सके। आप पुनः प्रयास कर सकते हैं या सीमित अनुभव के साथ जारी रख सकते हैं।",
	},
	bn: {
		starting: "শুরু হচ্ছে",
		loading: "আপনার কর্মক্ষেত্র প্রস্তুত করা হচ্ছে",
		verifying: "যাচাই করা হচ্ছে",
		ready: "প্রস্তুত",
		error: "কিছু মনোযোগ প্রয়োজন",
		retry: "আবার চেষ্টা করুন",
		continue: "চালিয়ে যান",
		errorMsg:
			"আমরা আপনার কর্মক্ষেত্র সম্পূর্ণভাবে প্রস্তুত করতে পারিনি। আপনি আবার চেষ্টা করতে পারেন বা সীমিত অভিজ্ঞতার সাথে চালিয়ে যেতে পারেন।",
	},
	"zh-CN": {
		starting: "正在启动",
		loading: "正在准备您的工作区",
		verifying: "正在验证",
		ready: "就绪",
		error: "有事项需要注意",
		retry: "重试",
		continue: "继续",
		errorMsg: "我们无法完全准备您的工作区。您可以重试，或继续使用有限的功能。",
	},
	"zh-TW": {
		starting: "正在啟動",
		loading: "正在準備您的工作區",
		verifying: "正在驗證",
		ready: "就緒",
		error: "有事項需要注意",
		retry: "重試",
		continue: "繼續",
		errorMsg: "我們無法完全準備您的工作區。您可以重試，或繼續使用有限的功能。",
	},
	ja: {
		starting: "起動中",
		loading: "ワークスペースを準備しています",
		verifying: "確認中",
		ready: "準備完了",
		error: "対応が必要な項目があります",
		retry: "再試行",
		continue: "続行",
		errorMsg:
			"ワークスペースを完全に準備できませんでした。再試行するか、限定的な機能で続行できます。",
	},
	ko: {
		starting: "시작 중",
		loading: "작업 공간을 준비하는 중",
		verifying: "확인 중",
		ready: "준비 완료",
		error: "주의가 필요한 항목이 있습니다",
		retry: "다시 시도",
		continue: "계속",
		errorMsg:
			"작업 공간을 완전히 준비하지 못했습니다. 다시 시도하거나 제한된 환경에서 계속할 수 있습니다.",
	},
	vi: {
		starting: "Đang khởi động",
		loading: "Đang chuẩn bị không gian làm việc",
		verifying: "Đang xác minh",
		ready: "Sẵn sàng",
		error: "Có điều cần chú ý",
		retry: "Thử lại",
		continue: "Tiếp tục",
		errorMsg:
			"Không thể chuẩn bị đầy đủ không gian làm việc của bạn. Bạn có thể thử lại hoặc tiếp tục với trải nghiệm hạn chế.",
	},
	th: {
		starting: "กำลังเริ่มต้น",
		loading: "กำลังเตรียมพื้นที่ทำงานของคุณ",
		verifying: "กำลังตรวจสอบ",
		ready: "พร้อม",
		error: "มีบางอย่างที่ต้องให้ความสนใจ",
		retry: "ลองอีกครั้ง",
		continue: "ดำเนินการต่อ",
		errorMsg:
			"เราไม่สามารถเตรียมพื้นที่ทำงานของคุณได้อย่างสมบูรณ์ คุณสามารถลองอีกครั้งหรือดำเนินการต่อด้วยประสบการณ์ที่จำกัด",
	},
	id: {
		starting: "Memulai",
		loading: "Menyiapkan ruang kerja Anda",
		verifying: "Memverifikasi",
		ready: "Siap",
		error: "Ada yang memerlukan perhatian",
		retry: "Coba lagi",
		continue: "Lanjutkan",
		errorMsg:
			"Kami tidak dapat menyiapkan ruang kerja Anda sepenuhnya. Anda dapat mencoba lagi atau melanjutkan dengan pengalaman terbatas.",
	},
	ms: {
		starting: "Memulakan",
		loading: "Menyediakan ruang kerja anda",
		verifying: "Mengesahkan",
		ready: "Sedia",
		error: "Ada yang memerlukan perhatian",
		retry: "Cuba semula",
		continue: "Teruskan",
		errorMsg:
			"Kami tidak dapat menyediakan ruang kerja anda sepenuhnya. Anda boleh mencuba semula atau meneruskan dengan pengalaman terhad.",
	},
	sv: {
		starting: "Startar",
		loading: "Förbereder din arbetsyta",
		verifying: "Verifierar",
		ready: "Redo",
		error: "Något kräver uppmärksamhet",
		retry: "Försök igen",
		continue: "Fortsätt",
		errorMsg:
			"Vi kunde inte förbereda din arbetsyta fullt ut. Du kan försöka igen eller fortsätta med en begränsad upplevelse.",
	},
	da: {
		starting: "Starter",
		loading: "Forbereder din arbejdsplads",
		verifying: "Verificerer",
		ready: "Klar",
		error: "Noget kræver opmærksomhed",
		retry: "Prøv igen",
		continue: "Fortsæt",
		errorMsg:
			"Vi kunne ikke forberede din arbejdsplads fuldt ud. Du kan prøve igen eller fortsætte med en begrænset oplevelse.",
	},
	fi: {
		starting: "Käynnistetään",
		loading: "Valmistellaan työtilaasi",
		verifying: "Varmistetaan",
		ready: "Valmis",
		error: "Jokin vaatii huomiota",
		retry: "Yritä uudelleen",
		continue: "Jatka",
		errorMsg:
			"Emme voineet valmistella työtilaasi täysin. Voit yrittää uudelleen tai jatkaa rajoitetulla kokemuksella.",
	},
	nb: {
		starting: "Starter",
		loading: "Forbereder arbeidsområdet ditt",
		verifying: "Verifiserer",
		ready: "Klar",
		error: "Noe krever oppmerksomhet",
		retry: "Prøv igjen",
		continue: "Fortsett",
		errorMsg:
			"Vi kunne ikke forberede arbeidsområdet ditt fullt ut. Du kan prøve igjen eller fortsette med en begrenset opplevelse.",
	},
	cs: {
		starting: "Spouštění",
		loading: "Příprava vašeho pracovního prostoru",
		verifying: "Ověřování",
		ready: "Připraveno",
		error: "Něco vyžaduje pozornost",
		retry: "Zkusit znovu",
		continue: "Pokračovat",
		errorMsg:
			"Nepodařilo se nám plně připravit váš pracovní prostor. Můžete to zkusit znovu nebo pokračovat s omezeným zážitkem.",
	},
	sk: {
		starting: "Spúšťanie",
		loading: "Príprava vášho pracovného priestoru",
		verifying: "Overovanie",
		ready: "Pripravené",
		error: "Niečo si vyžaduje pozornosť",
		retry: "Skúsiť znova",
		continue: "Pokračovať",
		errorMsg:
			"Nepodarilo sa nám úplne pripraviť váš pracovný priestor. Môžete to skúsiť znova alebo pokračovať s obmedzeným zážitkom.",
	},
	hu: {
		starting: "Indítás",
		loading: "A munkaterület előkészítése",
		verifying: "Ellenőrzés",
		ready: "Kész",
		error: "Valami figyelmet igényel",
		retry: "Újra",
		continue: "Folytatás",
		errorMsg:
			"Nem sikerült teljesen előkészíteni a munkaterületet. Újrapróbálhatja, vagy korlátozott élménnyel folytathatja.",
	},
	ro: {
		starting: "Pornire",
		loading: "Se pregătește spațiul de lucru",
		verifying: "Se verifică",
		ready: "Gata",
		error: "Ceva necesită atenție",
		retry: "Reîncearcă",
		continue: "Continuă",
		errorMsg:
			"Nu am putut pregăti complet spațiul de lucru. Poți reîncerca sau continua cu o experiență limitată.",
	},
	bg: {
		starting: "Стартиране",
		loading: "Подготовка на работното пространство",
		verifying: "Проверка",
		ready: "Готово",
		error: "Нещо изисква внимание",
		retry: "Опитай отново",
		continue: "Продължи",
		errorMsg:
			"Не успяхме напълно да подготвим вашето работно пространство. Можете да опитате отново или да продължите с ограничено изживяване.",
	},
	el: {
		starting: "Εκκίνηση",
		loading: "Προετοιμασία του χώρου εργασίας σας",
		verifying: "Επαλήθευση",
		ready: "Έτοιμο",
		error: "Κάτι χρειάζεται προσοχή",
		retry: "Δοκιμή ξανά",
		continue: "Συνέχεια",
		errorMsg:
			"Δεν μπορέσαμε να προετοιμάσουμε πλήρως τον χώρο εργασίας σας. Μπορείτε να δοκιμάσετε ξανά ή να συνεχίσετε με περιορισμένη εμπειρία.",
	},
	hr: {
		starting: "Pokretanje",
		loading: "Priprema vašeg radnog prostora",
		verifying: "Provjera",
		ready: "Spremno",
		error: "Nešto zahtijeva pozornost",
		retry: "Pokušaj ponovno",
		continue: "Nastavi",
		errorMsg:
			"Nismo mogli u potpunosti pripremiti vaš radni prostor. Možete pokušati ponovno ili nastaviti s ograničenim iskustvom.",
	},
	sr: {
		starting: "Покретање",
		loading: "Припрема вашег радног простора",
		verifying: "Провера",
		ready: "Спреман",
		error: "Нешто захтева пажњу",
		retry: "Покушај поново",
		continue: "Настави",
		errorMsg:
			"Нисмо могли у потпуности да припремимо ваш радни простор. Можете покушати поново или наставити са ограниченим искуством.",
	},
	lt: {
		starting: "Paleidimas",
		loading: "Ruošiama jūsų darbo erdvė",
		verifying: "Tikrinama",
		ready: "Paruošta",
		error: "Kažkas reikalauja dėmesio",
		retry: "Bandyti dar kartą",
		continue: "Tęsti",
		errorMsg:
			"Nepavyko visiškai paruošti jūsų darbo erdvės. Galite bandyti dar kartą arba tęsti su ribota patirtimi.",
	},
	lv: {
		starting: "Palaišana",
		loading: "Jūsu darbvietes sagatavošana",
		verifying: "Pārbaude",
		ready: "Gatavs",
		error: "Kaut kam nepieciešama uzmanība",
		retry: "Mēģināt vēlreiz",
		continue: "Turpināt",
		errorMsg:
			"Mēs nevarējām pilnībā sagatavot jūsu darbvieti. Varat mēģināt vēlreiz vai turpināt ar ierobežotu pieredzi.",
	},
	et: {
		starting: "Käivitamine",
		loading: "Teie tööruumi ettevalmistamine",
		verifying: "Kontrollimine",
		ready: "Valmis",
		error: "Miski vajab tähelepanu",
		retry: "Proovi uuesti",
		continue: "Jätka",
		errorMsg:
			"Me ei saanud teie tööruumi täielikult ette valmistada. Võite proovida uuesti või jätkata piiratud kogemusega.",
	},
	sl: {
		starting: "Zagon",
		loading: "Pripravljanje vašega delovnega prostora",
		verifying: "Preverjanje",
		ready: "Pripravljeno",
		error: "Nekaj zahteva pozornost",
		retry: "Poskusi znova",
		continue: "Nadaljuj",
		errorMsg:
			"Vašega delovnega prostora nismo mogli v celoti pripraviti. Poskusite znova ali nadaljujte z omejeno izkušnjo.",
	},
	fa: {
		starting: "در حال راه‌اندازی",
		loading: "در حال آماده‌سازی فضای کاری شما",
		verifying: "در حال تأیید",
		ready: "آماده",
		error: "چیزی نیاز به توجه دارد",
		retry: "تلاش مجدد",
		continue: "ادامه",
		errorMsg:
			"ما نتوانستیم فضای کاری شما را کاملاً آماده کنیم. می‌توانید دوباره تلاش کنید یا با تجربه‌ای محدود ادامه دهید.",
	},
	ur: {
		starting: "شروع ہو رہا ہے",
		loading: "آپ کی ورک اسپیس تیار ہو رہی ہے",
		verifying: "تصدیق ہو رہی ہے",
		ready: "تیار",
		error: "کسی چیز پر توجہ کی ضرورت ہے",
		retry: "دوبارہ کوشش کریں",
		continue: "جاری رکھیں",
		errorMsg:
			"ہم آپ کی ورک اسپیس مکمل طور پر تیار نہیں کر سکے۔ آپ دوبارہ کوشش کر سکتے ہیں یا محدود تجربے کے ساتھ جاری رکھ سکتے ہیں۔",
	},
	ta: {
		starting: "தொடங்குகிறது",
		loading: "உங்கள் பணியிடம் தயாராகிறது",
		verifying: "சரிபார்க்கிறது",
		ready: "தயார்",
		error: "கவனம் தேவைப்படும் ஒன்று உள்ளது",
		retry: "மீண்டும் முயற்சி",
		continue: "தொடரவும்",
		errorMsg:
			"உங்கள் பணியிடத்தை முழுமையாகத் தயாரிக்க முடியவில்லை. நீங்கள் மீண்டும் முயற்சி செய்யலாம் அல்லது வரம்புக்குட்பட்ட அனுபவத்துடன் தொடரலாம்.",
	},
	te: {
		starting: "ప్రారంభిస్తోంది",
		loading: "మీ పని ప్రదేశం సిద్ధమవుతోంది",
		verifying: "ధృవీకరిస్తోంది",
		ready: "సిద్ధంగా ఉంది",
		error: "శ్రద్ధ అవసరమైన విషయం ఉంది",
		retry: "మళ్లీ ప్రయత్నించండి",
		continue: "కొనసాగించండి",
		errorMsg:
			"మేము మీ పని ప్రదేశాన్ని పూర్తిగా సిద్ధం చేయలేకపోయాము. మీరు మళ్లీ ప్రయత్నించవచ్చు లేదా పరిమిత అనుభవంతో కొనసాగవచ్చు.",
	},
	ml: {
		starting: "ആരംഭിക്കുന്നു",
		loading: "നിങ്ങളുടെ വർക്ക്സ്പെയ്സ് തയ്യാറാക്കുന്നു",
		verifying: "പരിശോധിക്കുന്നു",
		ready: "തയ്യാറാണ്",
		error: "ശ്രദ്ധ ആവശ്യമുള്ള എന്തോ ഉണ്ട്",
		retry: "വീണ്ടും ശ്രമിക്കുക",
		continue: "തുടരുക",
		errorMsg:
			"നിങ്ങളുടെ വർക്ക്സ്പെയ്സ് പൂർണ്ണമായി തയ്യാറാക്കാൻ ഞങ്ങൾക്ക് കഴിഞ്ഞില്ല. നിങ്ങൾക്ക് വീണ്ടും ശ്രമിക്കാം അല്ലെങ്കിൽ പരിമിതമായ അനുഭവത്തോടെ തുടരാം.",
	},
	sw: {
		starting: "Inaanzisha",
		loading: "Inaandaa nafasi yako ya kazi",
		verifying: "Inathibitisha",
		ready: "Tayari",
		error: "Kuna kitu kinachohitaji umakini",
		retry: "Jaribu tena",
		continue: "Endelea",
		errorMsg:
			"Hatukuweza kuandaa nafasi yako ya kazi kikamilifu. Unaweza kujaribu tena au kuendelea na uzoefu mdogo.",
	},
	fil: {
		starting: "Sinisimulan",
		loading: "Inihahanda ang iyong workspace",
		verifying: "Bine-verify",
		ready: "Handa na",
		error: "May nangangailangan ng atensyon",
		retry: "Subukan muli",
		continue: "Magpatuloy",
		errorMsg:
			"Hindi namin lubos na maihanda ang iyong workspace. Maaari mong subukan muli o magpatuloy sa limitadong karanasan.",
	},
};

/** Normalize a single language tag to a catalog key (falls back to "en"). */
export function resolveLocale(lang?: string | null): string {
	if (!lang) return "en";
	const base = lang.toLowerCase();
	// Traditional / Hong Kong / Macau Chinese → zh-TW; everything else zh → zh-CN
	if (base === "zh" || base.startsWith("zh-")) {
		return /zh-(tw|hk|mo|hant)/.test(base) ? "zh-TW" : "zh-CN";
	}
	if (base.startsWith("no") || base === "nb" || base.startsWith("nb-")) return "nb";
	if (base.startsWith("tl") || base.startsWith("fil")) return "fil";
	const code = base.split("-")[0] ?? base;
	return PRELOADER_STRINGS[code] ? code : "en";
}

/**
 * Detect the user's preferred locale from the browser. `languages` is the
 * ordered preference list; the first resolvable entry wins. Safe when
 * navigator is unavailable (SSR / ancient browsers).
 */
export function detectLocale(): string {
	try {
		if (typeof navigator === "undefined") return "en";
		const list = navigator.languages?.length ? navigator.languages : [navigator.language];
		for (const l of list) {
			const resolved = resolveLocale(l);
			if (resolved !== "en") return resolved;
		}
		return resolveLocale(list[0]);
	} catch {
		return "en";
	}
}

/** Translate a key for a given locale (falls back to English). */
export function t(key: PreloaderTextKey, locale: string = detectLocale()): string {
	return PRELOADER_STRINGS[locale]?.[key] ?? EN[key];
}

/** React hook — returns the active preloader locale, re-checking on change. */
export function usePreloaderLocale(): string {
	const [locale, setLocale] = useState<string>(() => detectLocale());
	useEffect(() => {
		const update = () => setLocale(detectLocale());
		try {
			window.addEventListener("languagechange", update);
		} catch {
			/* no-op — static detection still applies */
		}
		return () => {
			try {
				window.removeEventListener("languagechange", update);
			} catch {
				/* no-op */
			}
		};
	}, []);
	return locale;
}
