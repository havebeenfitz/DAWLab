import { TagChip } from '@/components/ui/TagChip';

interface Props {
  tags: string[];
  tagColors: Record<string, string>;
  activeTags: Set<string>;
  onToggle: (tag: string) => void;
  /** Number of active filters that still exist on the branch. */
  effectiveFilterCount: number;
  visibleCount: number;
  totalCount: number;
}

/** Tag chips above the version graph; clicking one filters the versions. */
export function VersionTagFilter(p: Props) {
  if (p.tags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 mb-2">
      {p.tags.map((tag) => (
        <TagChip
          key={tag}
          tag={tag}
          color={p.tagColors[tag]}
          active={p.activeTags.has(tag)}
          onClick={() => p.onToggle(tag)}
        />
      ))}
      {p.effectiveFilterCount > 0 && (
        <span className="text-xs text-gray-500">
          {p.visibleCount} of {p.totalCount} versions
        </span>
      )}
    </div>
  );
}
