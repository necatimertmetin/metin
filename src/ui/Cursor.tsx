import { useEffect, useRef, useState } from 'react';
import { GLYPHS } from '../scene/textures';

/* the pointer's rune: ORKHON I, the Old Turkic letter for ı and i */
const GLYPH = GLYPHS[0x03];

/**
 * The pointer over the scene: a glowing rune in place of the crosshair, leaning a little to the left. It trails the
 * pointer a touch, shrinks and brightens on a press, and turns slowly while held. Over the interface the
 * normal cursor comes back; on touch screens there is none.
 */
export function Cursor() {
  const el = useRef<HTMLDivElement>(null);
  const [pressed, setPressed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const at = { x: -100, y: -100 }, to = { x: -100, y: -100 };
    let raf = 0;
    const tick = () => {
      at.x += (to.x - at.x) * 0.35;
      at.y += (to.y - at.y) * 0.35;
      if (el.current) el.current.style.transform = `translate(${at.x}px, ${at.y}px)`;
      raf = requestAnimationFrame(tick);
    };
    const move = (e: PointerEvent) => {
      to.x = e.clientX; to.y = e.clientY;
      setShown((e.target as Element | null)?.classList?.contains('stage') ?? false);
    };
    const down = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.classList?.contains('stage')) return;
      setPressed(true);
    };
    const up = () => setPressed(false);
    const leave = () => setShown(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    document.documentElement.addEventListener('pointerleave', leave);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      document.documentElement.removeEventListener('pointerleave', leave);
    };
  }, []);

  return (
    <div ref={el} className={`cursor${shown ? ' on' : ''}${pressed ? ' down' : ''}`} aria-hidden="true">
      <span>{GLYPH}</span>
    </div>
  );
}
