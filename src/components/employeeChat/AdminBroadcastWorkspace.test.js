/* eslint-disable testing-library/no-unnecessary-act -- Uses ReactDOM directly, without Testing Library. */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import AdminBroadcastWorkspace from './AdminBroadcastWorkspace';
import { authFetch } from '../../utils/authFetch';
jest.mock('../../utils/authFetch', () => ({ authFetch: jest.fn() }));

const people = Array.from({ length: 12 }, (_, index) => ({ login: `employee${index}`, name: `Сотрудник ${index}`, department: 'Отдел' }));
let container;
let root;
let confirmAction;
let onSent;
const posts = () => authFetch.mock.calls.filter(([, options]) => options?.method === 'POST');
const resultFor = (body) => ({ id: body.id, text: body.text, attachments: body.attachments, total: body.recipients.length, delivered: body.recipients.length, read: 0, recipients: [] });
const response = (data) => ({ ok: true, json: async () => data });

beforeEach(() => {
  window.IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); authFetch.mockReset();
  confirmAction = jest.fn().mockResolvedValue(true); onSent = jest.fn();
  authFetch.mockImplementation(async (url, options) => {
    if (options?.method === 'POST') return response(resultFor(JSON.parse(options.body)));
    return response(url.endsWith('/recipients') ? people : { items: [], hasMore: false });
  });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); localStorage.clear(); delete window.IS_REACT_ACT_ENVIRONMENT; });
const render = async () => { await act(async () => root.render(<AdminBroadcastWorkspace login="admin" confirmAction={confirmAction} onSent={onSent} uploadFile={jest.fn()} />)); };
const writeText = () => act(() => Simulate.change(container.querySelector('textarea'), { target: { value: 'Объявление' } }));

test('selects ten employees by name and sends exactly those ten after confirmation', async () => {
  await render();
  const checkboxes = container.querySelectorAll('input[type="checkbox"]');
  act(() => { Array.from(checkboxes).slice(0, 10).forEach((checkbox) => Simulate.change(checkbox)); });
  expect(container.textContent).toContain('Выбрано: 10');
  writeText();
  expect(posts()).toHaveLength(0);
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(confirmAction).toHaveBeenCalledTimes(1);
  expect(JSON.parse(posts()[0][1].body).recipients).toEqual(people.slice(0, 10).map((person) => person.login));
  expect(container.textContent).toContain('Доставлено 10 из 10');
  expect(onSent).toHaveBeenCalled();
});

test('all employees means the shown recipient list and cancelling confirmation sends nothing', async () => {
  await render(); writeText();
  act(() => Simulate.change(container.querySelectorAll('input[type="radio"]')[1]));
  expect(container.textContent).toContain('Отправить всем — 12');
  confirmAction.mockResolvedValueOnce(false);
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(posts()).toHaveLength(0);
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(JSON.parse(posts()[0][1].body).recipients).toEqual(people.map((person) => person.login));
});

test('lost responses survive a remount and retry the same immutable command', async () => {
  await render(); writeText();
  act(() => Simulate.change(container.querySelector('input[type="checkbox"]')));
  authFetch.mockImplementationOnce(async () => { throw new Error('Соединение прервалось'); });
  await act(async () => Simulate.submit(container.querySelector('form')));
  const original = JSON.parse(posts()[0][1].body);
  expect(container.textContent).toContain('Проверка отправки');
  expect(container.querySelector('textarea')).toBeNull();
  act(() => { root.unmount(); }); root = createRoot(container);
  await render();
  expect(container.textContent).toContain('Получателей: 1');
  const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Повторить запрос');
  await act(async () => Simulate.click(retry));
  expect(JSON.parse(posts()[1][1].body)).toEqual(original);
  expect(confirmAction).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('chat.broadcast.pending.admin')).toBeNull();
});

test('double submit opens one confirmation and sends one broadcast', async () => {
  await render(); writeText();
  act(() => Simulate.change(container.querySelector('input[type="checkbox"]')));
  let resolveConfirmation;
  confirmAction.mockImplementation(() => new Promise((resolve) => { resolveConfirmation = resolve; }));
  act(() => { Simulate.submit(container.querySelector('form')); Simulate.submit(container.querySelector('form')); });
  expect(confirmAction).toHaveBeenCalledTimes(1);
  await act(async () => { resolveConfirmation(true); });
  expect(posts()).toHaveLength(1);
});

test('rejected recipient validation restores an editable draft', async () => {
  await render(); writeText();
  act(() => Simulate.change(container.querySelector('input[type="checkbox"]')));
  authFetch.mockImplementationOnce(async () => ({ ok: false, status: 400, json: async () => ({ message: 'Список сотрудников изменился' }) }));
  await act(async () => Simulate.submit(container.querySelector('form')));
  expect(container.querySelector('textarea').value).toBe('Объявление');
  expect(container.querySelector('textarea').disabled).toBe(false);
  expect(localStorage.getItem('chat.broadcast.pending.admin')).toBeNull();
});
