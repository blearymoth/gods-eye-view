import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installCityTourPresenter, CITY_TOUR_CAPTION_ID } from './cityTourPresenter.js';
import { CITY_TOURS } from './cityTours.js';

function fakeElement() {
  const el = {
    hidden: false,
    textContent: '',
    innerHTML: '',
    attributes: {},
    children: [],
    classes: new Set(),
    classList: {
      add: (name) => el.classes.add(name),
      remove: (name) => el.classes.delete(name),
    },
    setAttribute: (name, value) => {
      el.attributes[name] = value;
    },
    querySelector: (selector) => el.parts[selector.slice(1)],
    remove: () => {
      el.removed = true;
    },
    parts: {
      'city-tour-caption-city': { textContent: '' },
      'city-tour-caption-title': { textContent: '' },
      'city-tour-caption-story': { textContent: '' },
    },
  };
  return el;
}

function harness() {
  const listeners = new Set();
  const caption = fakeElement();
  const documentRef = {
    createElement: () => caption,
    body: { appendChild: () => {} },
  };
  const sent = [];
  const responses = [];
  let voiceActive = true;
  const voice = {
    session: {
      isActive: () => voiceActive,
      sendMapEvent: (event) => sent.push(event),
    },
    queueResponseCreate: (text) => responses.push(text),
  };
  const director = {
    subscribe(listener) {
      listener({ state: {}, change: null, revision: 0, initial: true });
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const dispose = installCityTourPresenter({ director, documentRef, getVoice: () => voice });
  const emit = (event, detail) => {
    for (const listener of listeners)
      listener({ state: {}, change: { type: 'run-event', event, detail }, revision: 1 });
  };
  return { caption, sent, responses, emit, dispose, setVoice: (v) => (voiceActive = v), listeners };
}

const rome = CITY_TOURS[0];

test('a tour shot shows its story once per stop and hands the beat to voice', () => {
  const h = harness();
  assert.equal(h.caption.id, CITY_TOUR_CAPTION_ID);
  assert.equal(h.caption.hidden, true);
  h.emit('shot_start', { sceneId: rome.id, title: rome.stops[0].title, index: 1 });
  assert.equal(h.caption.hidden, false);
  assert.equal(h.caption.parts['city-tour-caption-title'].textContent, rome.stops[0].title);
  assert.equal(h.caption.parts['city-tour-caption-story'].textContent, rome.stops[0].story);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].type, 'tour_beat');
  assert.equal(h.responses.length, 1);
  // The orbit shot shares the title: caption stays, voice is not re-triggered.
  h.emit('shot_start', { sceneId: rome.id, title: rome.stops[0].title, index: 2 });
  assert.equal(h.sent.length, 1);
  h.emit('shot_start', { sceneId: rome.id, title: rome.stops[1].title, index: 3 });
  assert.equal(h.sent.length, 2);
  assert.equal(h.caption.parts['city-tour-caption-title'].textContent, rome.stops[1].title);
});

test('non-tour scenes, stops and errors hide the caption; voice off sends nothing', () => {
  const h = harness();
  h.setVoice(false);
  h.emit('shot_start', { sceneId: rome.id, title: 'Approaching Rome', index: 0 });
  assert.equal(h.caption.hidden, false);
  assert.equal(h.sent.length, 0);
  h.emit('scene_stopped', { reason: 'user' });
  assert.equal(h.caption.hidden, true);
  h.emit('shot_start', { sceneId: rome.id, title: 'Approaching Rome', index: 0 });
  h.emit('shot_start', { sceneId: 'flights-radar', title: 'Shot 1', index: 0 });
  assert.equal(h.caption.hidden, true);
  h.emit('shot_start', { sceneId: rome.id, title: 'Approaching Rome', index: 0 });
  h.emit('scene_run_complete', {});
  assert.equal(h.caption.hidden, true);
  h.dispose();
  assert.equal(h.caption.removed, true);
  assert.equal(h.listeners.size, 0);
});
