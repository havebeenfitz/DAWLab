/** What a dawlab:// link asks the app to do. Kept free of Electron so it can be tested. */
export type DeepLink =
  | { kind: 'join'; url: string }
  | { kind: 'open-project'; projectName: string; projectId: string; commitId: string | null }
  | null

export function parseDeepLink(url: string): DeepLink {
  const text = String(url || '').trim()
  // Invite to a shared folder: dawlab://join?hub=...&code=DAWL-...
  if (/^dawlab:\/\/join(?:[/?]|$)/i.test(text)) return { kind: 'join', url: text }

  // Open a project: dawlab://open/project?name=…&id=…&commit=…
  if (/^dawlab:\/\/open\/project\b/i.test(text)) {
    const query = text.indexOf('?')
    if (query === -1) return null
    const params = new URLSearchParams(text.slice(query + 1))
    const projectName = params.get('name')
    const projectId = params.get('id')
    if (!projectName || !projectId) return null
    return { kind: 'open-project', projectName, projectId, commitId: params.get('commit') }
  }
  return null
}
