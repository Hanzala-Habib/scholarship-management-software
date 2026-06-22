import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'

type ProfessorStatus = 'planned' | 'emailed' | 'follow-up' | 'responded' | 'not-fit'
type ApplicationStatus = 'researching' | 'shortlisted' | 'contacting' | 'applied' | 'accepted' | 'closed'
type FundingType = 'self' | 'scholarship'

type Professor = {
  id: string
  name: string
  email: string
  research: string
  status: ProfessorStatus
  emailedOn: string
  followUpOn: string
  notes: string
}

type University = {
  id: string
  name: string
  country: string
  course: string
  fundingType: FundingType
  scholarship: string
  selfProcessingStartDate: string
  scholarshipDeadline: string
  universityDeadline: string
  applicationStatus: ApplicationStatus
  notes: string
  professors: Professor[]
}

type NewUniversity = Omit<University, 'id' | 'professors'>
type NewProfessor = Omit<Professor, 'id'>

const storageKey = 'scholarship-command-center-v2'
const savedAtKey = 'scholarship-command-center-saved-at'
const passwordStorageKey = 'scholarship-command-center-password'
const allCountriesValue = 'All countries'

const emptyUniversity: NewUniversity = {
  name: '',
  country: '',
  course: '',
  fundingType: 'scholarship',
  scholarship: '',
  selfProcessingStartDate: '',
  scholarshipDeadline: '',
  universityDeadline: '',
  applicationStatus: 'researching',
  notes: '',
}

const emptyProfessor: NewProfessor = {
  name: '',
  email: '',
  research: '',
  status: 'planned',
  emailedOn: '',
  followUpOn: '',
  notes: '',
}

const statusLabels: Record<ProfessorStatus, string> = {
  planned: 'Planned',
  emailed: 'Emailed',
  'follow-up': 'Follow-up',
  responded: 'Responded',
  'not-fit': 'Not fit',
}

const applicationLabels: Record<ApplicationStatus, string> = {
  researching: 'Researching',
  shortlisted: 'Shortlisted',
  contacting: 'Contacting',
  applied: 'Applied',
  accepted: 'Accepted',
  closed: 'Closed',
}

const fundingLabels: Record<FundingType, string> = {
  self: 'Self',
  scholarship: 'Scholarship',
}

