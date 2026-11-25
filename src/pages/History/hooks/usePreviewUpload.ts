import { useState } from "react";
import type React from "react";
import { notify } from "@/lib/notify";
import type { Commit } from "@/types/project.types";

/** Drag-and-drop of an audio file onto the preview bar to attach it to the active version. */
export function usePreviewUpload(
  activeCommit: Commit | null,
  passedProject: string | undefined,
  refreshProjectLog: () => Promise<void>,
) {
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isUploadingPreview, setIsUploadingPreview] = useState(false);

  const performPreviewUpload = async (filePath: string) => {
    const targetCommitId = activeCommit?.commit_id;
    if (!targetCommitId) return;
    setIsUploadingPreview(true);
    try {
      const result = await window.ipcRenderer.invoke("add-preview-to-commit", passedProject, targetCommitId, filePath);
      if (result.success) {
        await refreshProjectLog();
      }
    } catch (error: any) {
      console.error("Failed to add preview:", error);
      notify.error("Couldn't add the preview", error);
    } finally {
      setIsUploadingPreview(false);
    }
  };

  const handlePreviewDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    const filePath = window.electronAPI.getPathForFile(files[0]);
    if (!filePath) {
      console.error("No file path found on dropped file");
      return;
    }

    if (!activeCommit?.commit_id) {
      notify.info("Pick a version first", "Select the version you want to attach this preview to, then drop the audio again.");
      return;
    }

    await performPreviewUpload(filePath);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(true);
  };

  const handleDragLeave = () => {
    setIsDraggingFile(false);
  };

  return { isDraggingFile, isUploadingPreview, handlePreviewDrop, handleDragOver, handleDragLeave };
}
