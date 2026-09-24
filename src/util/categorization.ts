import { IEvent } from '~/util/interfaces';
import _ from 'lodash';

// Regex used to split event titles into words
const SPLIT_REGEX = /[\s\-,:()[\]/]/;

function eventText(event: IEvent): string {
  return (
    (typeof event.data.title === 'string' && event.data.title) ||
    (typeof event.data.app === 'string' && event.data.app) ||
    ''
  );
}

export interface WordEntry {
  word: string;
  duration: number;
  events: IEvent[];
}

export function sortWordEntries(entries: WordEntry[]): WordEntry[] {
  return [...entries].sort(
    (a, b) => b.duration - a.duration || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0)
  );
}

export function summarizeSuggestionEvents(events: IEvent[]): { events: number; duration: number } {
  const unique = [...new Set(events)];
  return {
    events: unique.length,
    duration: unique.reduce((total, event) => total + event.duration, 0),
  };
}

export function buildExactRulePattern(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return `^${_.escapeRegExp(value)}$`;
}

/**
 * Finds common words and bigrams in captured titles, falling back to
 * application names when title capture is disabled, weighted by duration.
 *
 * For each bigram that accounts for >50% of the total duration of both
 * constituent words, the bigram is promoted and the constituent words'
 * durations are reduced accordingly. This means "Mozilla Firefox" appears
 * instead of separate "Mozilla" and "Firefox" entries when they almost
 * always co-occur.
 *
 * Words with length <= 2 or in `ignored_words` are skipped.
 */
export function findCommonPhrases(
  events: IEvent[],
  ignored_words: string[]
): Map<string, WordEntry> {
  const words = new Map<string, WordEntry>();
  const bigrams = new Map<string, { bigram: string; duration: number; events: IEvent[] }>();

  // Step 1: Build word duration dictionary
  for (const event of events) {
    const text = eventText(event);
    if (!text) continue;
    for (const word of text.split(SPLIT_REGEX)) {
      if (word.length <= 2 || ignored_words.includes(word)) {
        continue;
      }
      const entry = words.get(word);
      if (entry) {
        entry.duration += event.duration;
        entry.events.push(event);
      } else {
        words.set(word, { word, duration: event.duration, events: [event] });
      }
    }
  }

  // Step 2: Build bigram duration dictionary (skip bigrams with filtered words)
  for (const event of events) {
    const text = eventText(event);
    if (!text) continue;
    const parts = text.split(SPLIT_REGEX);
    for (let i = 0; i < parts.length - 1; i++) {
      const w1 = parts[i];
      const w2 = parts[i + 1];
      if (w1.length <= 2 || ignored_words.includes(w1)) continue;
      if (w2.length <= 2 || ignored_words.includes(w2)) continue;
      const bigram = `${w1} ${w2}`;
      const entry = bigrams.get(bigram);
      if (entry) {
        entry.duration += event.duration;
        entry.events.push(event);
      } else {
        bigrams.set(bigram, { bigram, duration: event.duration, events: [event] });
      }
    }
  }

  // Step 3: Promote bigrams that dominate both constituent words (>50% threshold)
  // Snapshot original durations before the loop so that promoting one bigram
  // (which reduces its constituent words' durations) does not corrupt the
  // threshold check for a later bigram that shares a common word.  Without this,
  // a trigram such as "Alpha Beta Gamma" causes Beta.duration to reach 0 after
  // "Alpha Beta" is promoted, making 10/0 = Infinity pass the check for "Beta Gamma"
  // even though only 10/110 ≈ 9% of Beta's original time was spent in that bigram.
  const originalDurations = new Map<string, number>(
    Array.from(words.entries(), ([w, e]) => [w, e.duration])
  );
  for (const [bigram, bigramEntry] of bigrams) {
    const spaceIdx = bigram.indexOf(' ');
    const word1 = bigram.slice(0, spaceIdx);
    const word2 = bigram.slice(spaceIdx + 1);
    const w1Entry = words.get(word1);
    const w2Entry = words.get(word2);
    const w1OrigDuration = originalDurations.get(word1);
    const w2OrigDuration = originalDurations.get(word2);
    if (!w1Entry || !w2Entry || w1OrigDuration === undefined || w2OrigDuration === undefined)
      continue;

    const bigram_duration = bigramEntry.duration;
    if (bigram_duration / w1OrigDuration > 0.5 && bigram_duration / w2OrigDuration > 0.5) {
      // Promote bigram, reduce constituent word durations
      words.set(bigram, { word: bigram, duration: bigram_duration, events: bigramEntry.events });
      w1Entry.duration -= bigram_duration;
      w2Entry.duration -= bigram_duration;
    }
  }

  return words;
}
