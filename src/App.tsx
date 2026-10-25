import { useCallback, useEffect, useRef, useState } from 'react';
import { RuinsScene } from './scene/RuinsScene';
import { CONTACT, SCENES, UI, initialLang, type Lang } from './content';
import { GitHubIcon, LinkedInIcon } from './ui/icons';

export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const ruins = useRef<RuinsScene | null>(null);
  const [lang, setLang] = useState<Lang>(initialLang);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(0);
  const [noGL, setNoGL] = useState(false);

  const step = useCallback((dir: 1 | -1) => setIndex((i) => Math.min(SCENES.length - 1, Math.max(0, i + dir))), []);

  useEffect(() => {
    if (!canvas.current) return;
    try {
      ruins.current = new RuinsScene(canvas.current, SCENES[0].shapes, { onStep: step });
    } catch {
      setNoGL(true);
    }
    return () => { ruins.current?.dispose(); ruins.current = null; };
  }, [step]);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  /* the stones move right away; the caption fades out and back in with the new text */
  useEffect(() => {
    if (index !== shown) ruins.current?.show(SCENES[index].shapes);
    const t = window.setTimeout(() => setShown(index), 260);
    return () => clearTimeout(t);
  }, [index, shown]);

  const scene = SCENES[shown];
  return (
    <>
      <canvas ref={canvas} className="stage" aria-hidden="true" />
      {noGL && <div className="fallback" aria-hidden="true">{'text' in scene.shapes[0] ? scene.shapes[0].text : scene.title[lang]}</div>}

      <main className="sr-only">
        <h1>Mert Metin, {UI.role[lang]}</h1>
        <p>{UI.about[lang]}</p>
        {SCENES.map((s, i) => (
          <section key={i}>
            <h2>{s.title[lang]}</h2>
            <p>{s.body[lang]}</p>
          </section>
        ))}
      </main>

      <header className="ui tl">
        <div className="mark">Mert Metin<small className="mono">{UI.role[lang]}</small></div>
      </header>
      <div className="ui tr">
        <span className="langs mono" role="group" aria-label={UI.language[lang]}>
          {(['tr', 'en'] as const).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
          ))}
        </span>
      </div>
      <nav className="ui cr" aria-label={UI.scenes[lang]}>
        {SCENES.map((s, i) => (
          <button key={i} type="button" aria-label={`${UI.scene[lang]} ${i + 1}: ${s.title[lang]}`} aria-current={i === index} onClick={() => setIndex(i)} />
        ))}
      </nav>
      <div className="ui bl">
        <div className={`cap ${index !== shown ? 'fade' : ''}`} aria-live="polite">
          <div className="idx mono">{String(shown + 1).padStart(2, '0')} / {String(SCENES.length).padStart(2, '0')}</div>
          <b>{scene.title[lang]}</b>
          <span>{scene.body[lang]}</span>
        </div>
      </div>
      <div className="ui bc mono">{UI.hint[lang]}</div>
      <footer className="ui br">
        <a className="mail" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
        <div className="soc">
          <a href={CONTACT.github} target="_blank" rel="noopener" aria-label="GitHub"><GitHubIcon /></a>
          <a href={CONTACT.linkedin} target="_blank" rel="noopener" aria-label="LinkedIn"><LinkedInIcon /></a>
        </div>
      </footer>
    </>
  );
}
