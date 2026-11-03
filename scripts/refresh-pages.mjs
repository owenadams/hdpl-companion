import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'cheerio'

const rootUrl = 'http://hdpl.x10host.com/index.php'
const allowedHost = new URL(rootUrl).host
const maxPages = 120
const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/hdpl-pages.json')

function shouldCrawl(url) {
  const path = url.pathname.toLowerCase()
  if (path.includes('_files/') || path.includes('/summer%202011/')) return false
  if (/\.(css|js|xml|thmx|mso|png|jpg|jpeg|gif|svg|webp|ico|pdf|zip)$/i.test(path)) return false
  return /\.(php|htm|html)$/i.test(path) || !/\.[a-z0-9]+$/i.test(path)
}

function getLinks(html, pageUrl) {
  const $ = load(html)
  return $('a[href]').map((_, anchor) => {
    try {
      const url = new URL($(anchor).attr('href'), pageUrl)
      url.hash = ''
      if (url.host !== allowedHost || !['http:', 'https:'].includes(url.protocol) || !shouldCrawl(url)) return null
      return url.href
    } catch {
      return null
    }
  }).get()
}

const queue = [new URL(rootUrl).href]
const seen = new Set()
const pages = []
const failedPages = []

while (queue.length && seen.size < maxPages) {
  const current = queue.shift()
  if (seen.has(current)) continue
  seen.add(current)

  try {
    const response = await fetch(current, { signal: AbortSignal.timeout(30000) })
    const html = await response.text()
    const $ = load(html)
    const title = $('title').first().text().trim()
    $('script, style, noscript').remove()
    const bodyText = $('body').text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()

    pages.push({ url: current, status: response.status, title, bodyText, html })
    for (const link of getLinks(html, current)) {
      if (!seen.has(link)) queue.push(link)
    }
    console.log(`Captured ${current} (${response.status})`)
  } catch (error) {
    failedPages.push({ url: current, message: error instanceof Error ? error.message : String(error) })
    console.warn(`Failed ${current}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (!pages.length) throw new Error(`No HDPL pages were captured from ${rootUrl}`)

const snapshot = {
  sourceRootUrl: rootUrl,
  updatedAtUtc: new Date().toISOString(),
  pages,
  failedPages,
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
console.log(`Wrote ${pages.length} pages and ${failedPages.length} failures to ${outputPath}`)