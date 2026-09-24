import EventEditor from '~/components/EventEditor.vue';
import EventList from '~/visualizations/EventList.vue';

const event = (id, timestamp, duration, data = { app: 'Editor' }) => ({
  id,
  timestamp,
  duration,
  data,
});

describe('Timeline event transformations', () => {
  test('shows canonical correction source labels', () => {
    expect(EventEditor.methods.sourceLabel('local-ui-split')).toBe('Split event');
    expect(EventEditor.methods.sourceLabel('local-ui-merge')).toBe('Merge adjacent activities');
    expect(EventEditor.methods.sourceLabel('unknown-source')).toBe('Other');
  });

  test('only merges adjacent events with identical minimized data', () => {
    const current = event(2, '2026-09-22T10:00:10.000Z', 20);
    const previous = event(1, '2026-09-22T10:00:00.000Z', 10);
    const candidate = EventEditor.computed.mergeCandidate.call({
      editedEvent: current,
      bucket_id: 'aw-watcher-window_test',
      events: [previous, current],
    });
    expect(candidate.id).toBe(1);

    const differentData = event(3, '2026-09-22T10:00:30.000Z', 10, { app: 'Browser' });
    expect(EventEditor.computed.mergeCandidate.call({
      editedEvent: current,
      bucket_id: 'aw-watcher-window_test',
      events: [current, differentData],
    })).toBeNull();
  });

  test('splitting requires an interior time and sends a single native correction request', async () => {
    const original = event(8, '2026-09-22T10:00:00.000Z', 30);
    const splitAt = '2026-09-22T10:00:10.000Z';
    const parts = [{ ...original, id: 9, duration: 10 }, { ...original, id: 10, timestamp: splitAt, duration: 20 }];
    const post = jest.fn().mockResolvedValue({ data: parts });
    const emit = jest.fn();
    const close = jest.fn();
    window.confirm = jest.fn().mockReturnValue(true);
    const context = {
      event: original,
      editedEvent: original,
      bucket_id: 'aw-watcher-window_test',
      splitAt,
      busy: false,
      editError: '',
      $aw: { req: { post } },
      $emit: emit,
      close,
      canSplit: true,
    };
    await EventEditor.methods.split.call(context);
    expect(post).toHaveBeenCalledWith(
      '/0/buckets/aw-watcher-window_test/events/8/split',
      { split_at: splitAt }
    );
    expect(emit).toHaveBeenCalledWith('split', parts);
    expect(close).toHaveBeenCalled();
  });

  test('merge action sends only the selected adjacent event IDs', async () => {
    const current = event(12, '2026-09-22T10:00:10.000Z', 20);
    const previous = event(11, '2026-09-22T10:00:00.000Z', 10);
    const post = jest.fn().mockResolvedValue({ data: event(13, current.timestamp, 30) });
    const emit = jest.fn();
    const close = jest.fn();
    window.confirm = jest.fn().mockReturnValue(true);
    const context = {
      mergeCandidate: previous,
      busy: false,
      editedEvent: current,
      bucket_id: 'aw-watcher-window_test',
      $aw: { req: { post } },
      $emit: emit,
      close,
    };
    await EventEditor.methods.merge.call(context);
    expect(post).toHaveBeenCalledWith('/0/buckets/aw-watcher-window_test/events/12/merge/11');
    expect(emit).toHaveBeenCalledWith('merge', expect.objectContaining({ id: 13 }));
    expect(close).toHaveBeenCalled();
  });

  test('event-list deletion is relayed to its owner for a fresh read', () => {
    const emit = jest.fn();
    const removed = event(11, '2026-09-22T10:00:00.000Z', 5);
    EventList.methods.removeEvent.call({ $emit: emit }, removed);
    expect(emit).toHaveBeenCalledWith('delete', removed);
  });
});