function normalizeUniversity(university: University): University {
  return {
    ...university,
    fundingType: university.fundingType ?? 'scholarship',
    selfProcessingStartDate: university.selfProcessingStartDate ?? '',
    professors: university.professors ?? [],
  }
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function todayValue() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(date: string, days: number) {
  if (!date) return ''
  const next = new Date(`${date}T00:00:00`)
  next.setDate(next.getDate() + days)
  return next.toISOString().slice(0, 10)
}

function daysUntil(date: string) {
  if (!date) return null
  const current = new Date(`${todayValue()}T00:00:00`).getTime()
  const target = new Date(`${date}T00:00:00`).getTime()
  return Math.ceil((target - current) / 86_400_000)
}

function sortByDeadline(items: University[]) {
  return [...items].sort((a, b) => {
    const aDate =
      a.fundingType === 'self'
        ? a.selfProcessingStartDate || a.universityDeadline || '9999-12-31'
        : a.scholarshipDeadline || a.universityDeadline || '9999-12-31'
    const bDate =
      b.fundingType === 'self'
        ? b.selfProcessingStartDate || b.universityDeadline || '9999-12-31'
        : b.scholarshipDeadline || b.universityDeadline || '9999-12-31'
    return aDate.localeCompare(bDate)
  })
}

function formatSavedAt(value: string) {
  if (!value) return 'Not saved yet'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

async function requestCloudData(password: string, universities?: University[]) {
  const response = await fetch('/api/data', {
    method: universities ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Password': password,
    },
    body: universities ? JSON.stringify({ universities }) : undefined,
  })

  const payload = (await response.json()) as {
    universities?: University[]
    updatedAt?: string
    error?: string
  }

  if (!response.ok) {
    throw new Error(payload.error || 'Cloud storage request failed.')
  }

  return payload
}

function App() {
  const [universities, setUniversities] = useState<University[]>(() => {
    const saved = localStorage.getItem(storageKey)
    if (!saved) return []

    try {
      const parsed = JSON.parse(saved) as University[]
      return Array.isArray(parsed) ? parsed.map(normalizeUniversity) : []
    } catch {
      return []
    }
  })

  const countries = useMemo(
    () => Array.from(new Set(universities.map((item) => item.country).filter(Boolean))).sort(),
    [universities],
  )
  const [selectedCountry, setSelectedCountry] = useState(allCountriesValue)
  const [selectedScholarship, setSelectedScholarship] = useState('All')
  const [selectedUniversityId, setSelectedUniversityId] = useState(universities[0]?.id ?? '')
  const [universityForm, setUniversityForm] = useState<NewUniversity>(emptyUniversity)
  const [professorForm, setProfessorForm] = useState<NewProfessor>(emptyProfessor)
  const [query, setQuery] = useState('')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [appPassword, setAppPassword] = useState(() => localStorage.getItem(passwordStorageKey) ?? '')
  const [passwordInput, setPasswordInput] = useState('')
  const [cloudStatus, setCloudStatus] = useState('Cloud storage locked')
  const [cloudUpdatedAt, setCloudUpdatedAt] = useState('')
  const [isCloudReady, setIsCloudReady] = useState(false)
  const [isConnectingCloud, setIsConnectingCloud] = useState(false)
  const skipNextCloudSave = useRef(false)
  const latestUniversities = useRef(universities)

  useEffect(() => {
    latestUniversities.current = universities
    const savedAt = new Date().toISOString()
    localStorage.setItem(storageKey, JSON.stringify(universities))
    localStorage.setItem(savedAtKey, savedAt)
  }, [universities])

  useEffect(() => {
    if (!appPassword) {
      return
    }

    let isActive = true

    async function loadCloudData() {
      setIsConnectingCloud(true)
      setCloudStatus('Connecting to cloud storage...')

      try {
        const payload = await requestCloudData(appPassword)
        if (!isActive) return

        const cloudUniversities = Array.isArray(payload.universities)
          ? payload.universities.map(normalizeUniversity)
          : []
        let nextCloudUpdatedAt = payload.updatedAt ?? ''

        if (cloudUniversities.length > 0) {
          skipNextCloudSave.current = true
          setUniversities(cloudUniversities)
          setSelectedCountry(cloudUniversities[0]?.country ?? allCountriesValue)
          setSelectedUniversityId(cloudUniversities[0]?.id ?? '')
        } else if (latestUniversities.current.length > 0) {
          const savedPayload = await requestCloudData(appPassword, latestUniversities.current)
          if (!isActive) return
          nextCloudUpdatedAt = savedPayload.updatedAt ?? nextCloudUpdatedAt
        }

        setCloudUpdatedAt(nextCloudUpdatedAt)
        setIsCloudReady(true)
        setCloudStatus('Cloud storage connected')
      } catch (error) {
        if (!isActive) return
        setIsCloudReady(false)
        setCloudStatus(error instanceof Error ? error.message : 'Cloud storage failed')
      } finally {
        if (isActive) setIsConnectingCloud(false)
      }
    }

    void loadCloudData()

    return () => {
      isActive = false
    }
  }, [appPassword])

  useEffect(() => {
    if (!isCloudReady || !appPassword) return

    if (skipNextCloudSave.current) {
      skipNextCloudSave.current = false
      return
    }

    const saveTimer = window.setTimeout(() => {
      setCloudStatus('Saving to cloud...')
      requestCloudData(appPassword, universities)
        .then((payload) => {
          setCloudUpdatedAt(payload.updatedAt ?? new Date().toISOString())
          setCloudStatus('Cloud storage connected')
        })
        .catch((error) => {
          setCloudStatus(error instanceof Error ? error.message : 'Cloud save failed')
        })
    }, 600)

    return () => window.clearTimeout(saveTimer)
  }, [appPassword, isCloudReady, universities])

  const lastSavedAt = useMemo(() => {
    if (universities.length === 0) {
      return localStorage.getItem(savedAtKey) ?? ''
    }

    return localStorage.getItem(savedAtKey) ?? new Date().toISOString()
  }, [universities])

  const activeCountry =
    selectedCountry === allCountriesValue || countries.includes(selectedCountry)
      ? selectedCountry
      : allCountriesValue

  const scholarships = useMemo(() => {
    const countryItems =
      activeCountry === allCountriesValue
        ? universities
        : universities.filter((item) => item.country === activeCountry)
    return Array.from(new Set(countryItems.map((item) => item.scholarship).filter(Boolean))).sort()
  }, [activeCountry, universities])
  const activeScholarship =
    selectedScholarship === 'All' || scholarships.includes(selectedScholarship)
      ? selectedScholarship
      : 'All'

  const filteredUniversities = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return sortByDeadline(
      universities.filter((item) => {
        const countryMatch = activeCountry === allCountriesValue || item.country === activeCountry
        const scholarshipMatch = activeScholarship === 'All' || item.scholarship === activeScholarship
        const fundingLabel = fundingLabels[item.fundingType]
        const queryMatch =
          !normalizedQuery ||
          [
            item.name,
            item.country,
            item.course,
            item.scholarship,
            item.fundingType,
            fundingLabel,
            item.selfProcessingStartDate,
            item.scholarshipDeadline,
            item.universityDeadline,
            item.applicationStatus,
            applicationLabels[item.applicationStatus],
            item.notes,
          ]
            .join(' ')
            .toLowerCase()
            .includes(normalizedQuery) ||
          item.professors.some((professor) =>
            [
              professor.name,
              professor.email,
              professor.research,
              professor.status,
              statusLabels[professor.status],
              professor.emailedOn,
              professor.followUpOn,
              professor.notes,
            ]
              .join(' ')
              .toLowerCase()
              .includes(normalizedQuery),
          )

        return countryMatch && scholarshipMatch && queryMatch
      }),
    )
  }, [activeCountry, activeScholarship, query, universities])

  const selectedUniversity =
    filteredUniversities.find((item) => item.id === selectedUniversityId) ?? filteredUniversities[0]

  const stats = useMemo(() => {
    const professors = filteredUniversities.flatMap((item) => item.professors)
    const contacted = professors.filter((item) => item.emailedOn).length
    const followUps = professors.filter((item) => {
      const days = daysUntil(item.followUpOn)
      return item.followUpOn && item.status !== 'responded' && days !== null && days <= 7
    }).length
    const applications = filteredUniversities.filter((item) =>
      ['applied', 'accepted'].includes(item.applicationStatus),
    ).length

    return {
      universities: filteredUniversities.length,
      professors: professors.length,
      contacted,
      followUps,
      applications,
    }
  }, [filteredUniversities])

  function addUniversity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!universityForm.name.trim() || !universityForm.country.trim()) return

    const nextUniversity: University = {
      ...universityForm,
      id: createId('u'),
      name: universityForm.name.trim(),
      country: universityForm.country.trim(),
      scholarship:
        universityForm.fundingType === 'self'
          ? universityForm.scholarship.trim() || 'Self funded'
          : universityForm.scholarship.trim() || 'General',
      selfProcessingStartDate:
        universityForm.fundingType === 'self' ? universityForm.selfProcessingStartDate : '',
      professors: [],
    }

    setUniversities((current) => [nextUniversity, ...current])
    setSelectedCountry(nextUniversity.country)
    setSelectedScholarship('All')
    setSelectedUniversityId(nextUniversity.id)
    setUniversityForm({ ...emptyUniversity, country: nextUniversity.country })
  }

  function addProfessor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedUniversity || !professorForm.name.trim()) return

    const emailedOn = professorForm.emailedOn
    const nextProfessor: Professor = {
      ...professorForm,
      id: createId('p'),
      name: professorForm.name.trim(),
      email: professorForm.email.trim(),
      status: emailedOn && professorForm.status === 'planned' ? 'emailed' : professorForm.status,
      followUpOn: professorForm.followUpOn || addDays(emailedOn, 7),
    }

    setUniversities((current) =>
      current.map((item) =>
        item.id === selectedUniversity.id
          ? { ...item, professors: [nextProfessor, ...item.professors] }
          : item,
      ),
    )
    setProfessorForm(emptyProfessor)
  }

  function updateUniversity(id: string, updates: Partial<University>) {
    setUniversities((current) =>
      current.map((item) => (item.id === id ? { ...item, ...updates } : item)),
    )
  }

  function updateProfessor(universityId: string, professorId: string, updates: Partial<Professor>) {
    setUniversities((current) =>
      current.map((university) =>
        university.id === universityId
          ? {
              ...university,
              professors: university.professors.map((professor) =>
                professor.id === professorId ? { ...professor, ...updates } : professor,
              ),
            }
          : university,
      ),
    )
  }

  function markEmailed(professor: Professor) {
    if (!selectedUniversity) return

    updateProfessor(selectedUniversity.id, professor.id, {
      status: 'emailed',
      emailedOn: professor.emailedOn || todayValue(),
      followUpOn: professor.followUpOn || addDays(todayValue(), 7),
    })
  }

  function deleteUniversity(id: string) {
    setUniversities((current) => current.filter((item) => item.id !== id))
  }

  function deleteProfessor(universityId: string, professorId: string) {
    setUniversities((current) =>
      current.map((university) =>
        university.id === universityId
          ? {
              ...university,
              professors: university.professors.filter((item) => item.id !== professorId),
            }
          : university,
      ),
    )
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(universities, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `scholarship-tracker-${todayValue()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function importData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as University[]
        if (Array.isArray(parsed)) {
          const nextUniversities = parsed.map(normalizeUniversity)
          setUniversities(nextUniversities)
          setSelectedCountry(nextUniversities[0]?.country ?? allCountriesValue)
          setSelectedUniversityId(nextUniversities[0]?.id ?? '')
        }
      } catch {
        alert('This file could not be imported. Please choose a valid tracker JSON file.')
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  function connectCloud(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextPassword = passwordInput.trim()
    if (!nextPassword) return

    localStorage.setItem(passwordStorageKey, nextPassword)
    setAppPassword(nextPassword)
    setPasswordInput('')
  }

  function disconnectCloud() {
    localStorage.removeItem(passwordStorageKey)
    setAppPassword('')
    setIsCloudReady(false)
    setCloudUpdatedAt('')
    setCloudStatus('Cloud storage locked')
  }

  return (
    <main className={isSidebarCollapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
      <aside className="sidebar">
        <div className="brand-block">
          <span className="brand-mark">ST</span>
          <div>
            <h1>Scholarship Tracker</h1>
            <p>Personal professor outreach and application command center.</p>
          </div>
          <button
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!isSidebarCollapsed}
            className="sidebar-fold-button"
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            type="button"
            onClick={() => setIsSidebarCollapsed((current) => !current)}
          >
            {isSidebarCollapsed ? '>' : '<'}
          </button>
        </div>

        <section className="panel compact">
          <div className="panel-title">
            <h2>Countries</h2>
            <span>{countries.length}</span>
          </div>
          <div className="country-list">
            <button
              className={activeCountry === allCountriesValue ? 'active' : ''}
              type="button"
              onClick={() => {
                setSelectedCountry(allCountriesValue)
                setSelectedScholarship('All')
              }}
            >
              <span>All countries</span>
              <b>{universities.length}</b>
            </button>
            {countries.map((country) => (
              <button
                className={country === activeCountry ? 'active' : ''}
                key={country}
                type="button"
                onClick={() => {
                  setSelectedCountry(country)
                  setSelectedScholarship('All')
                }}
              >
                <span>{country}</span>
                <b>{universities.filter((item) => item.country === country).length}</b>
              </button>
            ))}
            {countries.length === 0 && (
              <p className="empty-state">Add your first university to create a country.</p>
            )}
          </div>
        </section>

        <section className="panel compact">
          <div className="panel-title">
            <h2>Add university</h2>
          </div>
          <form className="stack-form" onSubmit={addUniversity}>
            <input
              aria-label="University name"
              placeholder="University name"
              required
              value={universityForm.name}
              onChange={(event) => setUniversityForm({ ...universityForm, name: event.target.value })}
            />
            <input
              aria-label="Country"
              placeholder="Country"
              required
              value={universityForm.country}
              onChange={(event) =>
                setUniversityForm({ ...universityForm, country: event.target.value })
              }
            />
            <input
              aria-label="Course"
              placeholder="Course / program"
              value={universityForm.course}
              onChange={(event) => setUniversityForm({ ...universityForm, course: event.target.value })}
            />
            <div className="two-fields">
              <label>
                Funding type
                <select
                  value={universityForm.fundingType}
                  onChange={(event) =>
                    setUniversityForm({
                      ...universityForm,
                      fundingType: event.target.value as FundingType,
                      selfProcessingStartDate:
                        event.target.value === 'self' ? universityForm.selfProcessingStartDate : '',
                    })
                  }
                >
                  {Object.entries(fundingLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {universityForm.fundingType === 'self' ? (
                <label>
                  Start processing
                  <input
                    type="date"
                    value={universityForm.selfProcessingStartDate}
                    onChange={(event) =>
                      setUniversityForm({
                        ...universityForm,
                        selfProcessingStartDate: event.target.value,
                      })
                    }
                  />
                </label>
              ) : (
                <label>
                  Scholarship name
                  <input
                    value={universityForm.scholarship}
                    onChange={(event) =>
                      setUniversityForm({ ...universityForm, scholarship: event.target.value })
                    }
                  />
                </label>
              )}
            </div>
            <div className="two-fields">
              <label>
                Scholarship deadline
                <input
                  type="date"
                  value={universityForm.scholarshipDeadline}
                  onChange={(event) =>
                    setUniversityForm({
                      ...universityForm,
                      scholarshipDeadline: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                University deadline
                <input
                  type="date"
                  value={universityForm.universityDeadline}
                  onChange={(event) =>
                    setUniversityForm({ ...universityForm, universityDeadline: event.target.value })
                  }
                />
              </label>
            </div>
            <textarea
              aria-label="University notes"
              placeholder="Notes, requirements, acceptance letter details"
              value={universityForm.notes}
              onChange={(event) => setUniversityForm({ ...universityForm, notes: event.target.value })}
            />
            <button className="primary-action" type="submit">
              Add university
            </button>
          </form>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Selected country</p>
            <h2>{activeCountry}</h2>
            <p className="save-status">Saved on this browser: {formatSavedAt(lastSavedAt)}</p>
            <p className={isCloudReady ? 'cloud-status connected' : 'cloud-status'}>
              {cloudStatus}
              {cloudUpdatedAt ? `: ${formatSavedAt(cloudUpdatedAt)}` : ''}
            </p>
          </div>
          <div className="topbar-actions">
            <label className="file-action">
              Import JSON
              <input accept="application/json" type="file" onChange={importData} />
            </label>
            <button type="button" onClick={exportData}>
              Export backup
            </button>
          </div>
        </header>

        {!appPassword ? (
          <section className="panel cloud-panel">
            <div>
              <h2>Connect cloud storage</h2>
              <p>
                Enter your private app password to load and save your tracker in Neon Postgres.
              </p>
            </div>
            <form className="cloud-form" onSubmit={connectCloud}>
              <input
                aria-label="App password"
                placeholder="App password"
                type="password"
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
              />
              <button className="primary-action" type="submit">
                Connect
              </button>
            </form>
          </section>
        ) : (
          <section className="cloud-strip">
            <span>
              {isCloudReady
                ? 'Cloud sync is active. Changes save automatically.'
                : isConnectingCloud
                  ? 'Connecting to cloud storage...'
                  : cloudStatus}
            </span>
            <button type="button" onClick={disconnectCloud}>
              Disconnect
            </button>
          </section>
        )}

        <section className="stats-grid">
          <StatCard label="Universities" value={stats.universities} />
          <StatCard label="Professors saved" value={stats.professors} />
          <StatCard label="Emails sent" value={stats.contacted} />
          <StatCard label="Follow-ups due" value={stats.followUps} />
          <StatCard label="Applied / accepted" value={stats.applications} />
        </section>

        <section className="filters">
          <input
            aria-label="Search"
            placeholder="Search university, professor, research interest, self, scholarship"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            aria-label="Scholarship filter"
            value={activeScholarship}
            onChange={(event) => setSelectedScholarship(event.target.value)}
          >
            <option>All</option>
            {scholarships.map((scholarship) => (
              <option key={scholarship}>{scholarship}</option>
            ))}
          </select>
        </section>

        <div className="main-grid">
          <section className="panel university-panel">
            <div className="panel-title">
              <h2>Universities</h2>
              <span>{filteredUniversities.length} in view</span>
            </div>
            <div className="university-list">
              {filteredUniversities.map((university) => (
                <button
                  className={university.id === selectedUniversity?.id ? 'university active' : 'university'}
                  key={university.id}
                  type="button"
                  onClick={() => setSelectedUniversityId(university.id)}
                >
                  <span>
                    <b>{university.name}</b>
                    <small>{university.course || 'Course not added'}</small>
                  </span>
                  <span>
                    <em>
                      {fundingLabels[university.fundingType]}
                      {university.fundingType === 'scholarship' ? ` / ${university.scholarship}` : ''}
                    </em>
                    <DeadlineBadge
                      date={
                        university.fundingType === 'self'
                          ? university.selfProcessingStartDate || university.universityDeadline
                          : university.scholarshipDeadline || university.universityDeadline
                      }
                    />
                  </span>
                </button>
              ))}
              {filteredUniversities.length === 0 && (
                <p className="empty-state">No universities yet for this filter.</p>
              )}
            </div>
          </section>

          <section className="detail-area">
            {selectedUniversity ? (
              <>
                <section className="panel detail-header">
                  <div className="detail-heading">
                    <div>
                      <p className="eyebrow">{selectedUniversity.country}</p>
                      <input
                        className="title-input"
                        value={selectedUniversity.name}
                        onChange={(event) =>
                          updateUniversity(selectedUniversity.id, { name: event.target.value })
                        }
                      />
                    </div>
                    <select
                      className="application-status-select"
                      value={selectedUniversity.applicationStatus}
                      onChange={(event) =>
                        updateUniversity(selectedUniversity.id, {
                          applicationStatus: event.target.value as ApplicationStatus,
                        })
                      }
                    >
                      {Object.entries(applicationLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="meta-grid">
                    <label>
                      Course
                      <input
                        value={selectedUniversity.course}
                        onChange={(event) =>
                          updateUniversity(selectedUniversity.id, { course: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Funding type
                      <select
                        value={selectedUniversity.fundingType}
                        onChange={(event) =>
                          updateUniversity(selectedUniversity.id, {
                            fundingType: event.target.value as FundingType,
                            selfProcessingStartDate:
                              event.target.value === 'self'
                                ? selectedUniversity.selfProcessingStartDate
                                : '',
                          })
                        }
                      >
                        {Object.entries(fundingLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selectedUniversity.fundingType === 'self' ? (
                      <label>
                        Start processing
                        <input
                          type="date"
                          value={selectedUniversity.selfProcessingStartDate}
                          onChange={(event) =>
                            updateUniversity(selectedUniversity.id, {
                              selfProcessingStartDate: event.target.value,
                            })
                          }
                        />
                      </label>
                    ) : (
                      <label>
                        Scholarship
                        <input
                          value={selectedUniversity.scholarship}
                          onChange={(event) =>
                            updateUniversity(selectedUniversity.id, {
                              scholarship: event.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                    <label>
                      Scholarship deadline
                      <input
                        type="date"
                        value={selectedUniversity.scholarshipDeadline}
                        onChange={(event) =>
                          updateUniversity(selectedUniversity.id, {
                            scholarshipDeadline: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      University deadline
                      <input
                        type="date"
                        value={selectedUniversity.universityDeadline}
                        onChange={(event) =>
                          updateUniversity(selectedUniversity.id, {
                            universityDeadline: event.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Notes and requirements
                    <textarea
                      value={selectedUniversity.notes}
                      onChange={(event) =>
                        updateUniversity(selectedUniversity.id, { notes: event.target.value })
                      }
                    />
                  </label>
                </section>

                <section className="panel">
                  <div className="panel-title">
                    <h2>Professors</h2>
                    <span>{selectedUniversity.professors.length} saved</span>
                  </div>
                  <form className="professor-form" onSubmit={addProfessor}>
                    <input
                      aria-label="Professor name"
                      placeholder="Professor name"
                      value={professorForm.name}
                      onChange={(event) =>
                        setProfessorForm({ ...professorForm, name: event.target.value })
                      }
                    />
                    <input
                      aria-label="Professor email"
                      placeholder="Email"
                      value={professorForm.email}
                      onChange={(event) =>
                        setProfessorForm({ ...professorForm, email: event.target.value })
                      }
                    />
                    <input
                      aria-label="Research interest"
                      placeholder="Research interest match"
                      value={professorForm.research}
                      onChange={(event) =>
                        setProfessorForm({ ...professorForm, research: event.target.value })
                      }
                    />
                    <input
                      aria-label="Email date"
                      type="date"
                      value={professorForm.emailedOn}
                      onChange={(event) =>
                        setProfessorForm({
                          ...professorForm,
                          emailedOn: event.target.value,
                          followUpOn: professorForm.followUpOn || addDays(event.target.value, 7),
                        })
                      }
                    />
                    <button className="primary-action" type="submit">
                      Add professor
                    </button>
                  </form>

                  <div className="professor-list">
                    {selectedUniversity.professors.map((professor, index) => (
                      <article className="professor-card" key={professor.id}>
                        <div className="professor-card-header">
                          <div>
                            <span className="professor-number">Professor {index + 1}</span>
                            <input
                              className="professor-name-input"
                              value={professor.name}
                              onChange={(event) =>
                                updateProfessor(selectedUniversity.id, professor.id, {
                                  name: event.target.value,
                                })
                              }
                            />
                          </div>
                          <span className={`status-pill ${professor.status}`}>
                            {statusLabels[professor.status]}
                          </span>
                        </div>

                        <div className="professor-contact-grid">
                          <label>
                            Email
                            <input
                              value={professor.email}
                              onChange={(event) =>
                                updateProfessor(selectedUniversity.id, professor.id, {
                                  email: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            Outreach status
                            <select
                              value={professor.status}
                              onChange={(event) =>
                                updateProfessor(selectedUniversity.id, professor.id, {
                                  status: event.target.value as ProfessorStatus,
                                })
                              }
                            >
                              {Object.entries(statusLabels).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Emailed
                            <input
                              type="date"
                              value={professor.emailedOn}
                              onChange={(event) =>
                                updateProfessor(selectedUniversity.id, professor.id, {
                                  emailedOn: event.target.value,
                                  followUpOn: professor.followUpOn || addDays(event.target.value, 7),
                                })
                              }
                            />
                          </label>
                          <label>
                            Follow-up
                            <input
                              type="date"
                              value={professor.followUpOn}
                              onChange={(event) =>
                                updateProfessor(selectedUniversity.id, professor.id, {
                                  followUpOn: event.target.value,
                                })
                              }
                            />
                          </label>
                        </div>

                        <label>
                          Research interest match
                          <textarea
                            value={professor.research}
                            onChange={(event) =>
                              updateProfessor(selectedUniversity.id, professor.id, {
                                research: event.target.value,
                              })
                            }
                          />
                        </label>

                        <label>
                          Notes
                          <input
                            value={professor.notes}
                            placeholder="Follow-up plan, response, documents sent"
                            onChange={(event) =>
                              updateProfessor(selectedUniversity.id, professor.id, {
                                notes: event.target.value,
                              })
                            }
                          />
                        </label>

                        <div className="professor-card-actions">
                          <button type="button" onClick={() => markEmailed(professor)}>
                            Mark emailed
                          </button>
                          <button
                            className="danger-action"
                            type="button"
                            onClick={() => deleteProfessor(selectedUniversity.id, professor.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </article>
                    ))}
                    {selectedUniversity.professors.length === 0 && (
                      <p className="empty-state">
                        Add professors here as you find labs that match your profile.
                      </p>
                    )}
                  </div>
                </section>

                <button
                  className="delete-university"
                  type="button"
                  onClick={() => deleteUniversity(selectedUniversity.id)}
                >
                  Delete this university
                </button>
              </>
            ) : (
              <section className="panel empty-state">
                Choose a country and add your first university.
              </section>
            )}
          </section>
        </div>
      </section>
    </main>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <article className="stat-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  )
}

function DeadlineBadge({ date }: { date: string }) {
  const days = daysUntil(date)
  if (!date || days === null) return <small className="deadline muted">No deadline</small>

  const label = days < 0 ? `${Math.abs(days)} days late` : `${days} days left`
  const tone = days < 0 ? 'late' : days <= 14 ? 'soon' : 'ok'
  return <small className={`deadline ${tone}`}>{label}</small>
}

export default App
