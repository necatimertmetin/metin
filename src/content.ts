import { puzzlePiece, stoneText, type Shape } from "./scene/shapes";
import {
  cursorArrow,
  envelope,
  gitBranch,
  mountains,
  reactAtom,
  stele,
  tsBadge,
} from "./scene/marks";
import { RUNE_FONT } from "./scene/textures";

export type Lang = "tr" | "en";
type Text = Record<Lang, string>;

export type Scene = {
  /** shapes the stones build, more than one take turns: `stoneText`, `stonePath`, `stoneDraw` or a ready one */
  shapes: Shape[];
  title: Text;
  body: Text;
};

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
  /* ---- trial scenes: try-outs of the stone shapes, to pick from ---- */
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
      tr: "Her proje bir dikilitaş. Yakında burada.",
      en: "Every project a stele. Coming here soon.",
    },
  },
  {
    shapes: [reactAtom, tsBadge],
    title: { tr: "Araçlar", en: "Tools" },
    body: {
      tr: "React ve TypeScript, her gün.",
      en: "React and TypeScript, every day.",
    },
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
    shapes: [
      stoneText(">_", {
        font: '"JetBrains Mono", monospace',
        weight: 500,
        outline: 0.05,
        rows: 13,
        runeColor: "#9dff7a",
      }),
    ],
    title: { tr: "Araç yapımı", en: "Tooling" },
    body: {
      tr: "Masaüstü araçları ve komut satırı.",
      en: "Desktop tools and the command line.",
    },
  },
  {
    shapes: [gitBranch],
    title: { tr: "Açık kaynak", en: "Open source" },
    body: {
      tr: "Kodun bir kısmı GitHub’da.",
      en: "Some of the code lives on GitHub.",
    },
  },
  {
    shapes: [mountains],
    title: { tr: "Ötüken", en: "Ötüken" },
    body: {
      tr: "Göktürklerin kutsal dağı. Taşlar oradan geliyor.",
      en: "The sacred mountain of the Göktürks. The stones come from there.",
    },
  },
  {
    shapes: [
      envelope,
      stoneText("MERHABA\nHELLO", { rows: 16, runeColor: "#ff6b5b" }),
    ],
    title: { tr: "Mektup", en: "Letter" },
    body: {
      tr: "İletişim için başka bir yol.",
      en: "Another way to say contact.",
    },
  },
  /* ---- end of trial scenes ---- */
  {
    shapes: [stoneText("</>")],
    title: { tr: "Arayüzler", en: "Interfaces" },
    body: {
      tr: "Hareket etmek için kurulmuş React ve TypeScript.",
      en: "React and TypeScript, built to move.",
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
    shapes: [stoneText("MERHABA"), stoneText("HELLO")],
    title: { tr: "İki dil", en: "Two languages" },
    body: {
      tr: "Türkçe ve İngilizce, tek ses.",
      en: "Turkish and English, one voice.",
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
    tr: "Frontend ve tarayıcı eklentisi geliştiricisi. React, TypeScript, Chrome Manifest V3, Electron ve WebGL ile, Türkçe ve İngilizce arayüzler, tarayıcı eklentileri ve masaüstü araçları yaparım.",
    en: "Frontend and browser-extension developer. I build interfaces, browser extensions and desktop tools in React, TypeScript, Chrome Manifest V3, Electron and WebGL, in Turkish and English.",
  },
  scenes: { tr: "Sahneler", en: "Scenes" },
  scene: { tr: "Sahne", en: "Scene" },
  language: { tr: "Dil", en: "Language" },
  sound: { tr: "Ses", en: "Sound" },
};

export const CONTACT = {
  email: "necatimertmetin@gmail.com",
  github: "https://github.com/necatimertmetin",
  linkedin: "https://www.linkedin.com/in/mrmetin",
};

export const initialLang = (): Lang =>
  /^tr/i.test(navigator.language || "") ? "tr" : "en";
