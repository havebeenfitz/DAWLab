import type { InviteInfo, SharedFolder, SpaceDetails, SpaceMember } from '../hub';

export const owner: SpaceMember = { id: 'm1', name: 'Ann', role: 'owner', joinedAt: '2026-01-01T00:00:00Z' };
export const bob: SpaceMember = { id: 'm2', name: 'Bob', role: 'edit', joinedAt: '2026-01-02T00:00:00Z' };
export const cleo: SpaceMember = { id: 'm3', name: 'cleo', role: 'listen', joinedAt: '2026-01-03T00:00:00Z' };

export function sharedFolder(overrides: Partial<SharedFolder> = {}): SharedFolder {
  return {
    folderId: 'f1',
    hubUrl: 'https://hub.test',
    spaceId: 's1',
    memberId: 'm1',
    role: 'owner',
    name: 'Album',
    localRoot: '/Users/me/Music/Album',
    projectCount: 2,
    members: [owner, bob, cleo],
    lastSync: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...overrides,
  };
}

export function spaceDetails(local: SharedFolder, overrides: Partial<SpaceDetails> = {}): SpaceDetails {
  const me = local.members.find((m) => m.id === local.memberId) ?? owner;
  return {
    space: { id: local.spaceId, name: local.name, createdAt: '2026-01-01T00:00:00Z' },
    me: { id: me.id, name: me.name, role: local.role },
    members: local.members,
    projects: [],
    local,
    ...overrides,
  };
}

export const invite: InviteInfo = { id: 'inv1', role: 'edit', expiresAt: '2026-12-31T00:00:00Z', maxUses: 5, uses: 1 };
