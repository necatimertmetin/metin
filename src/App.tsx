import { useCallback, useEffect, useRef, useState } from 'react';
import { RuinsScene } from './scene/RuinsScene';
import { CONTACT, PROJECTS, SCENES, UI, initialLang, type Lang } from './content';
import { startAnalytics, track } from './analytics';
import { GitHubIcon, LinkedInIcon, SoundIcon } from './ui/icons';
import { sound } from './scene/sound';
import { Cursor } from './ui/Cursor';

/* the scene pebbles' outlines: a few uneven roundnesses, so no two neighbours are the same stone */
const PEBBLES = ['46% 54% 58% 42% / 55% 45% 55% 45%', '58% 42% 45% 55% / 48% 58% 42% 52%', '50% 50% 42% 58% / 60% 44% 56% 40%', '42% 58% 52% 48% / 46% 54% 46% 54%'];

export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ruins = useRef<RuinsScene | null>(null);
  const [lang, setLang] = useState<Lang>(initialLang);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(0);
  const [noGL, setNoGL] = useState(false);
  const [soundOn, setSoundOn] = useState(sound.enabled);
  const [volume, setVolume] = useState(sound.volume);
  /* nothing but the opening stone shows until the visitor strikes it */
  const [started, setStarted] = useState(false);
  /* the project whose constellation is open in the sky, -1 for none */
  const [project, setProject] = useState(-1);

  /* moving to another scene closes any open project */
  const go = useCallback((i: number) => { setProject(-1); setIndex(Math.min(SCENES.length - 1, Math.max(0, i))); }, []);
  const step = useCallback((dir: 1 | -1) => { setProject(-1); setIndex((i) => Math.min(SCENES.length - 1, Math.max(0, i + dir))); }, []);

  useEffect(() => { startAnalytics(); }, []);

  useEffect(() => {
    if (!canvas.current) return;
    try {
      ruins.current = new RuinsScene(canvas.current, SCENES[0].shapes, {
        onStep: step,
        onStart: () => { setStarted(true); track('start'); },
        projects: PROJECTS.map((p) => ({
          glyph: p.glyph, az: p.az, el: p.el, name: p.name.toUpperCase(), logo: p.logo && import.meta.env.BASE_URL + p.logo,
          color: p.color, face: p.face,
        })),
        onProject: setProject,
      });
    } catch {
      setNoGL(true);
      setStarted(true);
    }
    return () => { ruins.current?.dispose(); ruins.current = null; };
  }, [step]);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  /* the sky turns to the open project; Escape closes it */
  useEffect(() => {
    ruins.current?.setProject(project);
    if (project < 0) return;
    track(`project/${PROJECTS[project].id}`);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setProject(-1); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project]);

  /* the open project's tablet, cut in its wall, says what the panel says, in the language chosen */
  useEffect(() => {
    const p = project >= 0 ? PROJECTS[project] : null;
    ruins.current?.setCard(p ? { kicker: UI.projects[lang], title: p.name, role: p.role[lang], body: p.body[lang], close: UI.close[lang], link: p.link } : null);
  }, [project, lang]);

  /* the stones move right away; the caption fades out and back in with the new text */
  useEffect(() => {
    if (index !== shown) ruins.current?.show(SCENES[index].shapes, SCENES[index].lookUp);
    const t = window.setTimeout(() => setShown(index), 260);
    return () => clearTimeout(t);
  }, [index, shown]);

  const scene = SCENES[shown];
  const open = project >= 0 ? PROJECTS[project] : null;
  return (
    <>
      <canvas ref={canvas} className="stage" aria-hidden="true" />
      <Cursor />
      {noGL && <div className="fallback" aria-hidden="true">{scene.shapes.flatMap((s) => ('text' in s ? [s.text] : [])).pop() ?? scene.title[lang]}</div>}

      <main className="sr-only">
        <h1>Mert Metin, {UI.role[lang]}</h1>
        <p>{UI.about[lang]}</p>
        {SCENES.map((s, i) => (
          <section key={i}>
            <h2>{s.title[lang]}</h2>
            <p>{s.body[lang]}</p>
          </section>
        ))}
        <section>
          <h2>{UI.projects[lang]}</h2>
          {PROJECTS.map((p) => (
            <article key={p.id}>
              <h3>{p.name}</h3>
              <p>{p.role[lang]} {p.body[lang]}</p>
              {p.link && <a href={p.link.href}>{p.link.label}</a>}
            </article>
          ))}
        </section>
      </main>

      {!noGL && (
        <>
          <button type="button" className={`gate${started ? ' gone' : ''}`} aria-label={`${UI.begin[lang]}: ${UI.beginNote[lang]}`}
            tabIndex={started ? -1 : 0} onClick={() => ruins.current?.start()} />
          <div className={`gate-hint${started ? ' gone' : ''}`} aria-hidden="true">
            <b>{UI.begin[lang]}</b>
            <span>{UI.beginNote[lang]}</span>
          </div>
        </>
      )}

      <div className={`shell${started ? ' on' : ''}${open ? ' panel-open' : ''}`}>
      {open && (
        /* the words are cut into a stone tablet in the project's wall; this panel stays for screen readers and the keyboard */
        <aside className="ui panel in-stone" role="dialog" aria-label={open.name} key={open.id}>
          <button type="button" className="panel-close" aria-label={UI.close[lang]} onClick={() => setProject(-1)}>×</button>
          <div className="mono panel-kicker">{UI.projects[lang]}</div>
          <h2>{open.name}</h2>
          {open.role[lang] && <div className="mono panel-role">{open.role[lang]}</div>}
          {open.body[lang] && <p>{open.body[lang]}</p>}
          {open.link && <a className="panel-link mono" href={open.link.href} target="_blank" rel="noopener">{open.link.label} ↗</a>}
        </aside>
      )}
      <header className="ui tl">
        {/* the name cut in stone; under the pointer it shows itself in Old Turkic letters for a moment */}
        <div className="mark">
          <span className="mark-latin">Mert Metin</span>
          <span className="mark-rune" aria-hidden="true">{'\u{10C22}\u{10C3C}\u{10C45} \u{10C22}\u{10C45}\u{10C03}\u{10C24}'}</span>
          <small>{UI.role[lang]}</small>
        </div>
      </header>
      <div className="ui tr">
        {/* the speaker mutes; hovering it (or tabbing to it) opens a volume slider beside it */}
        <div className="sound-wrap">
          <input type="range" className="vol" min={0} max={1} step={0.01} value={soundOn ? volume : 0} aria-label={UI.volume[lang]}
            onChange={(e) => {
              const v = Number(e.target.value);
              sound.setVolume(v);
              setVolume(v);
              if ((v > 0) !== soundOn) { sound.setEnabled(v > 0); setSoundOn(v > 0); }
            }} />
          <button type="button" className="sound stone-btn" aria-pressed={soundOn} aria-label={UI.sound[lang]} title={UI.sound[lang]}
            onClick={() => {
              const on = !soundOn;
              if (on && volume === 0) { sound.setVolume(0.6); setVolume(0.6); }
              sound.setEnabled(on);
              setSoundOn(on);
            }}>
            <SoundIcon on={soundOn && volume > 0} />
          </button>
        </div>
        <span className="langs" role="group" aria-label={UI.language[lang]}>
          {(['tr', 'en'] as const).map((l) => (
            <button key={l} type="button" className="stone-btn stone-txt" aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
          ))}
        </span>
      </div>
      <nav className="ui cr" aria-label={UI.scenes[lang]}>
        {SCENES.map((s, i) => (
          /* a pebble for each scene, each its own shape; the current one carries a lit rune; its name shows beside it on hover */
          <button key={i} type="button" aria-label={`${UI.scene[lang]} ${i + 1}: ${s.title[lang]}`} aria-current={i === index} onClick={() => go(i)}
            data-name={s.title[lang]} data-rune={String.fromCodePoint(0x10c00 + ((i * 11 + 3) % 73))}
            style={{ borderRadius: PEBBLES[i % PEBBLES.length] }} />
        ))}
      </nav>
      <div className="ui bl">
        <div className={`cap slab ${index !== shown ? 'fade' : ''}`} aria-live="polite">
          <div className="idx">{String(shown + 1).padStart(2, '0')} / {String(SCENES.length).padStart(2, '0')}</div>
          <b>{scene.title[lang]}</b>
          <span>{scene.body[lang]}</span>
        </div>
      </div>
      <div className="ui bc">{UI.hint[lang]}</div>
      <footer className="ui br">
        <a className="mail" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
        <div className="soc">
          <a className="stone-btn" href={CONTACT.github} target="_blank" rel="noopener" aria-label="GitHub"><GitHubIcon /></a>
          <a className="stone-btn" href={CONTACT.linkedin} target="_blank" rel="noopener" aria-label="LinkedIn"><LinkedInIcon /></a>
        </div>
      </footer>
      </div>
    </>
  );
}
