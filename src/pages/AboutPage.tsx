import { useI18n } from '../i18n/useI18n.ts'

export function AboutPage() {
  const { messages } = useI18n()
  return (
    <main className="page">
      <h1>{messages.about.title}</h1>
      <p className="lede">{messages.about.lede}</p>
    </main>
  )
}
