/* eslint-disable testing-library/no-unnecessary-act, testing-library/no-node-access */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import EmployeeRequestsWorkspace from './EmployeeRequestsWorkspace';
let root, container;
const noop = () => {};
const props = {
  REQUEST_CATEGORIES: [], REQUEST_PRIORITIES: [], RequestTimerMetrics: () => null, applicationsError: '', applicationsLoading: false,
  confirmApplicationDone: noop, fetchMyApplications: noop, formatApplicationDateTime: () => '', getApplicationStatusMeta: status => ({ tone: status, label: status }),
  getApplicationTiming: () => ({}), getRequestCategoryLabel: value => value, getRequestPriorityLabel: value => value, interfaceLocale: 'ru-RU',
  isEnglishInterface: false, localizeRuntimeText: value => value, reopenApplication: noop, requestCategory: '', requestPriority: '', requestStatus: { state: 'idle' }, requestText: '',
  setRequestCategory: noop, setRequestPriority: noop, setRequestText: noop, submitRequest: noop, t: value => value,
  activeApplications: [1, 2, 3].map((id, index) => ({ id, source: 'chat', status: ['new', 'in_progress', 'reopened'][index], application: `Описание ${id}` })),
  completedApplications: [{ id: 4, source: 'chat', status: 'done', application: 'Завершённая' }]
};
beforeEach(() => { window.IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); delete window.IS_REACT_ACT_ENVIRONMENT; });
test('each active chat request has its own cancel button; completed and admin-created requests have none', async () => {
  const cancelApplication = jest.fn();
  await act(async () => root.render(<EmployeeRequestsWorkspace {...props} activeApplications={[...props.activeApplications, { id: 5, source: 'admin', status: 'new' }]} cancelApplication={cancelApplication} />));
  const buttons = [...container.querySelectorAll('.ticket-cancel-btn')]; expect(buttons).toHaveLength(3);
  await act(async () => { buttons[1].click(); }); expect(cancelApplication).toHaveBeenCalledWith(2);
  expect(container.querySelector('.ticket-history .ticket-cancel-btn')).toBeNull();
});
test('only the cancelling card is blocked and errors stay alongside the affected request', async () => {
  await act(async () => root.render(<EmployeeRequestsWorkspace {...props} cancelApplication={noop} cancellingApplicationIds={['2']} cancellationErrors={{ 3: 'Проверьте соединение' }} cancellationNotice="Заявка №1 отменена." />));
  const cards = [...container.querySelectorAll('.employee-ticket-card')];
  expect(cards[0].querySelector('button').disabled).toBe(false); expect([...cards[1].querySelectorAll('button')].every(button => button.disabled)).toBe(true);
  expect(cards[2].querySelector('[role=alert]').textContent).toContain('Проверьте соединение'); expect(container.querySelector('[role=status]').textContent).toContain('№1');
});
