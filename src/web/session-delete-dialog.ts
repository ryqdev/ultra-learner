import type { SessionSummary } from "../lib/sessions.ts";

interface DialogElement extends EventTarget {
  open: boolean;
  returnValue: string;
  close(returnValue?: string): void;
  showModal(): void;
}

interface SessionDeleteDialogElements {
  dialog: DialogElement;
  filename: { textContent: string | null };
  cancelButton: EventTarget;
  confirmButton: EventTarget;
}

export function configureSessionDeleteDialog(
  elements: SessionDeleteDialogElements,
  onConfirm: (session: SessionSummary) => void,
): (session: SessionSummary) => boolean {
  let pendingSession: SessionSummary | null = null;

  elements.cancelButton.addEventListener("click", () => elements.dialog.close("cancel"));
  elements.confirmButton.addEventListener("click", () => elements.dialog.close("delete"));
  elements.dialog.addEventListener("close", () => {
    const session = pendingSession;
    const confirmed = elements.dialog.returnValue === "delete";
    pendingSession = null;
    elements.dialog.returnValue = "";
    if (confirmed && session) onConfirm(session);
  });

  return (session) => {
    if (elements.dialog.open) return false;
    pendingSession = session;
    elements.filename.textContent = session.filename;
    elements.dialog.returnValue = "";
    elements.dialog.showModal();
    return true;
  };
}
