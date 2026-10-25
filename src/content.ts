import { puzzlePiece, stoneText, type Shape } from "./scene/shapes";
import { cursorArrow, stele } from "./scene/marks";
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
};

/** The work, written in the sky. */
export const PROJECTS: Project[] = [
  {
    id: "syncrosale",
    name: "SyncroSale",
    glyph: 0x3d,
    az: -24,
    el: 12,
    role: { tr: "Tek mühendis · 2025 –", en: "Sole engineer · 2025 –" },
    body: {
      tr: "Amazon'da satış yapanlar için çok kiracılı bir platform: pazar yerleri arasında geçilen yönetim panoları, envanter ve fiyat takibi, depo ve kargo süreçleri, ürünleri Amazon sayfasının içinde inceleyen bir tarayıcı eklentisi ve hepsini besleyen olay tabanlı bir senkronizasyon hattı. Arayüzünden altyapısına kadar tek başıma kuruyorum.",
      en: "A multi-tenant platform for Amazon sellers: admin dashboards that switch between marketplaces, inventory and pricing, warehouse and shipping workflows, a browser extension that analyses products right on Amazon's pages, and an event-driven sync pipeline feeding it all. I build it on my own, from the interface down to the infrastructure.",
    },
    link: { href: "https://syncrosale.com", label: "syncrosale.com" },
  },
  {
    id: "traceco2",
    name: "TraceCO2",
    glyph: 0x43,
    az: -6.5,
    el: 10.2,
    role: { tr: "Platform", en: "Platform" },
    body: {
      tr: "Avrupa'daki tüketicilerin ve markaların bir ürünün karbon ayak izini ham maddeden mağaza rafına kadar, tedarik zincirinin her adımında şeffafça izleyebildiği bir platform.",
      en: "A platform that lets consumers and brands in Europe follow a product's carbon footprint openly, at every step of the supply chain from raw material to the shop shelf.",
    },
    link: { href: "https://github.com/necatimertmetin/traceco2", label: "GitHub" },
  },
  {
    id: "afterlive",
    name: "Afterlive",
    glyph: 0x00,
    az: 1.5,
    el: 12.8,
    role: { tr: "Canlı yayın platformu", en: "Live streaming platform" },
    body: {
      tr: "Gece hayatını ekrana taşıyan bir platform: şehrin mekânlarından gerçek zamanlı canlı yayınlar, her hafta yenilenen etkinlik takvimi ve gecenin hikâyeleri. Evde olabilirsin, ama gece hep seninle.",
      en: "A platform that brings nightlife to the screen: real-time live streams from the city's venues, a weekly events calendar and stories from the night. You might be at home, but the night is always with you.",
    },
    link: { href: "https://necatimertmetin.github.io/afterlive/", label: "afterlive" },
    logo: "logos/afterlive.png",
  },
  {
    id: "padoboard",
    name: "Padoboard",
    glyph: 0x2f,
    az: 11,
    el: 11.5,
    /* TODO: Mert to write what Padoboard is; left empty rather than guessed */
    role: { tr: "", en: "" },
    body: { tr: "", en: "" },
  },
];

/** GoatCounter site code (the part before .goatcounter.com); empty sends nothing */
export const GOATCOUNTER = "";

/** The story, one scene per scroll step. */
export const SCENES: Scene[] = [
  {
    shapes: [stoneText("METİN", { rows: 14, maxW: 0.8, maxH: 0.46 })],
    title: { tr: "Metin", en: "Metin" },
    body: {
      tr: "Hem yazı, hem taş. Bilinen ilk Türkçe metinlerden bazıları taşa kazındı. Mert Metin, frontend geliştirici.",
      en: "Text, and stone. Some of the earliest known Turkic texts were carved in stone. Mert Metin, frontend developer.",
    },
  },
  {
    /* "Mert Metin" in Orkhon letters, right to left, the e unwritten as in the inscriptions */
    shapes: [
      stoneText("\u{10C22}\u{10C3C}\u{10C45} \u{10C22}\u{10C45}\u{10C03}\u{10C24}", {
        font: RUNE_FONT,
        weight: 400,
        outline: 0.06,
        rows: 16,
        maxW: 0.74,
      }),
    ],
    title: { tr: "Hakkımda", en: "About" },
    body: {
      tr: "Trakya Üniversitesi'nde bilgisayar mühendisliği okudum. Bugün ABD'deki bir ekip için Amazon satıcılarına yönelik bir platformu uçtan uca tek başıma kuruyorum. Taşlar adımı Göktürk harfleriyle yazıyor.",
      en: "I studied computer engineering at Trakya University. Today I build a platform for Amazon sellers end to end, on my own, for a team in the US. The stones write my name in Old Turkic letters.",
    },
  },
  {
    /* "Türk" in Orkhon letters, which run right to left */
    shapes: [
      stoneText("\u{10C45}\u{10C07}\u{10C3C}\u{10C1A}", {
        font: RUNE_FONT,
        weight: 400,
        outline: 0.06,
        rows: 16,
        maxW: 0.66,
        runeColor: "#ffb347",
      }),
    ],
    title: { tr: "Yazıt", en: "Inscription" },
    body: {
      tr: "Taşların dizdiği kelime Göktürk harfleriyle “Türk”. Orhun yazıtlarının alfabesi, 8. yüzyıl.",
      en: "The stones spell “Türk” in Old Turkic letters, the alphabet of the 8th-century Orkhon inscriptions.",
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
  beginNote: { tr: "Sesli bir deneyim · taşa dokun", en: "An experience with sound · touch the stone" },
};

export const CONTACT = {
  email: "necatimertmetin@gmail.com",
  github: "https://github.com/necatimertmetin",
  linkedin: "https://www.linkedin.com/in/mrmetin",
};

export const initialLang = (): Lang =>
  /^tr/i.test(navigator.language || "") ? "tr" : "en";
