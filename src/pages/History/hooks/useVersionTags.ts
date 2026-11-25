import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Commit, ProjectLog } from "@/types/project.types";
import { buildTagSuggestions } from "@/lib/tags";

export interface VersionTagPopoverState {
  commitId: string;
  x: number;
  y: number;
}

/** Returns a copy of `log` with `commitId`'s tags replaced by `next(currentTags)`. */
function withCommitTags(
  log: ProjectLog,
  commitId: string,
  next: (prevTags: string[]) => string[],
): ProjectLog {
  return {
    ...log,
    branches: log.branches.map((b) => ({
      ...b,
      commits: b.commits.map((c) =>
        String(c.commit_id) === String(commitId) ? { ...c, tags: next(c.tags || []) } : c,
      ),
    })),
  };
}

/** Every tag on `commits`, in first-seen order. */
function collectBranchTags(commits: Commit[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of commits) {
    for (const t of c.tags || []) {
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

interface VersionTagsOptions {
  passedProject: string | undefined;
  projectLog: ProjectLog | null;
  setProjectLog: Dispatch<SetStateAction<ProjectLog | null>>;
  selectedBranch: string;
}

/** Version tags: colours, suggestions, the per-branch filter and optimistic edits. */
export function useVersionTags({ passedProject, projectLog, setProjectLog, selectedBranch }: VersionTagsOptions) {
  const [tagColors, setTagColors] = useState<Record<string, string>>({});
  // Tags used anywhere in the library, so versions can reuse project tags.
  const [libraryTags, setLibraryTags] = useState<string[]>([]);
  const [versionTagPopover, setVersionTagPopover] = useState<VersionTagPopoverState | null>(null);
  // Filter on the version cards; OR semantics (a version matches any active tag).
  const [activeVersionTags, setActiveVersionTags] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      window.ipcRenderer.invoke("load-tag-colors").catch(() => ({})),
      window.ipcRenderer.invoke("get-all-projects").catch(() => null),
    ]).then(([colors, all]) => {
      setTagColors(colors || {});
      const gathered = new Set<string>();
      for (const p of all?.projects || []) for (const t of p.tags || []) gathered.add(t);
      setLibraryTags(Array.from(gathered));
    });
  }, []);

  // Filters are per-branch — start clean when switching alternatives.
  useEffect(() => {
    setActiveVersionTags(new Set());
  }, [selectedBranch]);

  const branchCommits = useMemo(
    () => projectLog?.branches.find((b) => b.name === selectedBranch)?.commits || [],
    [projectLog, selectedBranch],
  );

  const branchVersionTags = useMemo(() => collectBranchTags(branchCommits), [branchCommits]);

  // Ignore active filters whose tag no longer exists on this branch (e.g. just removed).
  const effectiveVersionFilter = useMemo(
    () => branchVersionTags.filter((t) => activeVersionTags.has(t)),
    [branchVersionTags, activeVersionTags],
  );

  const visibleCommits = useMemo(() => {
    if (effectiveVersionFilter.length === 0) return branchCommits;
    return branchCommits.filter((c) => (c.tags || []).some((t) => effectiveVersionFilter.includes(t)));
  }, [branchCommits, effectiveVersionFilter]);

  const versionTagSuggestions = useMemo(() => {
    const known = new Set<string>(libraryTags);
    for (const b of projectLog?.branches || []) {
      for (const c of b.commits) for (const t of c.tags || []) known.add(t);
    }
    for (const t of Object.keys(tagColors)) known.add(t);
    return buildTagSuggestions(Array.from(known), tagColors);
  }, [libraryTags, projectLog, tagColors]);

  const findCommitTags = (commitId: string): string[] => {
    for (const b of projectLog?.branches || []) {
      const c = b.commits.find((c) => String(c.commit_id) === String(commitId));
      if (c) return c.tags || [];
    }
    return [];
  };

  /** Optimistically replace a version's tags, reverting if the write fails. */
  const updateCommitTags = (commitId: string, tags: string[]) => {
    const apply = (next: (prevTags: string[]) => string[]) =>
      setProjectLog((prev) => (prev ? withCommitTags(prev, commitId, next) : prev));

    const previous = findCommitTags(commitId);
    apply(() => tags);

    window.ipcRenderer
      .invoke("set-commit-tags", passedProject, commitId, tags)
      .catch((err: unknown) => {
        console.error("[History] Failed to save version tags:", err);
        apply(() => previous);
      });
  };

  const handleAddVersionTag = (commitId: string, tag: string, color: string) => {
    const current = findCommitTags(commitId);
    if (current.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
    if (color && color !== "#007bff" && !tagColors[tag]) {
      setTagColors((prev) => ({ ...prev, [tag]: color }));
      window.ipcRenderer.invoke("save-tag-color", tag, color).catch(() => {});
    }
    updateCommitTags(commitId, [...current, tag]);
  };

  const handleRemoveVersionTag = (commitId: string, tag: string) => {
    updateCommitTags(commitId, findCommitTags(commitId).filter((t) => t !== tag));
  };

  const toggleVersionTagFilter = (tag: string) =>
    setActiveVersionTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  return {
    tagColors,
    versionTagPopover,
    setVersionTagPopover,
    activeVersionTags,
    toggleVersionTagFilter,
    branchCommits,
    branchVersionTags,
    effectiveVersionFilter,
    visibleCommits,
    versionTagSuggestions,
    findCommitTags,
    handleAddVersionTag,
    handleRemoveVersionTag,
  };
}
