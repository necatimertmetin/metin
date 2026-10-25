import { puzzlePiece, stoneDraw, stoneText, type Shape } from "./scene/shapes";
import { cursorArrow, stele, university } from "./scene/marks";
import { RUNE_FONT } from "./scene/textures";

export type Lang = "tr" | "en";
type Text = Record<Lang, string>;

export type Scene = {
  /** shapes the stones build, more than one take turns: `stoneText`, `stonePath`, `stoneDraw` or a ready one */
  shapes: Shape[];
  title: Text;
  body: Text;
  /** the camera leans up towards the sky in this scene (where the project constellations are) */
  lookUp?: boolean;
  /** monuments that rise out of the ground in this scene: Göbeklitepe's pillars or the Orkhon steles */
  monuments?: "gobekli" | "orkhon" | "derinkuyu";
};

/** A project, as a constellation in the upper sky: its initial in Old Turkic letters, and the panel it opens. */
export type Project = {
  id: string;
  name: string;
  /** index into the Old Turkic letters (U+10C00 + glyph) for the constellation */
  glyph: number;
  /** where it hangs: azimuth (0 = ahead, + right) and elevation, in degrees */
  az: number;
  el: number;
  role: Text;
  body: Text;
  link?: { href: string; label: string };
  /** a logo with a transparent background, in public/; when opened, the stars draw its outline instead of the name */
  logo?: string;
  /** the project's own colour: a nebula behind its constellation (it opens under the pointer), and its wall's colour when opened */
  color?: string;
  /** a face that comes alive in its nebula when opened, instead of the logo written in letters */
  face?: "lito";
};

/** The work, written in the sky. */
export const PROJECTS: Project[] = [
  {
    id: "syncrosale",
    name: "SyncroSale",
    glyph: 0x3d,
    az: -27,
    el: 12.5,
    role: { tr: "Tek mühendis · 2025 –", en: "Sole engineer · 2025 –" },
    body: {
      tr: "Amazon'da satış yapanlar için çok kiracılı bir platform: pazar yerleri arasında geçilen yönetim panoları, envanter ve fiyat takibi, depo ve kargo süreçleri, ürünleri Amazon sayfasının içinde inceleyen bir tarayıcı eklentisi ve hepsini besleyen olay tabanlı bir senkronizasyon hattı. Arayüzünden altyapısına kadar tek başıma kuruyorum.",
      en: "A multi-tenant platform for Amazon sellers: admin dashboards that switch between marketplaces, inventory and pricing, warehouse and shipping workflows, a browser extension that analyses products right on Amazon's pages, and an event-driven sync pipeline feeding it all. I build it on my own, from the interface down to the infrastructure.",
    },
    link: { href: "https://syncrosale.com", label: "syncrosale.com" },
    logo: "logos/syncrosale.png",
    color: "#fb923c",
  },
  {
    id: "lithium",
    name: "Lithium",
    glyph: 0x1e,
    az: -22,
    el: 16.8,
    role: {
      tr: "SyncroSale içinde · komuta merkezi",
      en: "Inside SyncroSale · command center",
    },
    body: {
      tr: 'SyncroSale eklentisinin komuta merkezi. Ürün bulucuyu, ürün zekâsını, rakip radarını, satış raporlarını, katalog temizliğini ve akıllı envanteri tek bir yerde toplar; her ilanı bilinen her şeyle tartıp "Bugün neye bakmalıyım?" sorusunu cevaplar. Verisini eklentinin dışında bir klasöre yedekler, eklenti kaldırılsa bile hiçbir şey kaybolmaz.',
      en: 'The command center of the SyncroSale extension. It gathers the product finder, product intelligence, competitor radar, sales reports, catalog cleanup and a smart inventory in one place, weighs every listing against everything known about it, and answers "What should I look at today?". It backs its data up to a folder outside the extension, so nothing is lost even if the extension is removed.',
    },
    logo: "logos/lithium.png",
    color: "#c084fc",
  },
  {
    id: "lito",
    name: "Lito",
    glyph: 0x20,
    az: -16.5,
    el: 12.3,
    role: { tr: "Lithium'un asistanı", en: "Lithium's assistant" },
    body: {
      tr: "Lithium'un içinde yaşayan küçük robot. Tarama kuyruğunu yürütür, büyük bir işe girişmeden önce sorar, iş bitince dans eder. Geceleri uykusu gelir, müzik çalınca kulaklık takar, her gün ne okuduğunu anlatır. Sayılarla değil, bir yüzle konuşan bir yardımcı.",
      en: "The little robot that lives inside Lithium. It runs the scan queue, asks before taking on a big job, and dances when one is done. It gets sleepy at night, puts on headphones when music plays, and tells you each day what it has read. A helper that talks with a face, not just numbers.",
    },
    logo: "logos/lito.png",
    color: "#5eead4",
    face: "lito",
  },
  {
    id: "traceco2",
    name: "TraceCO2",
    glyph: 0x43,
    az: 4,
    el: 12.5,
    role: { tr: "Platform", en: "Platform" },
    body: {
      tr: "Avrupa'daki tüketicilerin ve markaların bir ürünün karbon ayak izini ham maddeden mağaza rafına kadar, tedarik zincirinin her adımında şeffafça izleyebildiği bir platform.",
      en: "A platform that lets consumers and brands in Europe follow a product's carbon footprint openly, at every step of the supply chain from raw material to the shop shelf.",
    },
    link: {
      href: "https://github.com/necatimertmetin/traceco2",
      label: "GitHub",
    },
    color: "#4ade80",
  },
  {
    id: "afterlive",
    name: "Afterlive",
    glyph: 0x00,
    az: 9.5,
    el: 16.8,
    role: { tr: "Canlı yayın platformu", en: "Live streaming platform" },
    body: {
      tr: "Gece hayatını ekrana taşıyan bir platform: şehrin mekânlarından gerçek zamanlı canlı yayınlar, her hafta yenilenen etkinlik takvimi ve gecenin hikâyeleri. Evde olabilirsin, ama gece hep seninle.",
      en: "A platform that brings nightlife to the screen: real-time live streams from the city's venues, a weekly events calendar and stories from the night. You might be at home, but the night is always with you.",
    },
    link: {
      href: "https://necatimertmetin.github.io/afterlive/",
      label: "afterlive",
    },
    logo: "logos/afterlive.png",
    color: "#ef4444",
  },
  {
    id: "padoboard",
    name: "Padoboard",
    glyph: 0x2f,
    az: 14.5,
    el: 12.3,
    role: { tr: "Masaüstü uygulaması · açık kaynak", en: "Desktop app · open source" },
    body: {
      tr: "Windows ve Linux için ücretsiz, açık kaynaklı bir soundboard. Sesleri butonlara dizip oyunda ve sesli sohbette arkadaşlarına çalabilir, mikrofonunla kendi sesini değiştirebilir, çok kanallı stüdyosunda kayıt alıp düzenleyebilirsin. Arkadaşların aynı ağdan, tarayıcıdan sana ses çaldırabilir. Sesler ve kayıtlar bilgisayarında kalır, takip yok. Maskotu Pado.",
      en: "A free, open-source soundboard for Windows and Linux. Put sounds on buttons and play them to your friends in games and voice chat, change your own voice through the microphone, record and edit in its multitrack studio. Friends on the same network can play sounds to you from a browser. Sounds and recordings stay on your computer, nothing is tracked. Its mascot is Pado.",
    },
    link: { href: "https://github.com/elifnurdemir/soundboard", label: "GitHub" },
    logo: "logos/padoboard.png",
    color: "#c6ff00",
  },
];

