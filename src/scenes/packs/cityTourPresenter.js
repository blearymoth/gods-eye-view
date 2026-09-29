/**
 * Captions and voice narration for bundled city tours.
 *
 * Listens to Director run events; when a city-tour shot starts it shows the
 * stop's story in a caption and, if a voice session is open, hands the same
 * text to the realtime agent as a `tour_beat` item to speak. Nothing here is
 * stored in the scene document, so tours stay ordinary Director scenes.
 */

import { cityTourStory, isCityTourScene } from './cityTours.js';

export const CITY_TOUR_CAPTION_ID = 'city-tour-caption';

const NARRATION_INSTRUCTION =
  'A tour_beat system item was just added. Narrate that stop using its story field as your spoken guide, staying close to those words in one or two sentences. Do not mention tools, JSON, or that you are reading a script.';

function createCaption(documentRef) {
  const el = documentRef.createElement('div');
  el.id = CITY_TOUR_CAPTION_ID;
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML =
    '<span class="city-tour-caption-city"></span>' +
    '<span class="city-tour-caption-title"></span>' +
    '<p class="city-tour-caption-story"></p>';
  documentRef.body.appendChild(el);
  return el;
}

/**
 * @param {object} input
 * @param {{ subscribe: (listener: (notification: { change: object | null }) => void) => () => void }} input.director
 * @param {() => object | null | undefined} [input.getVoice] Returns the voice
 *   controls (window.__gevVoiceCommands) or nothing when voice is off.
 * @param {Document} [input.documentRef]
 * @returns {() => void} dispose
 */
export function installCityTourPresenter({
  director,
  getVoice = () => globalThis.window?.__gevVoiceCommands,
  documentRef = globalThis.document,
}) {
  const caption = createCaption(documentRef);
  const city = caption.querySelector('.city-tour-caption-city');
  const title = caption.querySelector('.city-tour-caption-title');
  const story = caption.querySelector('.city-tour-caption-story');
  let shown = null;

  const hide = () => {
    shown = null;
    caption.hidden = true;
    caption.classList.remove('visible');
  };

  const narrate = (beat) => {
    const voice = getVoice();
    if (!voice?.session?.isActive?.()) return;
    voice.session.sendMapEvent?.({ type: 'tour_beat', ...beat });
    voice.queueResponseCreate?.(NARRATION_INSTRUCTION);
  };

  const show = (sceneId, shotTitle) => {
    const beat = cityTourStory(sceneId, shotTitle);
    if (!beat) return hide();
    const key = `${sceneId}\n${beat.title}`;
    // Arrival and orbit shots share a stop: keep the caption, speak once.
    if (shown === key) return;
    shown = key;
    city.textContent = beat.city;
    title.textContent = beat.title;
    story.textContent = beat.story;
    caption.hidden = false;
    caption.classList.add('visible');
    narrate(beat);
  };

  // The Director's state channel delivers `{ state, change, revision }`.
  const unsubscribe = director.subscribe((notification) => {
    const change = notification?.change;
    if (change?.type !== 'run-event') return;
    const detail = change.detail || {};
    switch (change.event) {
      case 'shot_start':
        if (isCityTourScene(detail.sceneId)) show(detail.sceneId, detail.title);
        else hide();
        break;
      case 'scene_stopped':
      case 'scene_run_complete':
      case 'scene_run_error':
        hide();
        break;
      default:
        break;
    }
  });

  return () => {
    unsubscribe?.();
    caption.remove();
  };
}
