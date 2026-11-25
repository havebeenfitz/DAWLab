import { useState } from "react";

/** What to continue with once the user has chosen where the project lives. */
export interface PendingPathAction {
  type: "checkout" | "commit" | "branch";
  commitId?: string;
}

/** State of the "where is this project?" modal and the action waiting on it. */
export function usePathPrompt() {
  const [showPathModal, setShowPathModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingPathAction | null>(null);

  /** Opens the modal; `action` (or null to just update the path) runs after confirm. */
  const requestPath = (action: PendingPathAction | null) => {
    setPendingAction(action);
    setShowPathModal(true);
  };

  /** Opens the modal without touching the pending action. */
  const openPathModal = () => setShowPathModal(true);

  const closePathModal = () => {
    setShowPathModal(false);
    setPendingAction(null);
  };

  return { showPathModal, pendingAction, requestPath, openPathModal, closePathModal };
}
