import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarPlus,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  CircleAlert,
  Clock3,
  Download,
  MapPin,
  Medal,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  TableProperties,
  Trophy,
  UsersRound,
  X,
} from 'lucide-react'
import './App.css'

type SourcePage = {
  url: string
  title: string
  status: number
  bodyText: string
  html: string
}

type Snapshot = {
  sourceRootUrl: string
  updatedAtUtc: string
  pages: SourcePage[]
  failedPages?: { url: string; message: string }[]
}

type Fixture = {
  division: number
  home: string
  away: string
  date: Date
}

type MatchResult = {
  division: number
  date: Date
  home: string
  away: string
  homeScore: number
  awayScore: number
}

type Standing = {
  rank: number
  team: string
  played: number
  won: number
  drawn: number
  lost: number
  points: number
}

type Player = {
  division: number
  rank: number
  name: string
  team: string
  played: number
  won: number
  lost: number
  winRate: number
}

type TeamContact = {
  team: string
  phone: string
  person: string
  address: string
}

type LeagueData = {
  snapshot: Snapshot
  fixtures: Fixture[]
  results: MatchResult[]
  teamDivisions: Record<string, number>
  moneyTables: Record<number, Standing[]>
  trophyTables: Record<number, Standing[]>
  moneyPlayers: Player[]
  trophyPlayers: Player[]
  contacts: TeamContact[]
  moneyLabel: string
  trophyLabel: string
}

type View = 'home' | 'fixtures' | 'tables' | 'players' | 'contacts' | 'rules'
type Competition = 'money' | 'trophy'
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const sourceRoot = 'http://hdpl.x10host.com'
const gemUrl = import.meta.env.VITE_GEM_URL || 'https://gemini.google.com/gem/1w8F6GkLE9mm3It8JRAn6XVQICKzhMi1N?usp=sharing'
const gemLinkLabel = 'Ask your Gemini Gem'
const divisionPages = [1, 2, 3]
const divisionSchedulePath = (division: number) => `fixtures${division}.htm`
const moneyTablePath = (division: number) => `hdpl_tables_division_${division}.htm`
const trophyTablePath = (division: number) => `t_hdpl_tables_division_${division}.htm`

function clean(value: string | null | undefined) {
  return (value || '').replace(/\s+/g, ' ').trim()
}

function teamKey(value: string) {
  return clean(value).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '')
}

function parsePage(page: SourcePage) {
  return new DOMParser().parseFromString(page.html, 'text/html')
}

function getRows(page: SourcePage | undefined) {
  if (!page) return []
  const table = parsePage(page).querySelector('table')
  return Array.from(table?.rows || []).map((row) =>
    Array.from(row.cells).map((cell) => clean(cell.textContent)),
  )
}

function parseDate(value: string) {
  const match = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/)
  if (!match) return null
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3])
  return new Date(year, Number(match[2]) - 1, Number(match[1]), 12)
}

function findPage(pages: SourcePage[], path: string) {
  return pages.find((page) => new URL(page.url).pathname.endsWith(path))
}

function parseFixtures(pages: SourcePage[]) {
  const fixtures: Fixture[] = []
  for (const division of divisionPages) {
    const page = findPage(pages, divisionSchedulePath(division))
    if (!page) continue
    let groupOffsets = [1, 5, 9]
    let dates: (Date | null)[] = [null, null, null]
    for (const cells of getRows(page)) {
      const weekOffsets = cells.flatMap((cell, index) => /^Week\s+\d+$/i.test(cell) ? [index] : [])
      if (weekOffsets.length) {
        groupOffsets = weekOffsets
        dates = groupOffsets.map((offset) => parseDate(cells[offset + 2] || ''))
        continue
      }
      for (const [index, offset] of groupOffsets.entries()) {
        const home = cells[offset]
        const away = cells[offset + 2]
        if (dates[index] && home && cells[offset + 1]?.toUpperCase() === 'V' && away) {
          fixtures.push({ division, home, away, date: dates[index] as Date })
        }
      }
    }
  }
  return fixtures.sort((left, right) => left.date.getTime() - right.date.getTime())
}

function parseResults(pages: SourcePage[], fixtures: Fixture[], capturedAt: string) {
  const results: MatchResult[] = []
  const captureTime = new Date(capturedAt).getTime()

  for (const cells of getRows(findPage(pages, 'results.htm'))) {
    const score = cells[4]?.match(/^(\d+)\s+(\d+)$/)
    if (!cells[1] || cells[2]?.toUpperCase() !== 'V' || !cells[3] || !score) continue

    const fixture = fixtures.filter((candidate) =>
      teamKey(candidate.home) === teamKey(cells[1]) &&
      teamKey(candidate.away) === teamKey(cells[3]) &&
      candidate.date.getTime() <= captureTime,
    ).sort((left, right) => right.date.getTime() - left.date.getTime())[0]
    if (!fixture) continue

    results.push({
      division: fixture.division,
      date: fixture.date,
      home: cells[1],
      away: cells[3],
      homeScore: Number(score[1]),
      awayScore: Number(score[2]),
    })
  }

  return results.sort((left, right) => right.date.getTime() - left.date.getTime())
}

