import { it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  vi.mocked(chrome.storage.sync.get).mockReset();
  vi.mocked(chrome.storage.sync.set).mockReset();
  vi.mocked(chrome.storage.sync.set).mockResolvedValue(undefined);
});

it('displays saved whitelist on mount', async () => {
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    allowedRepos: ['owner/repo'],
    autoPreview: false,
    defaultZoom: 100,
  });

  render(<App />);

  await waitFor(() => {
    expect(screen.getByText('owner/repo')).toBeInTheDocument();
  });
});

it('adds a repository to the whitelist', async () => {
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    allowedRepos: [],
    autoPreview: false,
    defaultZoom: 100,
  });

  render(<App />);

  await waitFor(() => {
    expect(screen.getByPlaceholderText('owner/repo')).toBeInTheDocument();
  });

  const input = screen.getByPlaceholderText('owner/repo');
  const addBtn = screen.getByRole('button', { name: 'Add' });

  fireEvent.change(input, { target: { value: 'my-org/my-repo' } });
  fireEvent.click(addBtn);

  await waitFor(() => {
    expect(chrome.storage.sync.set).toHaveBeenCalledWith(
      expect.objectContaining({ allowedRepos: ['my-org/my-repo'] })
    );
  });
});

it('removes a repository from the whitelist', async () => {
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    allowedRepos: ['owner/repo'],
    autoPreview: false,
    defaultZoom: 100,
  });

  render(<App />);

  await waitFor(() => {
    expect(screen.getByText('owner/repo')).toBeInTheDocument();
  });

  const removeBtn = screen.getByRole('button', { name: 'Remove' });
  fireEvent.click(removeBtn);

  await waitFor(() => {
    expect(chrome.storage.sync.set).toHaveBeenCalledWith(
      expect.objectContaining({ allowedRepos: [] })
    );
  });
});

it('shows validation error for invalid format', async () => {
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    allowedRepos: [],
    autoPreview: false,
    defaultZoom: 100,
  });

  render(<App />);

  await waitFor(() => {
    expect(screen.getByPlaceholderText('owner/repo')).toBeInTheDocument();
  });

  const input = screen.getByPlaceholderText('owner/repo');
  const addBtn = screen.getByRole('button', { name: 'Add' });

  fireEvent.change(input, { target: { value: 'invalid' } });
  fireEvent.click(addBtn);

  await waitFor(() => {
    expect(screen.getByText(/owner\/repo.*owner\/\*/)).toBeInTheDocument();
  });

  expect(chrome.storage.sync.set).not.toHaveBeenCalled();
});

it('toggles auto-preview and saves to storage', async () => {
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    allowedRepos: [],
    autoPreview: false,
    defaultZoom: 100,
  });

  render(<App />);

  await waitFor(() => {
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  const toggle = screen.getByRole('checkbox');
  fireEvent.click(toggle);

  await waitFor(() => {
    expect(chrome.storage.sync.set).toHaveBeenCalledWith(
      expect.objectContaining({ autoPreview: true })
    );
  });
});

it('changes default zoom and saves to storage', async () => {
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    allowedRepos: [],
    autoPreview: false,
    defaultZoom: 100,
  });

  render(<App />);

  await waitFor(() => {
    expect(screen.getByDisplayValue('100')).toBeInTheDocument();
  });

  const zoomInput = screen.getByDisplayValue('100');
  fireEvent.change(zoomInput, { target: { value: '150' } });

  await waitFor(() => {
    expect(chrome.storage.sync.set).toHaveBeenCalledWith(
      expect.objectContaining({ defaultZoom: 150 })
    );
  });
});

it('clamps zoom value to valid range', async () => {
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    allowedRepos: [],
    autoPreview: false,
    defaultZoom: 100,
  });

  render(<App />);

  await waitFor(() => {
    expect(screen.getByDisplayValue('100')).toBeInTheDocument();
  });

  const zoomInput = screen.getByDisplayValue('100');
  fireEvent.change(zoomInput, { target: { value: '300' } });

  await waitFor(() => {
    expect(chrome.storage.sync.set).toHaveBeenCalledWith(
      expect.objectContaining({ defaultZoom: 200 })
    );
  });
});
