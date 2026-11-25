import { useState } from "react";

export const STORAGE_LIMIT_MESSAGE =
  "You've reached your local storage limit. You can adjust this in Settings.";

/** The storage-limit modal, plus a restore that was blocked by the limit (if any). */
export function useStorageWarning() {
  const [showStorageWarning, setShowStorageWarning] = useState(false);
  const [storageWarningMessage, setStorageWarningMessage] = useState("");
  const [pendingCheckoutStorageId, setPendingCheckoutStorageId] = useState<string | null>(null);

  /** Shows the modal; pass the blocked restore's commit to offer "proceed anyway". */
  const showStorageLimit = (message: string, blockedCheckoutId?: string) => {
    setStorageWarningMessage(message);
    if (blockedCheckoutId !== undefined) setPendingCheckoutStorageId(blockedCheckoutId);
    setShowStorageWarning(true);
  };

  /** Hides the modal and forgets the blocked restore. */
  const dismissStorageWarning = () => {
    setShowStorageWarning(false);
    setPendingCheckoutStorageId(null);
  };

  /** Hides the modal, keeping the blocked restore for the caller to take. */
  const hideStorageWarning = () => setShowStorageWarning(false);

  /** Returns the blocked restore's commit (if any) and clears it. */
  const takePendingCheckout = (): string | null => {
    const id = pendingCheckoutStorageId;
    if (id) setPendingCheckoutStorageId(null);
    return id;
  };

  return {
    showStorageWarning,
    storageWarningMessage,
    pendingCheckoutStorageId,
    showStorageLimit,
    dismissStorageWarning,
    hideStorageWarning,
    takePendingCheckout,
  };
}
