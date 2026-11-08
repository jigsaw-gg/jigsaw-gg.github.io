const PUZZLES = [
  { name: 'Harbor fog', pieces: 500 },
  { name: 'Night market', pieces: 1000 },
  { name: 'Glasshouse', pieces: 750 },
]

export function PuzzlesPage() {
  return (
    <main className="page">
      <h1>Puzzles</h1>
      <p className="lede">
        Dummy catalog so the navigation has somewhere to go. Nothing here opens
        a puzzle yet.
      </p>
      <div className="card-grid">
        {PUZZLES.map((puzzle) => (
          <article key={puzzle.name} className="card">
            <h2>{puzzle.name}</h2>
            <p>{puzzle.pieces} pieces</p>
          </article>
        ))}
      </div>
    </main>
  )
}
