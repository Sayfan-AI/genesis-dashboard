import { parseRepoParam } from './repo'

export function App({ search = window.location.search }: { search?: string }) {
  const repo = parseRepoParam(search)
  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">Genesis Dashboard</h1>
      {repo ? (
        <p className="mt-2 text-slate-600">
          Repository: <span className="font-mono">{`${repo.owner}/${repo.name}`}</span>
        </p>
      ) : (
        <p className="mt-2 text-slate-600">
          Add <span className="font-mono">?repo=owner/name</span> to the URL to load a dev system.
        </p>
      )}
    </main>
  )
}
