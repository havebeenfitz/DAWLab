import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Dialog, type DialogProps } from '../Dialog';

// happy-dom has no layout, so offsetParent is null for everything. The Tab trap
// filters out invisible elements with it; make every element "visible".
let restoreOffsetParent: (() => void) | null = null;
beforeAll(() => {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return document.body; },
  });
  restoreOffsetParent = () => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'offsetParent', original);
    else delete (HTMLElement.prototype as any).offsetParent;
  };
});

function renderDialog(props: Partial<DialogProps> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <Dialog open title="Share folder" onClose={onClose} {...props}>
      {props.children ?? (
        <>
          <input aria-label="First field" />
          <button type="button">Middle</button>
        </>
      )}
    </Dialog>,
  );
  return { onClose, ...utils };
}

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<Dialog open={false} title="Hidden" onClose={() => {}}>body</Dialog>);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a labelled modal dialog with subtitle, body and footer', () => {
    renderDialog({ subtitle: 'One line', footer: <button type="button">Done</button> });
    const dialog = screen.getByRole('dialog', { name: 'Share folder' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = dialog.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelledBy)).toHaveTextContent('Share folder');
    expect(screen.getByText('One line')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('applies the width class', () => {
    renderDialog({ width: 'lg' });
    expect(screen.getByRole('dialog')).toHaveClass('ui-dialog-lg');
  });

  it('closes with the close button', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables the close button while busy', () => {
    renderDialog({ busy: true });
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  });

  it('closes on Escape', () => {
    const { onClose } = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while busy', () => {
    const { onClose } = renderDialog({ busy: true });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('uses the latest busy value without reopening', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Dialog open title="T" onClose={onClose} busy={false}><button>x</button></Dialog>);
    rerender(<Dialog open title="T" onClose={onClose} busy><button>x</button></Dialog>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    rerender(<Dialog open title="T" onClose={onClose} busy={false}><button>x</button></Dialog>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls the latest onClose on Escape', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Dialog open title="T" onClose={first}><button>x</button></Dialog>);
    rerender(<Dialog open title="T" onClose={second}><button>x</button></Dialog>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop mousedown', () => {
    const { onClose } = renderDialog();
    const backdrop = screen.getByRole('dialog').parentElement!;
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on mousedown inside the panel', () => {
    const { onClose } = renderDialog();
    fireEvent.mouseDown(screen.getByRole('dialog'));
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Middle' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on backdrop mousedown while busy', () => {
    const { onClose } = renderDialog({ busy: true });
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('moves focus to the first focusable element', () => {
    renderDialog();
    // The header close button comes first in DOM order.
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('prefers an element marked data-autofocus', () => {
    renderDialog({
      children: (
        <>
          <button type="button">Other</button>
          <input aria-label="Code" data-autofocus />
        </>
      ),
    });
    expect(screen.getByLabelText('Code')).toHaveFocus();
  });

  it('returns focus to the previously focused element on close', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Opener</button>
          <Dialog open={open} title="T" onClose={() => setOpen(false)}>
            <button type="button">Inside</button>
          </Dialog>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Opener' });
    opener.focus();
    fireEvent.click(opener);
    expect(opener).not.toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('wraps Tab from the last to the first focusable element', () => {
    renderDialog({ footer: <button type="button">Last</button> });
    const last = screen.getByRole('button', { name: 'Last' });
    last.focus();
    const ev = fireEvent.keyDown(document, { key: 'Tab' });
    expect(ev).toBe(false); // default prevented
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('wraps Shift+Tab from the first to the last focusable element', () => {
    renderDialog({ footer: <button type="button">Last</button> });
    screen.getByRole('button', { name: 'Close' }).focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
  });

  it('leaves Tab alone in the middle of the dialog', () => {
    renderDialog({ footer: <button type="button">Last</button> });
    const middle = screen.getByRole('button', { name: 'Middle' });
    middle.focus();
    const ev = fireEvent.keyDown(document, { key: 'Tab' });
    expect(ev).toBe(true); // not prevented
    expect(middle).toHaveFocus();
  });

  it('skips disabled controls when wrapping', () => {
    renderDialog({ footer: <><button type="button">Last</button><button type="button" disabled>Off</button></> });
    screen.getByRole('button', { name: 'Close' }).focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
  });

  it('stops listening for keys after closing', () => {
    const onClose = vi.fn();
    const { rerender } = render(<Dialog open title="T" onClose={onClose}><button>x</button></Dialog>);
    rerender(<Dialog open={false} title="T" onClose={onClose}><button>x</button></Dialog>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

// Restore the prototype for other suites in the same worker.
afterAll(() => restoreOffsetParent?.());