/** GoatCounter site code (the part before .goatcounter.com); empty sends nothing */
export const GOATCOUNTER = "";

/** The story, one scene per scroll step, in the order of history: the first temple, the first Turkic writing, then mine. */
export const SCENES: Scene[] = [
  {
    /* the stones step aside: the pillars of the first temple come up out of the ground in their place */
    shapes: [stoneDraw(() => {}, { runeColor: "#ff9d5c" })],
    title: { tr: "Göbeklitepe", en: "Göbeklitepe" },
    body: {
      tr: "On iki bin yıl önce, yazıdan da tekerlekten de önce, insanlar dev T taşları dikip üstlerine tilki, yaban domuzu ve akbaba kazıdı. Taşa anlam vermenin bilinen en eski hali.",
      en: "Twelve thousand years ago, before writing and before the wheel, people raised great T-shaped pillars and carved foxes, boars and vultures into them. The oldest known meaning cut in stone.",
    },
    monuments: "gobekli",
  },
  /*
   * Derinkuyu, set aside for now (the scene works, see scene/derinkuyu.ts, but is not right yet):
   *   {
   *     the cover slides off an air shaft and the view looks down into the underground city
   *     shapes: [stoneDraw(() => {}, { runeColor: "#ffb070" })],
   *     title: { tr: "Derinkuyu", en: "Derinkuyu" },
   *     body: {
   *       tr: "Kapadokya'nın yumuşak tüf kayasına kat kat oyulmuş bir yeraltı şehri: ahırlar, mutfaklar, şaraphaneler, bir kilise ve hepsini kesen bir hava bacası. Kapıları yuvarlak taşlarla kapanır. Kazılmaya Friglerin zamanında, MÖ 8. ya da 7. yüzyılda başlandığı düşünülür.",
   *       en: "An underground city carved level under level into Cappadocia's soft tuff: stables, kitchens, wineries, a church, and an air shaft through them all. Round stones roll across its doors. It is thought to have been begun by the Phrygians, in the 8th or 7th century BC.",
   *     },
   *     monuments: "derinkuyu",
   *   },
   */
  {
    /* the stones step aside for the three Orkhon steles */
    shapes: [stoneDraw(() => {}, { runeColor: "#ffb347" })],
    title: { tr: "Orhun Yazıtları", en: "Orkhon Inscriptions" },
    body: {
      tr: "Tonyukuk, Bilge Kağan ve Kül Tigin anıtları. 8. yüzyılda Göktürk harfleriyle taşa kazınan, bilinen en eski Türkçe metinler.",
      en: "The monuments of Tonyukuk, Bilge Kağan and Kül Tigin: the oldest known Turkic texts, cut in stone in Old Turkic letters in the 8th century.",
    },
    monuments: "orkhon",
  },
  {
    shapes: [stoneText("METİN", { rows: 14, maxW: 0.8, maxH: 0.46 })],
    title: { tr: "Metin", en: "Metin" },
    body: {
      tr: "Hem yazı, hem taş. Bilinen ilk Türkçe metinlerden bazıları taşa kazındı. Mert Metin, frontend geliştirici.",
      en: "Text, and stone. Some of the earliest known Turkic texts were carved in stone. Mert Metin, frontend developer.",
    },
  },
  {
    shapes: [university],
    title: { tr: "Üniversite", en: "University" },
    body: {
      tr: "Trakya Üniversitesi'nde bilgisayar mühendisliği okudum. Taşlar okulun Edirne'deki rektörlük binasını, eski Karaağaç Garı'nı kuruyor.",
      en: "I studied computer engineering at Trakya University. The stones build its rectorate in Edirne, the old Karaağaç railway station.",
    },
  },
  {
    /* "Mert Metin" in Orkhon letters, right to left, the e unwritten as in the inscriptions */
    shapes: [
      stoneText(
        "\u{10C22}\u{10C3C}\u{10C45} \u{10C22}\u{10C45}\u{10C03}\u{10C24}",
        {
          font: RUNE_FONT,
          weight: 400,
          outline: 0.06,
          rows: 16,
          maxW: 0.74,
        },
      ),
    ],
    title: { tr: "Hakkımda", en: "About" },
    body: {
      tr: "Bugün ABD'deki bir ekip için Amazon satıcılarına yönelik bir platformu uçtan uca tek başıma kuruyorum. Taşlar adımı Göktürk harfleriyle yazıyor.",
      en: "Today I build a platform for Amazon sellers end to end, on my own, for a team in the US. The stones write my name in Old Turkic letters.",
    },
  },
  {
    shapes: [stele],
    title: { tr: "Projeler", en: "Projects" },
    body: {
      tr: "Göğe bak: her takımyıldız bir iş. Birine dokun.",
      en: "Look up: every constellation is a piece of work. Touch one.",
    },
    lookUp: true,
  },
  {
    shapes: [cursorArrow],
    title: { tr: "Etkileşim", en: "Interaction" },
    body: {
      tr: "İmlecin dokunduğu her şey tepki versin.",
      en: "Everything the pointer touches should answer.",
    },
  },
  {
    shapes: [stoneText("</>")],
    title: { tr: "Arayüzler", en: "Interfaces" },
    body: {
      tr: "Nefes alan, akıp giden arayüzler.",
      en: "Interfaces that move and breathe.",
    },
  },
  {
    shapes: [puzzlePiece],
    title: { tr: "Tarayıcı eklentileri", en: "Browser extensions" },
    body: {
      tr: "Başka sayfaların içinde yaşayan yazılım.",
      en: "Software that lives inside other pages.",
    },
  },
  {
    shapes: [stoneText("@", { rows: 15, maxH: 0.66 })],
    title: { tr: "İletişim", en: "Contact" },
    body: { tr: "necatimertmetin@gmail.com", en: "necatimertmetin@gmail.com" },
  },
];

