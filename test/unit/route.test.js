import router from '~/route';

describe('router', () => {
  test('root redirect uses localStorage landingpage when set', () => {
    const rootRoute = router.options.routes.find(route => route.path === '/');

    localStorage.landingpage = '/work-report';
    expect(rootRoute.redirect({})).toBe('/work-report');
  });

  test('root redirect falls back to /home when localStorage landingpage is missing', () => {
    const rootRoute = router.options.routes.find(route => route.path === '/');

    delete localStorage.landingpage;
    expect(rootRoute.redirect({})).toBe('/home');
  });

  test('includes the work report route', () => {
    const workReportRoute = router.options.routes.find(route => route.path === '/work-report');

    expect(workReportRoute).toBeTruthy();
    expect(typeof workReportRoute.component).toBe('function');
  });

  test('includes the data lifecycle settings route', () => {
    const match = router.match('/settings/data');
    expect(match.matched.some(route => route.path.includes(':group('))).toBe(true);
    expect(match.params.group).toBe('data');
  });

  test('includes the shared E2EE sync settings route', () => {
    const match = router.match('/settings/sync');
    expect(match.matched.some(route => route.path.includes(':group('))).toBe(true);
    expect(match.params.group).toBe('sync');
  });
});
