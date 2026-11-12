import { resetVisitTrackingForTests, setVisitPath, setVisitUser, startVisitTracking } from './visitTracker';

const setStoredUser = (username, role, token) => {
  if (!token) {
    localStorage.removeItem('authState');
    return;
  }
  localStorage.setItem('authState', JSON.stringify({
    isAuthenticated: true,
    user: { username, role, accessToken: token }
  }));
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
};

const sentPings = () => global.fetch.mock.calls.map(([, init]) => ({
  body: JSON.parse(init.body),
  authorization: init.headers.Authorization || ''
}));

describe('visit tracker identity changes', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/admin');
    document.title = 'Админка';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    resetVisitTrackingForTests();
  });

  afterEach(() => {
    resetVisitTrackingForTests();
    jest.restoreAllMocks();
  });

  test('a different account in the same tab gets a new visit instead of overwriting the previous login', async () => {
    startVisitTracking();
    await settle();

    setStoredUser('admin', 'admin', 'admin-token');
    setVisitUser({ username: 'admin', role: 'admin' });
    await settle();

    setStoredUser('', '', '');
    setVisitUser(null);
    await settle();

    window.history.replaceState({}, '', '/employee');
    setVisitPath('/employee', 'Чат сотрудников');
    setStoredUser('employee', 'employee', 'employee-token');
    setVisitUser({ username: 'employee', role: 'employee' });
    await settle();

    const pings = sentPings();
    const adminPing = pings.find((ping) => ping.authorization === 'Bearer admin-token');
    const employeePing = pings.find((ping) => ping.authorization === 'Bearer employee-token');

    expect(adminPing).toBeDefined();
    expect(employeePing).toBeDefined();
    expect(employeePing.body.sessionId).not.toBe(adminPing.body.sessionId);
    expect(employeePing.body.pages.map((page) => page.path)).toContain('/employee');
  });

  test('switching accounts without an explicit logout also starts a new visit', async () => {
    startVisitTracking();
    await settle();

    setStoredUser('admin', 'admin', 'admin-token');
    setVisitUser({ username: 'admin', role: 'admin' });
    await settle();

    window.history.replaceState({}, '', '/employee');
    setVisitPath('/employee', 'Чат сотрудников');
    setStoredUser('employee', 'employee', 'employee-token');
    setVisitUser({ username: 'employee', role: 'employee' });
    await settle();

    const pings = sentPings();
    const adminPing = pings.find((ping) => ping.authorization === 'Bearer admin-token');
    const employeePing = pings.find((ping) => ping.authorization === 'Bearer employee-token');
    expect(adminPing).toBeDefined();
    expect(employeePing).toBeDefined();
    expect(employeePing.body.sessionId).not.toBe(adminPing.body.sessionId);
  });

  test('after a reload a different account still gets a separate visit', async () => {
    startVisitTracking();
    await settle();

    setStoredUser('admin', 'admin', 'admin-token');
    setVisitUser({ username: 'admin', role: 'admin' });
    await settle();
    const adminSessionId = sentPings()
      .find((ping) => ping.authorization === 'Bearer admin-token')
      .body.sessionId;

    resetVisitTrackingForTests();
    await settle();
    global.fetch.mockClear();
    setStoredUser('employee', 'employee', 'employee-token');
    startVisitTracking();
    await settle();
    setVisitUser({ username: 'employee', role: 'employee' });
    await settle();

    const employeePing = sentPings()
      .find((ping) => ping.authorization === 'Bearer employee-token');
    expect(employeePing).toBeDefined();
    expect(employeePing.body.sessionId).not.toBe(adminSessionId);
  });

  test('the first sign-in keeps the already started guest visit', async () => {
    startVisitTracking();
    await settle();

    setStoredUser('employee', 'employee', 'employee-token');
    setVisitUser({ username: 'employee', role: 'employee' });
    await settle();

    const pings = sentPings();
    const sessions = new Set(pings.map((ping) => ping.body.sessionId));
    expect(sessions.size).toBe(1);
    expect(pings[pings.length - 1].authorization).toBe('Bearer employee-token');
  });
});