export const UI: Record<string, Text> = {
  role: { tr: "Frontend geliştirici", en: "Frontend developer" },
  hint: {
    tr: "Gezdir: rünleri yak · Basılı tut: kır · Kaydır: yeniden yont",
    en: "Move to light the runes · hold to break · scroll to recarve",
  },
  about: {
    tr: "Frontend ve tarayıcı eklentisi geliştiricisi. Türkçe ve İngilizce arayüzler, tarayıcı eklentileri ve masaüstü araçları yaparım.",
    en: "Frontend and browser-extension developer. I build interfaces, browser extensions and desktop tools, in Turkish and English.",
  },
  scenes: { tr: "Sahneler", en: "Scenes" },
  scene: { tr: "Sahne", en: "Scene" },
  language: { tr: "Dil", en: "Language" },
  sound: { tr: "Ses", en: "Sound" },
  volume: { tr: "Ses seviyesi", en: "Volume" },
  projects: { tr: "Projeler", en: "Projects" },
  close: { tr: "Kapat", en: "Close" },
  begin: { tr: "BAŞLA", en: "BEGIN" },
  beginNote: {
    tr: "Sesli bir deneyim · taşa dokun",
    en: "An experience with sound · touch the stone",
  },
};

export const CONTACT = {
  email: "necatimertmetin@gmail.com",
  github: "https://github.com/necatimertmetin",
  linkedin: "https://www.linkedin.com/in/mrmetin",
};

export const initialLang = (): Lang =>
  /^tr/i.test(navigator.language || "") ? "tr" : "en";
