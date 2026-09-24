import experience from '~/generated/product-experience.json';
import { capability, isShipped, statusLabel } from '~/product/experience';

describe('product capability contract', () => {
  test('shows only implemented capabilities in navigation', () => {
    expect(capability('local-capture', experience)?.status).toBe('Available');
    expect(isShipped('local-capture', experience)).toBe(true);
    expect(isShipped('e2ee-sync', experience)).toBe(false);
    expect(isShipped('missing-capability', experience)).toBe(false);
  });

  test('exposes non-available status labels without promoting them', () => {
    expect(statusLabel('local-capture', experience)).toBe('');
    expect(statusLabel('e2ee-sync', experience)).toBe('Planned');
    expect(statusLabel('deterministic-rules', experience)).toBe('Experimental');
  });

  test('keeps the shared AI choice set exact', () => {
    expect(experience.ai_modes.map(mode => mode.label)).toEqual(['Off', 'Peak AI', 'Custom Endpoint']);
  });
});