function parseStandings(page: SourcePage | undefined) {
  const standings: Standing[] = []
  for (const cells of getRows(page)) {
    const rank = Number(cells[0])
    const played = Number(cells[2])
    if (
      Number.isInteger(rank) && rank > 0 && cells[1] &&
      Number.isInteger(played) && played >= 0 && Number.isFinite(Number(cells[3]))
    ) {
      standings.push({
        rank,
        team: cells[1],
        played,
        won: Number(cells[3]),
        drawn: Number(cells[4]),
        lost: Number(cells[5]),
        points: Number(cells[9]),
      })
    }
  }
  return standings.slice(0, 10)
}

function parsePlayers(page: SourcePage | undefined, division: number) {
  const players: Player[] = []
  for (const cells of getRows(page)) {
    const rank = Number(cells[0])
    const played = Number(cells[3])
    if (
      Number.isInteger(rank) && rank > 0 && cells[1] && cells[2] &&
      Number.isInteger(played) && played >= 0 && Number.isFinite(Number(cells[4]))
    ) {
      players.push({
        division,
        rank,
        name: cells[1],
        team: cells[2],
        played,
        won: Number(cells[4]),
        lost: Number(cells[5]),
        winRate: Number(cells[6]),
      })
    }
  }
  return players
}

function parseContacts(page: SourcePage | undefined) {
  const contacts: TeamContact[] = []
  for (const cells of getRows(page)) {
    if (!/^\d+$/.test(cells[0] || '') || !cells[1]) continue
    const phone = cells.find((cell) => /\b0\d{4}\s?\d{6}\b/.test(cell)) || ''
    const address = cells.find((cell) => /\b(?:RM|IG)\d{1,2}\s?\d[A-Z]{2}\b/i.test(cell)) || ''
    const addressIndex = cells.indexOf(address)
    const person = cells.slice(2, addressIndex < 0 ? undefined : addressIndex)
      .find((cell) => cell && !/\b0\d{4}\s?\d{6}\b/.test(cell)) || ''
    contacts.push({ team: cells[1], phone, person, address })
  }
  return contacts
}

function findContact(contacts: TeamContact[], team: string) {
  return contacts.find((contact) => teamKey(contact.team) === teamKey(team))
}

