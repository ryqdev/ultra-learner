import { describe, expect, test } from "bun:test";

import { configureSessionDeleteDialog } from "../src/web/session-delete-dialog.ts";

const firstSession = {
  id: "session-01",
  filename: "first.pdf",
  fileSize: 1_024,
  createdAt: "2026-08-28T00:00:00.000Z",
};

const secondSession = {
  id: "session-02",
  filename: "second.pdf",
  fileSize: 2_048,
  createdAt: "2026-08-28T01:00:00.000Z",
};

class FakeDialog extends EventTarget {
  public open = false;
  public returnValue = "";

  public showModal(): void {
    this.open = true;
  }

  public close(returnValue = ""): void {
    this.open = false;
    this.returnValue = returnValue;
    this.dispatchEvent(new Event("close"));
  }
}

describe("session delete confirmation dialog", () => {
  test("explicit confirmation deletes the pending session", () => {
    const dialog = new FakeDialog();
    const filename = { textContent: "" };
    const cancelButton = new EventTarget();
    const confirmButton = new EventTarget();
    const confirmed: typeof firstSession[] = [];
    const open = configureSessionDeleteDialog({ dialog, filename, cancelButton, confirmButton }, (session) => {
      confirmed.push(session);
    });

    expect(open(firstSession)).toBe(true);
    expect(open(secondSession)).toBe(false);
    expect(filename.textContent).toBe("first.pdf");
    confirmButton.dispatchEvent(new Event("click"));

    expect(dialog.open).toBe(false);
    expect(confirmed).toEqual([firstSession]);
  });

  test("cancel closes the dialog without deleting the session", () => {
    const dialog = new FakeDialog();
    const cancelButton = new EventTarget();
    const confirmButton = new EventTarget();
    const confirmed: typeof firstSession[] = [];
    const open = configureSessionDeleteDialog(
      { dialog, filename: { textContent: "" }, cancelButton, confirmButton },
      (session) => confirmed.push(session),
    );

    open(firstSession);
    cancelButton.dispatchEvent(new Event("click"));

    expect(dialog.open).toBe(false);
    expect(confirmed).toEqual([]);
  });
});
