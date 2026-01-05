import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true
})
  .disable(['image'])
  .use(taskLists, { enabled: true })

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens: any[], idx: number, options: any, _env: any, self: any) => self.renderToken(tokens, idx, options))

md.renderer.rules.link_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
  const token = tokens[idx]
  if (token) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
  }
  return defaultLinkOpen(tokens, idx, options, env, self)
}

export const renderMarkdownToHtml = (input: string) => {
  const safe = typeof input === 'string' ? input : ''
  if (!safe.trim()) return ''
  return md.render(safe)
}
