import { GOATCOUNTER } from './content';

/*
 * A visitor count with GoatCounter: no cookies, nothing personal kept. It counts page views, and a few moments of
 * the visit as events (the opening stone struck, a project opened). With no site code set, nothing is loaded or sent.
 */

type GoatCounter = { count: (v: { path: string; title?: string; event?: boolean }) => void };
declare global { interface Window { goatcounter?: GoatCounter & { no_onload?: boolean } } }

const pending: string[] = [];

/** Load the counter once, if a site code is set; it counts the page view itself. */
export function startAnalytics() {
  if (!GOATCOUNTER || document.querySelector('script[data-goatcounter]')) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${GOATCOUNTER}.goatcounter.com/count`;
  s.onload = () => { for (const e of pending.splice(0)) track(e); };
  document.head.appendChild(s);
}

/** Count a moment of the visit, e.g. `start` or `project/syncrosale`. */
export function track(event: string) {
  if (!GOATCOUNTER) return;
  if (!window.goatcounter?.count) { pending.push(event); return; }
  window.goatcounter.count({ path: event, title: event, event: true });
}
