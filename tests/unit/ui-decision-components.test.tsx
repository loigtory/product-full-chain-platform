// @vitest-environment jsdom

import { useState } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Button, ConfirmDialog, Drawer } from '@pfc/ui';

afterEach(cleanup);

describe('decision overlays', () => {
  it('closes a Drawer with Escape and restores focus to its opener', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>查看审批</Button>
          {open ? (
            <Drawer
              aria-label="文件变更审批"
              closeIcon={<span aria-hidden="true">x</span>}
              onClose={() => setOpen(false)}
              title="文件变更审批"
            >
              <p>审批内容</p>
            </Drawer>
          ) : null}
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole('button', { name: '查看审批' });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(
      screen.getByRole('dialog', { name: '文件变更审批' }),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('closes a confirmation dialog with Escape and restores focus', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>取消运行</Button>
          {open ? (
            <ConfirmDialog
              actions={<Button onClick={() => setOpen(false)}>确认执行</Button>}
              onDismiss={() => setOpen(false)}
              title="确认取消运行"
            >
              <p>取消说明</p>
            </ConfirmDialog>
          ) : null}
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole('button', { name: '取消运行' });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(
      screen.getByRole('alertdialog', { name: '确认取消运行' }),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});