function escapeCalendar(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

function addFixtureToCalendar(fixture: Fixture, location = '') {
  const date = fixture.date.toISOString().slice(0, 10).replace(/-/g, '')
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const event = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HDPL//League Companion//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${date}-${teamKey(fixture.home)}-${teamKey(fixture.away)}@hdpl`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${date}`,
    `SUMMARY:HDPL Div ${fixture.division}: ${escapeCalendar(fixture.home)} vs ${escapeCalendar(fixture.away)}`,
    `DESCRIPTION:${escapeCalendar(`Money League fixture, Division ${fixture.division}`)}`,
    ...(location ? [`LOCATION:${escapeCalendar(location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n') + '\r\n'
  const url = URL.createObjectURL(new Blob([event], { type: 'text/calendar;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `hdpl-${date}-${teamKey(fixture.home)}-vs-${teamKey(fixture.away)}.ics`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function discoverLabel(pages: SourcePage[], marker: string, fallback: string) {
  const home = findPage(pages, 'index.php') || findPage(pages, 'hdpl.htm')
  const content = clean(home ? parsePage(home).body.textContent : '')
  const match = content.match(new RegExp(`${marker}\\s*(\\d{2,4}(?:\\s*[-–]\\s*\\d{2,4})?)`, 'i'))
  if (!match) return fallback
  const season = match[1].replace(/\s+/g, '')
  return `${marker} ${/^\d{2}$/.test(season) ? `20${season}` : season}`
}

function deriveData(snapshot: Snapshot): LeagueData {
  const pages = snapshot.pages
  const fixtures = parseFixtures(pages)
  const teamDivisions: Record<string, number> = {}
  for (const fixture of fixtures) {
    for (const team of [fixture.home, fixture.away]) {
      teamDivisions[teamKey(team)] ??= fixture.division
    }
  }
  return {
    snapshot,
    fixtures,
    results: parseResults(pages, fixtures, snapshot.updatedAtUtc),
    teamDivisions,
    moneyTables: Object.fromEntries(divisionPages.map((division) => [
      division,
      parseStandings(findPage(pages, moneyTablePath(division))),
    ])),
    trophyTables: Object.fromEntries(divisionPages.map((division) => [
      division,
      parseStandings(findPage(pages, trophyTablePath(division))),
    ])),
    moneyPlayers: divisionPages.flatMap((division) =>
      parsePlayers(findPage(pages, `player_stats${division}.htm`), division),
    ),
    trophyPlayers: divisionPages.flatMap((division) =>
      parsePlayers(findPage(pages, `tplayer_stats${division}.htm`), division),
    ),
    contacts: parseContacts(findPage(pages, 'contacts.htm')),
    moneyLabel: discoverLabel(pages, 'Money League', 'Money League'),
    trophyLabel: discoverLabel(pages, 'Trophy League', 'Trophy League archive'),
  }
}

function startOfToday() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

function formatDate(date: Date, options: Intl.DateTimeFormatOptions = {}) {
  return date.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', ...options,
  })
}

function App() {
  const [data, setData] = useState<LeagueData | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [view, setView] = useState<View>('home')
  const [viewHistory, setViewHistory] = useState<View[]>([])
  const [division, setDivision] = useState(1)
  const [competition, setCompetition] = useState<Competition>('money')
  const [favoriteTeam, setFavoriteTeam] = useState(() => localStorage.getItem('hdpl-team') || '')
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null)
  const [showInstallHelp, setShowInstallHelp] = useState(false)
  const [isInstalled, setIsInstalled] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
  )
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/hdpl-pages.json`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('League data is not available yet')
        return response.json() as Promise<Snapshot>
      })
      .then((snapshot) => setData(deriveData(snapshot)))
      .catch(() => setLoadError(true))
  }, [])

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const handleInstalled = () => {
      setInstallPrompt(null)
      setIsInstalled(true)
    }
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const upcoming = data?.fixtures.filter((fixture) => fixture.date >= startOfToday()) || []
  const teamOptions = Array.from(new Set(data?.fixtures.flatMap(({ home, away }) => [home, away]) || []))
    .sort((left, right) => left.localeCompare(right))
  const activeDivision = (favoriteTeam && data?.teamDivisions?.[teamKey(favoriteTeam)]) || division
  const selectedFixtures = favoriteTeam
    ? upcoming.filter((fixture) => fixture.division === activeDivision && [fixture.home, fixture.away].some((team) => teamKey(team) === teamKey(favoriteTeam)))
    : upcoming.filter((fixture) => fixture.division === activeDivision)
  const nextFixture = competition === 'money' ? selectedFixtures[0] : undefined
  const nextRound = competition !== 'money' ? [] : favoriteTeam
    ? selectedFixtures.slice(0, 6)
    : nextFixture
      ? upcoming.filter((fixture) => fixture.division === activeDivision && fixture.date.getTime() === nextFixture.date.getTime()).slice(0, 6)
      : selectedFixtures.slice(0, 6)
  const recentTeamResults = favoriteTeam && competition === 'money'
    ? (data?.results || []).filter((result) =>
      result.division === activeDivision && [result.home, result.away].some((team) => teamKey(team) === teamKey(favoriteTeam)),
    ).slice(0, 5)
    : []
  const resultRecord = recentTeamResults.reduce((record, result) => {
    const isHome = teamKey(result.home) === teamKey(favoriteTeam)
    const ownScore = isHome ? result.homeScore : result.awayScore
    const otherScore = isHome ? result.awayScore : result.homeScore
    if (ownScore > otherScore) record.won += 1
    else if (ownScore < otherScore) record.lost += 1
    else record.drawn += 1
    return record
  }, { won: 0, lost: 0, drawn: 0 })
  const nextVenue = nextFixture && data ? findContact(data.contacts, nextFixture.home) : undefined
  const currentTables = competition === 'money' ? data?.moneyTables : data?.trophyTables
  const currentStandings = currentTables?.[activeDivision] || []
  const currentLeader = currentStandings[0]
  const selectedPlayers = competition === 'money' ? data?.moneyPlayers : data?.trophyPlayers
  const filteredPlayers = (selectedPlayers || []).filter((player) =>
    player.division === activeDivision && `${player.name} ${player.team}`.toLowerCase().includes(search.toLowerCase()),
  ).slice(0, 40)
  const filteredContacts = (data?.contacts || []).filter((contact) =>
    `${contact.team} ${contact.person} ${contact.address}`.toLowerCase().includes(search.toLowerCase()),
  )

  function chooseTeam(team: string) {
    setFavoriteTeam(team)
    const teamDivision = team ? data?.teamDivisions?.[teamKey(team)] : undefined
    if (teamDivision) {
      setDivision(teamDivision)
    }
    if (team) localStorage.setItem('hdpl-team', team)
    else localStorage.removeItem('hdpl-team')
  }

  function chooseDivision(nextDivision: number) {
    setDivision(nextDivision)
    if (favoriteTeam && data?.teamDivisions?.[teamKey(favoriteTeam)] !== nextDivision) {
      chooseTeam('')
    }
  }

  function openView(nextView: View) {
    if (nextView !== view) {
      setViewHistory((history) => [...history, view])
    }
    setView(nextView)
    setSearch('')
  }

  function goBack() {
    const previousView = viewHistory.at(-1)
    if (!previousView) return
    setViewHistory((history) => history.slice(0, -1))
    setView(previousView)
    setSearch('')
  }

  const updatedLabel = data
    ? new Date(data.snapshot.updatedAtUtc).toLocaleString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    })
    : ''
  const failedSources = [
    ...(data?.snapshot.failedPages || []).map((failed) => failed.url),
    ...(data?.snapshot.pages || []).filter((page) => page.status < 200 || page.status >= 300).map((page) => page.url),
  ]
  const sourcePageCount = data?.snapshot.pages.length || 0

  async function installApp() {
    if (!installPrompt) {
      setShowInstallHelp(true)
      return
    }
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setIsInstalled(true)
    setInstallPrompt(null)
  }

  const navItems: { id: View; label: string; icon: typeof CalendarDays }[] = [
    { id: 'home', label: 'Overview', icon: Trophy },
    { id: 'fixtures', label: 'Fixtures', icon: CalendarDays },
    { id: 'tables', label: 'Tables', icon: TableProperties },
    { id: 'players', label: 'Player stats', icon: Medal },
    { id: 'contacts', label: 'Teams & venues', icon: UsersRound },
    { id: 'rules', label: 'Rules', icon: CircleHelp },
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => openView('home')}>
          <span className="brand-mark"><Trophy size={21} strokeWidth={2.2} /></span>
          <span><strong>HDPL</strong><small>League companion</small></span>
        </a>

        <div className="side-label">League desk</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? 'nav-item active' : 'nav-item'} onClick={() => openView(id)}>
              <Icon size={18} strokeWidth={1.9} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <a className="gem-link" href={gemUrl} target="_blank" rel="noreferrer">
            <span className="gem-icon"><CircleHelp size={17} /></span>
            <span><strong>{gemLinkLabel}</strong><small>Opens in a new tab</small></span>
            <ArrowUpRight size={16} />
          </a>
          <div className="data-status">
            <span className={failedSources.length ? 'status-dot warning' : 'status-dot'} />
            <span>{!data ? 'Loading sources' : failedSources.length ? 'Partial source data' : `${sourcePageCount} data sources synced`}</span>
          </div>
          {updatedLabel && <small className="updated-label">Correct as of {updatedLabel}</small>}
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-leading">
            {viewHistory.length > 0 && <button className="back-button" onClick={goBack} aria-label="Back to previous screen" title="Back to previous screen"><ArrowLeft size={16} /><span>Back</span></button>}
            <div className="breadcrumb"><span>Havering & District</span><span className="crumb-slash">/</span><strong>{navItems.find((item) => item.id === view)?.label}</strong></div>
          </div>
          <label className="team-picker">
            <span className="picker-label">My team</span>
            <select value={favoriteTeam} onChange={(event) => chooseTeam(event.target.value)} aria-label="Select your team">
              <option value="">All teams</option>
              {teamOptions.map((team) => <option key={team} value={team}>{team}</option>)}
            </select>
            <ChevronDown size={15} />
          </label>
          {!isInstalled && <button className="install-button" onClick={installApp} title="Install the HDPL companion"><Download size={15} /><span>Install</span></button>}
        </header>

        <div className={failedSources.length ? 'mobile-source-status warning' : 'mobile-source-status'} role="status" aria-label="Data freshness">
          <span className={failedSources.length ? 'status-dot warning' : 'status-dot'} />
          <strong>{!data ? 'Loading sources' : failedSources.length ? 'Partial source data' : `${sourcePageCount} data sources synced`}</strong>
          {updatedLabel && <span className="mobile-checked">Correct as of {updatedLabel}</span>}
        </div>
        <nav className="mobile-utility-links" aria-label="More league links">
          <a href={gemUrl} target="_blank" rel="noreferrer"><Sparkles size={15} /><span>Ask your Gemini Gem</span><ArrowUpRight size={14} /></a>
          <button onClick={() => openView('rules')}><CircleHelp size={15} /><span>Rules</span></button>
        </nav>

        <div className="page-content">
          {!isOnline && <div className="offline-banner" role="status">Offline mode · showing the latest saved league data.</div>}
          {loadError && (
            <div className="load-error" role="alert">
              League data isn’t available yet. Run the HDPL weekly sync to generate the first snapshot.
            </div>
          )}
          {data && failedSources.length > 0 && (
            <div className="source-warning" role="status">
              <CircleAlert size={18} />
              <div>
                <strong>{failedSources.length} source {failedSources.length === 1 ? 'page needs' : 'pages need'} attention</strong>
                <details>
                  <summary>View affected pages</summary>
                  <ul>{failedSources.map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{new URL(url).pathname.split('/').pop()}</a></li>)}</ul>
                </details>
              </div>
            </div>
          )}

          {view === 'home' && (
            <>
              <section className="page-heading">
                <div>
                  <p className="eyebrow"><span className="live-dot" /> CURRENT SEASON</p>
                  <h1>League week<span className="heading-period">.</span></h1>
                  <p className="heading-note">Fixtures, form and standings in one place.</p>
                </div>
                <div className="season-switch" aria-label="Choose league competition">
                  <button className={competition === 'money' ? 'selected' : ''} onClick={() => setCompetition('money')}>
                    {data?.moneyLabel || 'Money League'}<span className="season-current">Current</span>
                  </button>
                  <button className={competition === 'trophy' ? 'selected' : ''} onClick={() => setCompetition('trophy')}>
                    {data?.trophyLabel || 'Trophy League'}<span className="season-archive">Archive</span>
                  </button>
                </div>
              </section>

              <section className="dashboard-grid">
                <div className="primary-column">
                  <article className="next-match panel-dark">
                    <div className="match-topline">
                      <span className="match-kicker"><CalendarDays size={15} /> NEXT FIXTURE</span>
                      {nextFixture && <span className="division-tag">DIVISION {nextFixture.division}</span>}
                    </div>
                    {nextFixture ? (
                      <>
                        <div className="match-date">{formatDate(nextFixture.date, { year: 'numeric' })}</div>
                        <div className="matchup">
                          <div className="match-team">{nextFixture.home}</div>
                          <span className="versus">v</span>
                          <div className="match-team">{nextFixture.away}</div>
                        </div>
                        <div className="match-footer">
                          <span><Clock3 size={15} /> Match night</span>
                          <div className="match-actions">
                            {nextVenue?.address && <a className="match-tool light" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nextVenue.address)}`} target="_blank" rel="noreferrer" aria-label="Map the fixture venue" title="Map the fixture venue"><MapPin size={16} /></a>}
                            <button className="match-tool light" onClick={() => addFixtureToCalendar(nextFixture, nextVenue?.address)} aria-label="Add next fixture to calendar" title="Add next fixture to calendar"><CalendarPlus size={16} /></button>
                            <button className="text-action light" onClick={() => openView('fixtures')}>All fixtures <ArrowUpRight size={15} /></button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="empty-match">
                        <h2>{competition === 'trophy' ? `${data?.trophyLabel || 'Trophy League'} is archived` : favoriteTeam ? `No upcoming fixture found for ${favoriteTeam}` : 'No upcoming fixtures found'}</h2>
                        <p>{competition === 'trophy' ? 'Future fixtures are listed under the current Money League season.' : 'Check the schedule source for the latest dates.'}</p>
                        <a href={`${sourceRoot}/${competition === 'money' ? divisionSchedulePath(1) : trophyTablePath(division)}`} target="_blank" rel="noreferrer">{competition === 'money' ? 'Open fixtures source' : 'Open archived table'} <ArrowUpRight size={14} /></a>
                      </div>
                    )}
                  </article>

                  {favoriteTeam && competition === 'money' && (
                    <section className="recent-form">
                      <div className="section-heading">
                        <div><p className="eyebrow">RECENT RESULTS</p><h2>{favoriteTeam}</h2></div>
                        <span className="form-record">{resultRecord.won}W · {resultRecord.drawn}D · {resultRecord.lost}L</span>
                      </div>
                      <div className="recent-results">
                        {recentTeamResults.map((result) => {
                          const isHome = teamKey(result.home) === teamKey(favoriteTeam)
                          const opponent = isHome ? result.away : result.home
                          const ownScore = isHome ? result.homeScore : result.awayScore
                          const opponentScore = isHome ? result.awayScore : result.homeScore
                          const outcome = ownScore > opponentScore ? 'W' : ownScore < opponentScore ? 'L' : 'D'
                          return (
                            <div className="form-result" key={`${result.date.toISOString()}-${result.home}-${result.away}`}>
                              <span className={`form-result-badge ${outcome.toLowerCase()}`}>{outcome}</span>
                              <span className="form-opponent">{opponent}</span>
                              <strong className="form-score">{ownScore}-{opponentScore}</strong>
                              <time>{formatDate(result.date, { year: undefined })}</time>
                            </div>
                          )
                        })}
                        {!recentTeamResults.length && <p className="empty-note">No completed results are recorded yet.</p>}
                      </div>
                    </section>
                  )}

                  <section className="section-block">
                    <div className="section-heading">
                      <div><p className="eyebrow">THE TABLE</p><h2>Division {activeDivision}</h2></div>
                      <button className="text-action" onClick={() => openView('tables')}>Full standings <ArrowUpRight size={15} /></button>
                    </div>
                    <div className="table-preview">
                      <div className="table-head"><span>POS</span><span>TEAM</span><span>P</span><span>W</span><span>PTS</span></div>
                      {currentStandings.slice(0, 4).map((row) => (
                        <div className={favoriteTeam && teamKey(row.team) === teamKey(favoriteTeam) ? 'table-row my-team' : 'table-row'} key={row.team}>
                          <span className="rank">{String(row.rank).padStart(2, '0')}</span><strong>{row.team}</strong><span>{row.played}</span><span>{row.won}</span><b>{row.points}</b>
                        </div>
                      ))}
                      {!currentStandings.length && <div className="empty-row">Standings unavailable in the latest snapshot.</div>}
                    </div>
                    {currentLeader && <div className="table-foot"><ShieldCheck size={15} /> {currentLeader.team} lead Division {activeDivision}</div>}
                  </section>
                </div>

                <aside className="secondary-column">
                  <section className="section-block week-block">
                    <div className="section-heading">
                      <div><p className="eyebrow">UP NEXT</p><h2>{favoriteTeam ? 'Your fixtures' : 'League fixtures'}</h2></div>
                      <span className="round-count">{competition === 'money' ? `${selectedFixtures.length} upcoming · Div ${activeDivision}` : 'Archive'}</span>
                    </div>
                    <div className="fixture-list">
                      {nextRound.map((fixture, index) => (
                        <div className="fixture-item" key={`${fixture.division}-${fixture.date.toISOString()}-${fixture.home}`}>
                          <div className="fixture-date"><span>{String(fixture.date.getDate()).padStart(2, '0')}</span><small>{fixture.date.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()}</small></div>
                          <div className="fixture-info"><strong>{fixture.home}</strong><span>vs {fixture.away}</span></div>
                          <span className="fixture-division">D{fixture.division}</span>
                          {index === 0 && <span className="fixture-marker" />}
                        </div>
                      ))}
                      {!nextRound.length && <p className="empty-note">{competition === 'money' ? 'No future dates are listed in the latest source.' : `${data?.trophyLabel || 'Trophy League'} has no upcoming fixtures.`}</p>}
                    </div>
                    <button className="list-action" onClick={() => openView('fixtures')}>Browse full schedule <ArrowUpRight size={15} /></button>
                  </section>

                  <section className="quick-links">
                    <p className="eyebrow">QUICK LOOKUP</p>
                    <button onClick={() => openView('players')}><Medal size={17} /><span>Player stats</span><ArrowUpRight size={14} /></button>
                    <button onClick={() => openView('contacts')}><MapPin size={17} /><span>Contacts & venues</span><ArrowUpRight size={14} /></button>
                    <button onClick={() => openView('rules')}><CircleHelp size={17} /><span>League rules</span><ArrowUpRight size={14} /></button>
                  </section>
                </aside>
              </section>
            </>
          )}

          {view === 'fixtures' && (
            <section className="content-view">
              <div className="page-heading compact"><div><p className="eyebrow">MATCH SCHEDULE</p><h1>Fixtures<span className="heading-period">.</span></h1></div></div>
              <div className="filter-row">
                <div className="division-switch">{divisionPages.map((item) => <button className={activeDivision === item ? 'selected' : ''} key={item} onClick={() => chooseDivision(item)}>Div {item}</button>)}</div>
                {favoriteTeam && <span className="filter-hint">{favoriteTeam} · Division {activeDivision}</span>}
              </div>
              <FixtureSchedule fixtures={data?.fixtures.filter((fixture) => fixture.division === activeDivision) || []} favoriteTeam={favoriteTeam} contacts={data?.contacts || []} />
            </section>
          )}

          {view === 'tables' && (
            <section className="content-view">
              <div className="page-heading compact"><div><p className="eyebrow">LEAGUE POSITIONS</p><h1>Standings<span className="heading-period">.</span></h1></div></div>
              <div className="filter-row">
                <div className="division-switch">{divisionPages.map((item) => <button className={activeDivision === item ? 'selected' : ''} key={item} onClick={() => chooseDivision(item)}>Div {item}</button>)}</div>
                <div className="division-switch competition-switch"><button className={competition === 'money' ? 'selected' : ''} onClick={() => setCompetition('money')}>Money League</button><button className={competition === 'trophy' ? 'selected' : ''} onClick={() => setCompetition('trophy')}>Trophy archive</button></div>
              </div>
              <StandingsTable standings={currentStandings} favoriteTeam={favoriteTeam} />
            </section>
          )}

          {view === 'players' && (
            <section className="content-view">
              <div className="page-heading compact"><div><p className="eyebrow">INDIVIDUAL FORM</p><h1>Player stats<span className="heading-period">.</span></h1></div></div>
              <div className="filter-row">
                <div className="division-switch competition-switch">
                  <button className={competition === 'money' ? 'selected' : ''} onClick={() => setCompetition('money')}>{data?.moneyLabel || 'Money League'}</button>
                  <button className={competition === 'trophy' ? 'selected' : ''} onClick={() => setCompetition('trophy')}>{data?.trophyLabel || 'Trophy League'}</button>
                </div>
                <span className="filter-hint">{competition === 'money' ? 'Current season' : 'Previous season archive'}</span>
              </div>
              <SearchField value={search} onChange={setSearch} placeholder="Search player or team" />
              <div className="players-list">
                <div className="player-list-head"><span>RANK</span><span>PLAYER</span><span>TEAM</span><span>PLAYED</span><span>WON</span><span>WIN %</span></div>
                {filteredPlayers.map((player, index) => (
                  <button className="player-row" key={`${player.name}-${player.team}-${index}`} onClick={() => setSelectedPlayer(player)} aria-label={`View profile for ${player.name}`}>
                    <span className="rank">{String(player.rank).padStart(2, '0')}</span><strong>{player.name}</strong><span>{player.team}</span><span>{player.played}</span><span>{player.won}</span><b>{player.winRate.toFixed(1)}%</b>
                  </button>
                ))}
                {!filteredPlayers.length && <div className="empty-row">No player stats match this search.</div>}
              </div>
            </section>
          )}

          {view === 'contacts' && (
            <section className="content-view">
              <div className="page-heading compact"><div><p className="eyebrow">AT THE TABLE</p><h1>Teams & venues<span className="heading-period">.</span></h1></div></div>
              <div className="filter-row">
                <SearchField value={search} onChange={setSearch} placeholder="Find a team, contact or postcode" />
                {favoriteTeam && <span className="filter-hint">{favoriteTeam} highlighted</span>}
              </div>
              <div className="contacts-grid">
                {filteredContacts.map((contact) => (
                  <article className={favoriteTeam && teamKey(contact.team) === teamKey(favoriteTeam) ? 'contact-row my-team' : 'contact-row'} key={contact.team}>
                    <div className="contact-main"><span className="team-badge">{contact.team.slice(0, 1)}</span><div><h2>{contact.team}</h2><p>{contact.person || 'Team contact'}</p></div></div>
                    <p className="contact-address"><MapPin size={15} />{contact.address || 'Address not listed'}</p>
                    <div className="contact-actions">
                      {contact.phone && <a className="icon-action" href={`tel:${contact.phone.replace(/\s/g, '')}`} aria-label={`Call ${contact.team}`} title={`Call ${contact.team}`}><Phone size={17} /></a>}
                      {contact.address && <a className="icon-action" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contact.address)}`} target="_blank" rel="noreferrer" aria-label={`Map ${contact.team}`} title={`Map ${contact.team}`}><MapPin size={17} /></a>}
                    </div>
                  </article>
                ))}
                {!filteredContacts.length && <div className="empty-row">No teams match this search.</div>}
              </div>
            </section>
          )}

          {view === 'rules' && (
            <section className="content-view rules-view">
              <div className="page-heading compact"><div><p className="eyebrow">REFERENCE</p><h1>Rules & links<span className="heading-period">.</span></h1></div></div>
              <a className="source-link-row" href={`${sourceRoot}/rules.htm`} target="_blank" rel="noreferrer"><span className="source-icon"><CircleHelp size={20} /></span><span><strong>HDPL rules</strong><small>Open the official rules and guidance</small></span><ArrowUpRight size={17} /></a>
              <a className="source-link-row" href={`${sourceRoot}/results.htm`} target="_blank" rel="noreferrer"><span className="source-icon coral"><CalendarDays size={20} /></span><span><strong>Results & scorecards</strong><small>View the source results sheet</small></span><ArrowUpRight size={17} /></a>
              <a className="source-link-row" href={gemUrl} target="_blank" rel="noreferrer"><span className="source-icon gold"><CircleHelp size={20} /></span><span><strong>{gemLinkLabel}</strong><small>League questions grounded in your context pack</small></span><ArrowUpRight size={17} /></a>
              <p className="source-note">League information is read from the HDPL source pages. Correct as of {updatedLabel || 'after the first sync'}.</p>
            </section>
          )}

          <footer className="site-footer">
            <span>Made by <strong>Owen Adams</strong></span>
            <span>Feedback or suggestions? Contact <strong>Owen Adams</strong>.</span>
          </footer>
        </div>

        <footer className="mobile-footer">
          {navItems.slice(0, 5).map(({ id, label, icon: Icon }) => (
            <button key={id} className={view === id ? 'active' : ''} onClick={() => openView(id)} aria-label={label}><Icon size={19} /><span>{label === 'Overview' ? 'Home' : label === 'Player stats' ? 'Players' : label === 'Teams & venues' ? 'Teams' : label}</span></button>
          ))}
        </footer>
      </main>
      {selectedPlayer && (
        <div className="profile-backdrop" onClick={() => setSelectedPlayer(null)}>
          <section className="player-profile" role="dialog" aria-modal="true" aria-labelledby="player-profile-name" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') setSelectedPlayer(null) }} tabIndex={-1}>
            <button className="profile-close" onClick={() => setSelectedPlayer(null)} aria-label="Close player profile" title="Close"><X size={18} /></button>
            <p className="eyebrow">DIVISION {selectedPlayer.division} PLAYER</p>
            <h2 id="player-profile-name">{selectedPlayer.name}</h2>
            <p className="profile-team">{selectedPlayer.team}</p>
            <div className="profile-stats">
              <div><span>Rank</span><strong>#{selectedPlayer.rank}</strong></div>
              <div><span>Played</span><strong>{selectedPlayer.played}</strong></div>
              <div><span>Won</span><strong>{selectedPlayer.won}</strong></div>
              <div><span>Lost</span><strong>{selectedPlayer.lost}</strong></div>
              <div><span>Win rate</span><strong>{selectedPlayer.winRate.toFixed(1)}%</strong></div>
            </div>
            <a className="profile-source" href={`${sourceRoot}/${competition === 'money' ? 'player_stats' : 'tplayer_stats'}${selectedPlayer.division}.htm`} target="_blank" rel="noreferrer">Open division player table <ArrowUpRight size={15} /></a>
          </section>
        </div>
      )}
      {showInstallHelp && (
        <div className="profile-backdrop" onClick={() => setShowInstallHelp(false)}>
          <section className="player-profile install-help" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={(event) => event.stopPropagation()}>
            <button className="profile-close" onClick={() => setShowInstallHelp(false)} aria-label="Close install guide" title="Close"><X size={18} /></button>
            <p className="eyebrow">HDPL ON YOUR DEVICE</p>
            <h2 id="install-title">Install the companion</h2>
            <p className="install-instructions">Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.</p>
          </section>
        </div>
      )}
    </div>
  )
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="search-field"><Search size={17} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /><span>Search</span></label>
}

