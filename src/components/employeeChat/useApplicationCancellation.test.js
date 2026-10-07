/* eslint-disable testing-library/no-unnecessary-act, testing-library/no-node-access */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import useApplicationCancellation from './useApplicationCancellation';
import { authFetch } from '../../utils/authFetch';
jest.mock('../../utils/authFetch', () => ({ authFetch: jest.fn() }));
let root, container, model;
const confirmAction = jest.fn(), onCancelled = jest.fn(), refresh = jest.fn();
const response = (status = 200, error = '') => ({ ok: status < 400, status, json: async () => ({ error }) });
const defer = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
function Fixture() { model = useApplicationCancellation({ english: false, confirmAction, onCancelled, refresh }); return null; }
beforeEach(() => {
  window.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  confirmAction.mockReset().mockResolvedValue(true); onCancelled.mockReset(); refresh.mockReset(); authFetch.mockReset().mockResolvedValue(response());
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete window.IS_REACT_ACT_ENVIRONMENT; });
const mount = async () => { await act(async () => root.render(<Fixture />)); };
test('declining confirmation leaves the request and does not call the server', async () => {
  await mount();
  confirmAction.mockResolvedValue(false); await act(async () => model.cancelApplication(1));
  expect(authFetch).not.toHaveBeenCalled(); expect(onCancelled).not.toHaveBeenCalled(); expect(model.cancellingApplicationIds).toEqual([]);
});
test('repeated clicks send one cancellation and block only that request', async () => {
  await mount();
  const pending = defer(); authFetch.mockReturnValueOnce(pending.promise);
  let first; await act(async () => { first = model.cancelApplication(1); });
  await act(async () => model.cancelApplication(1));
  expect(authFetch).toHaveBeenCalledTimes(1); expect(model.cancellingApplicationIds).toEqual(['1']);
  expect(authFetch.mock.calls[0][0]).toContain('/applications/1/cancel'); expect(authFetch.mock.calls[0][1].method).toBe('POST');
  await act(async () => { pending.resolve(response()); await first; });
  expect(onCancelled).toHaveBeenCalledWith(1); expect(model.cancellationNotice).toContain('№1'); expect(model.cancellingApplicationIds).toEqual([]);
});
test('two independent cancellations can finish in a different order', async () => {
  await mount();
  const a = defer(), b = defer(); authFetch.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  let first, second; await act(async () => { first = model.cancelApplication(1); second = model.cancelApplication(2); });
  expect(model.cancellingApplicationIds).toEqual(['1', '2']);
  await act(async () => { b.resolve(response()); await second; });
  expect(onCancelled).toHaveBeenCalledWith(2); expect(model.cancellingApplicationIds).toEqual(['1']);
  await act(async () => { a.resolve(response()); await first; }); expect(onCancelled).toHaveBeenCalledWith(1);
});
test('network failure retains the request and a retry uses the same request ID', async () => {
  await mount();
  authFetch.mockRejectedValueOnce(new TypeError('Load failed'));
  await act(async () => model.cancelApplication(3));
  expect(onCancelled).not.toHaveBeenCalled(); expect(model.cancellationErrors['3']).toContain('Проверьте соединение'); expect(model.cancellingApplicationIds).toEqual([]);
  await act(async () => model.cancelApplication(3));
  expect(authFetch.mock.calls.map(([url]) => url)).toEqual([authFetch.mock.calls[0][0], authFetch.mock.calls[0][0]]);
  expect(onCancelled).toHaveBeenCalledWith(3); expect(model.cancellationErrors['3']).toBe('');
});
test('an already closed request remains visible with an explanation and a list refresh', async () => {
  await mount();
  authFetch.mockResolvedValueOnce(response(409, 'Заявка уже закрыта. Обновите список заявок.'));
  await act(async () => model.cancelApplication(1));
  expect(onCancelled).not.toHaveBeenCalled(); expect(refresh).toHaveBeenCalledTimes(1); expect(model.cancellationErrors['1']).toContain('уже закрыта');
});
test('a request already deleted elsewhere disappears and unmount aborts unfinished requests', async () => {
  await mount();
  authFetch.mockResolvedValueOnce(response(404)); await act(async () => model.cancelApplication(1)); expect(onCancelled).toHaveBeenCalledWith(1);
  const pending = defer(); authFetch.mockReturnValueOnce(pending.promise);
  let saving; await act(async () => { saving = model.cancelApplication(2); });
  const signal = authFetch.mock.calls.at(-1)[1].signal;
  act(() => root.unmount()); root = createRoot(container); expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(response()); await saving; }); expect(onCancelled).not.toHaveBeenCalledWith(2);
});
