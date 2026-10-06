/* eslint-disable testing-library/no-unnecessary-act, testing-library/no-node-access */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import AvatarCropDialog from './AvatarCropDialog';
let root, container, photo;
const drawImage = jest.fn(), onSave = jest.fn(), onCancel = jest.fn();
beforeEach(() => {
  window.IS_REACT_ACT_ENVIRONMENT = true; drawImage.mockClear(); onSave.mockClear(); onCancel.mockClear();
  jest.spyOn(window, 'Image').mockImplementation(() => { photo = { width: 1000, height: 800 }; return photo; });
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage });
  jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['jpeg'], { type: 'image/jpeg' })));
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.restoreAllMocks(); delete window.IS_REACT_ACT_ENVIRONMENT; });
test('crop controls update the exact preview and the saved JPEG; Escape cancels', async () => {
  await act(async () => root.render(<AvatarCropDialog source="blob:photo" english busy={false} onSave={onSave} onCancel={onCancel} />));
  await act(async () => photo.onload());
  expect(drawImage).toHaveBeenLastCalledWith(photo, 100, 0, 800, 800, 0, 0, 256, 256);
  const ranges = container.querySelectorAll('input[type=range]');
  await act(async () => Simulate.change(ranges[2], { target: { value: '2' } }));
  expect(drawImage).toHaveBeenLastCalledWith(photo, 300, 200, 400, 400, 0, 0, 256, 256);
  await act(async () => container.querySelectorAll('button')[1].click());
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/jpeg' }));
  await act(async () => Simulate.keyDown(container.querySelector('[role=dialog]'), { key: 'Escape', stopPropagation() {} }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});