function FixtureSchedule({ fixtures, favoriteTeam, contacts }: { fixtures: Fixture[]; favoriteTeam: string; contacts: TeamContact[] }) {
  const dates = Array.from(new Set(fixtures.map((fixture) => fixture.date.toISOString())))
  return (
    <div className="schedule-list">
      {dates.map((isoDate) => {
        const date = new Date(isoDate)
        const dayFixtures = fixtures.filter((fixture) => fixture.date.toISOString() === isoDate)
        return (
          <section className="schedule-day" key={isoDate}>
            <div className="schedule-date"><strong>{formatDate(date, { weekday: 'long', year: 'numeric' })}</strong><span>{dayFixtures.length} fixtures</span></div>
            {dayFixtures.map((fixture) => {
              const isFavorite = favoriteTeam && [fixture.home, fixture.away].some((team) => teamKey(team) === teamKey(favoriteTeam))
              const venue = findContact(contacts, fixture.home)
              return (
                <div className={isFavorite ? 'schedule-match highlighted' : 'schedule-match'} key={`${fixture.division}-${fixture.home}-${fixture.date.toISOString()}`}>
                  <span className="schedule-division">DIV {fixture.division}</span>
                  <strong>{fixture.home}</strong>
                  <span className="schedule-v">v</span>
                  <strong>{fixture.away}</strong>
                  <span className="schedule-status">{fixture.date < startOfToday() ? 'Played' : 'Upcoming'}</span>
                  <span className="schedule-actions">
                    {venue?.address && <a className="schedule-icon" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.address)}`} target="_blank" rel="noreferrer" aria-label={`Map ${fixture.home} venue`} title="Map venue"><MapPin size={14} /></a>}
                    <button className="schedule-icon" onClick={() => addFixtureToCalendar(fixture, venue?.address)} aria-label={`Add ${fixture.home} versus ${fixture.away} to calendar`} title="Add to calendar"><CalendarPlus size={14} /></button>
                  </span>
                </div>
              )
            })}
          </section>
        )
      })}
      {!dates.length && <div className="empty-row">No fixtures are listed for this division.</div>}
    </div>
  )
}

function StandingsTable({ standings, favoriteTeam }: { standings: Standing[]; favoriteTeam: string }) {
  return (
    <div className="standings-table">
      <div className="standings-head"><span>POS</span><span>TEAM</span><span>P</span><span>W</span><span>D</span><span>L</span><span>PTS</span></div>
      {standings.map((row) => <div className={favoriteTeam && teamKey(row.team) === teamKey(favoriteTeam) ? 'standings-row highlighted' : 'standings-row'} key={row.team}><span className="rank">{String(row.rank).padStart(2, '0')}</span><strong>{row.team}</strong><span>{row.played}</span><span>{row.won}</span><span>{row.drawn}</span><span>{row.lost}</span><b>{row.points}</b></div>)}
      {!standings.length && <div className="empty-row">Standings are unavailable in the latest source snapshot.</div>}
    </div>
  )
}

export default App
