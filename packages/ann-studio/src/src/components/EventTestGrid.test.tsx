// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EventTestGrid from './EventTestGrid';
import { createPackProject } from '../lib/packProject';
import { hydrateProject } from '../lib/project';
import { useStudioStore } from '../store/useStudioStore';

const api = vi.hoisted(() => ({ build: vi.fn(), invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: api.invoke }));
vi.mock('../lib/exportGmaidenPack', () => ({ buildCurrentGann: api.build, installGmaidenPack: vi.fn(), installLibraryPack: vi.fn() }));
vi.mock('./GannPackage', () => ({ default: () => <div>packaged preview</div> }));

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  api.build.mockReset();
  useStudioStore.setState({ projectDocument: createPackProject(), clips: [], packBuilder: {}, bannerOverrides: {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('clears a preview error when another project is opened', async () => {
  api.build.mockRejectedValueOnce(new Error('no mapped sounds'));
  render(<EventTestGrid />);
  fireEvent.click(screen.getByRole('button', { name: /ทดสอบ event: Danger/ }));
  await screen.findByRole('alert');
  act(() => useStudioStore.setState({ projectDocument: createPackProject() }));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('does not show an old project preview after switching projects during a build', async () => {
  let resolve!: (value: {path: string}) => void;
  api.build.mockReturnValueOnce(new Promise(res => { resolve = res; }));
  render(<EventTestGrid />);
  fireEvent.click(screen.getByRole('button', { name: /ทดสอบ event: Danger/ }));
  act(() => useStudioStore.setState({ projectDocument: createPackProject() }));
  await act(async () => { resolve({ path: 'old-project.gann' }); });
  expect(screen.queryByText('packaged preview')).toBeNull();
});

it('shows an error when the first build creates its project lazily', async () => {
  useStudioStore.setState({ projectDocument: null });
  api.build.mockImplementationOnce(() => {
    useStudioStore.setState({ projectDocument: createPackProject() });
    return Promise.reject(new Error('no mapped sounds'));
  });
  render(<EventTestGrid />);
  fireEvent.click(screen.getByRole('button', { name: /ทดสอบ event: Danger/ }));
  expect((await screen.findByRole('alert')).textContent).toContain('no mapped sounds');
});

it('clears the old error when reopening the same project ID', async () => {
  const project = createPackProject();
  act(() => hydrateProject({ snapshot: { project, generation: 0, fingerprint: '' }, assetPaths: {} }));
  api.build.mockRejectedValueOnce(new Error('old error'));
  render(<EventTestGrid />);
  fireEvent.click(screen.getByRole('button', { name: /ทดสอบ event: Danger/ }));
  await screen.findByRole('alert');
  act(() => hydrateProject({ snapshot: { project, generation: 0, fingerprint: '' }, assetPaths: {} }));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('ignores a pending preview after a batched A-to-B-to-A reopen', async () => {
  const a = createPackProject(), b = createPackProject();
  const open = (project: typeof a) => hydrateProject({ snapshot: { project, generation: 0, fingerprint: '' }, assetPaths: {} });
  act(() => open(a));
  let resolve!: (value: {path: string}) => void;
  api.build.mockReturnValueOnce(new Promise(res => { resolve = res; }));
  render(<EventTestGrid />);
  fireEvent.click(screen.getByRole('button', { name: /ทดสอบ event: Danger/ }));
  act(() => { open(b); open(a); });
  await act(async () => { resolve({ path: 'stale.gann' }); });
  expect(screen.queryByText('packaged preview')).toBeNull();
});
