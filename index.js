import { useState, useEffect, useRef } from 'react'
import Head from 'next/head'

const TABS = ['Search', 'Applications', 'Settings']

// ── tiny helpers ──────────────────────────────────────────────
function Tag({ children, color = 'default' }) {
  const colors = {
    default: { bg: 'rgba(255,255,255,0.06)', text: '#888' },
    green:   { bg: 'rgba(200,241,53,0.1)',   text: '#c8f135' },
    blue:    { bg: 'rgba(77,158,255,0.1)',    text: '#4d9eff' },
    red:     { bg: 'rgba(255,77,77,0.1)',     text: '#ff4d4d' },
  }
  const c = colors[color] || colors.default
  return (
    <span style={{
      background: c.bg, color: c.text, fontSize: 11,
      padding: '3px 10px', borderRadius: 20, fontFamily: 'var(--mono)',
      letterSpacing: 0.3, whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

function Btn({ children, onClick, variant = 'primary', disabled, style = {} }) {
  const variants = {
    primary: { background: 'var(--accent)', color: '#080808', border: 'none' },
    ghost:   { background: 'transparent', color: 'var(--text2)', border: '1px solid var(--border)' },
    danger:  { background: 'rgba(255,77,77,0.1)', color: 'var(--red)', border: '1px solid rgba(255,77,77,0.2)' },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...variants[variant],
        borderRadius: 8, padding: '9px 18px', fontSize: 13,
        fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1, transition: 'all 0.15s',
        fontFamily: 'var(--font)', ...style
      }}
    >{children}</button>
  )
}

function Input({ label, value, onChange, placeholder, type = 'text', multiline, rows = 4 }) {
  const shared = {
    width: '100%', background: 'var(--bg3)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '10px 14px', color: 'var(--text)',
    fontSize: 14, outline: 'none', fontFamily: 'var(--font)',
    transition: 'border 0.15s', resize: 'vertical',
  }
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <div style={{ color: 'var(--text2)', fontSize: 11, fontFamily: 'var(--mono)', marginBottom: 6, letterSpacing: 1 }}>{label}</div>}
      {multiline
        ? <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows} style={shared} />
        : <input type={type} value={value} onChange={onChange} placeholder={placeholder} style={shared} />
      }
    </div>
  )
}

function ScoreBadge({ score }) {
  const color = score >= 85 ? '#c8f135' : score >= 70 ? '#ffd166' : '#ff6b6b'
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ color, fontSize: 26, fontWeight: 800, lineHeight: 1, fontFamily: 'var(--mono)' }}>{score}</div>
      <div style={{ color: 'var(--text3)', fontSize: 10, fontFamily: 'var(--mono)' }}>fit</div>
    </div>
  )
}

// ── Apply Modal ───────────────────────────────────────────────
function ApplyModal({ job, settings, onClose, onSaved }) {
  const [step, setStep] = useState('tailor')
  const [tailored, setTailored] = useState('')
  const [coverLetter, setCoverLetter] = useState('')
  const [toEmail, setToEmail] = useState('')
  const [tab, setTab] = useState('resume')
  const [err, setErr] = useState('')
  const [sending, setSending] = useState(false)

  const doTailor = async () => {
    setStep('tailoring')
    setErr('')
    try {
      const [rRes, cRes] = await Promise.all([
        fetch('/api/tailor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resume: settings.resume, job, apiKey: settings.apiKey })
        }),
        fetch('/api/cover-letter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resume: settings.resume, job, apiKey: settings.apiKey })
        })
      ])
      const rData = await rRes.json()
      const cData = await cRes.json()
      if (rData.error) throw new Error(rData.error)
      setTailored(rData.tailored)
      setCoverLetter(cData.letter || '')
      setStep('review')
    } catch (e) {
      setErr(e.message)
      setStep('tailor')
    }
  }

  const doSend = async () => {
    if (!toEmail.trim()) { setErr('Enter a recipient email.'); return }
    if (!settings.gmailUser || !settings.gmailPass) { setErr('Add Gmail credentials in Settings first.'); return }
    setSending(true); setErr('')
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toEmail.trim(),
          subject: job.email.subject,
          body: job.email.body + (coverLetter ? '\n\n---\n\n' + coverLetter : ''),
          resume: tailored,
          company: job.company,
          gmailUser: settings.gmailUser,
          gmailPass: settings.gmailPass,
        })
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onSaved({ ...job, status: 'Applied', appliedAt: new Date().toISOString(), toEmail })
      setStep('sent')
    } catch (e) {
      setErr(e.message)
    }
    setSending(false)
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100, padding: 20,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 16, padding: 28, maxWidth: 620, width: '100%',
        maxHeight: '88vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>Apply to {job.company}</div>
            <div style={{ color: 'var(--text2)', fontSize: 13, marginTop: 2 }}>{job.title}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Steps */}
        {step === 'tailor' && (
          <div>
            <div style={{ background: 'var(--bg3)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
              <div style={{ color: 'var(--text3)', fontSize: 11, fontFamily: 'var(--mono)', marginBottom: 8 }}>JOB DESCRIPTION</div>
              <div style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 1.6 }}>{job.jobDescription}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {job.tags.map(t => <Tag key={t}>{t}</Tag>)}
            </div>
            {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 14, padding: '10px 14px', background: 'rgba(255,77,77,0.08)', borderRadius: 8 }}>{err}</div>}
            <Btn onClick={doTailor} style={{ width: '100%', padding: 13 }}>
              Tailor Resume + Generate Cover Letter →
            </Btn>
          </div>
        )}

        {step === 'tailoring' && (
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <div style={{ width: 32, height: 32, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />
            <div style={{ color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: 13, marginBottom: 8 }}>Tailoring for {job.company}...</div>
            <div style={{ color: 'var(--text3)', fontSize: 12 }}>Rewriting summary · Matching keywords · Generating cover letter</div>
          </div>
        )}

        {step === 'review' && (
          <div>
            {/* Tab switcher */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 18, background: 'var(--bg3)', borderRadius: 8, padding: 4 }}>
              {['resume', 'cover', 'email'].map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 600,
                  borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'var(--font)',
                  background: tab === t ? 'var(--bg2)' : 'transparent',
                  color: tab === t ? 'var(--text)' : 'var(--text3)',
                  transition: 'all 0.15s',
                }}>
                  {t === 'resume' ? 'Resume' : t === 'cover' ? 'Cover Letter' : 'Email'}
                </button>
              ))}
            </div>

            {tab === 'resume' && (
              <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 16, marginBottom: 16, maxHeight: 280, overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ color: 'var(--text3)', fontSize: 10, fontFamily: 'var(--mono)' }}>TAILORED RESUME</div>
                  <button onClick={() => navigator.clipboard?.writeText(tailored)} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 11, cursor: 'pointer', fontFamily: 'var(--mono)' }}>copy</button>
                </div>
                <pre style={{ color: 'var(--text2)', fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)' }}>{tailored}</pre>
              </div>
            )}

            {tab === 'cover' && (
              <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 16, marginBottom: 16, maxHeight: 280, overflowY: 'auto' }}>
                <div style={{ color: 'var(--text3)', fontSize: 10, fontFamily: 'var(--mono)', marginBottom: 8 }}>COVER LETTER</div>
                <div style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-line' }}>{coverLetter}</div>
              </div>
            )}

            {tab === 'email' && (
              <div>
                <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 16, marginBottom: 14 }}>
                  <div style={{ color: 'var(--text3)', fontSize: 10, fontFamily: 'var(--mono)', marginBottom: 4 }}>SUBJECT</div>
                  <div style={{ color: 'var(--text)', fontSize: 14, marginBottom: 14 }}>{job.email.subject}</div>
                  <div style={{ color: 'var(--text3)', fontSize: 10, fontFamily: 'var(--mono)', marginBottom: 4 }}>BODY</div>
                  <div style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-line' }}>{job.email.body}</div>
                </div>
              </div>
            )}

            {/* Send to */}
            <Input
              label="SEND TO"
              value={toEmail}
              onChange={e => setToEmail(e.target.value)}
              placeholder="recruiter@company.com"
            />
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <a href={`https://www.linkedin.com/company/${job.company.toLowerCase().replace(/\s+/g, '-')}/people`} target="_blank" rel="noopener noreferrer">
                <Tag color="blue">Find on LinkedIn →</Tag>
              </a>
              <a href={job.url} target="_blank" rel="noopener noreferrer">
                <Tag color="blue">Careers Page →</Tag>
              </a>
            </div>

            {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 14, padding: '10px 14px', background: 'rgba(255,77,77,0.08)', borderRadius: 8 }}>{err}</div>}

            <div style={{ display: 'flex', gap: 10 }}>
              <Btn onClick={doSend} disabled={sending} style={{ flex: 1, padding: 13 }}>
                {sending ? 'Sending...' : 'Send Email + Resume →'}
              </Btn>
              <Btn variant="ghost" onClick={() => setStep('tailor')}>Re-tailor</Btn>
            </div>
          </div>
        )}

        {step === 'sent' && (
          <div style={{ textAlign: 'center', padding: '50px 0' }}>
            <div style={{ color: 'var(--accent)', fontSize: 40, marginBottom: 16 }}>✓</div>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Application Sent!</div>
            <div style={{ color: 'var(--text2)', fontSize: 14, marginBottom: 6 }}>Email + tailored resume delivered to {toEmail}</div>
            <div style={{ color: 'var(--text3)', fontSize: 13, marginBottom: 28 }}>{job.title} at {job.company}</div>
            <Btn variant="ghost" onClick={onClose}>Done</Btn>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Job Card ──────────────────────────────────────────────────
function JobCard({ job, onApply }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      className="fade-up"
      style={{
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '18px 20px', marginBottom: 10,
        cursor: 'pointer', transition: 'border 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-active)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, paddingRight: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <Tag>{job.source}</Tag>
            <span style={{ color: 'var(--text3)', fontSize: 12 }}>{job.location}</span>
            {job.salary && <span style={{ color: 'var(--text2)', fontSize: 12, fontFamily: 'var(--mono)' }}>{job.salary}</span>}
          </div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 3 }}>{job.title}</div>
          <div style={{ color: 'var(--text2)', fontSize: 14 }}>{job.company}</div>
        </div>
        <ScoreBadge score={job.score} />
      </div>

      {expanded && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <div style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>{job.summary}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {job.tags.map(t => <Tag key={t} color="green">{t}</Tag>)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={e => { e.stopPropagation(); onApply(job) }}>
              Tailor + Apply →
            </Btn>
            <a href={job.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
              <Btn variant="ghost">View Listing ↗</Btn>
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Settings Panel ────────────────────────────────────────────
function SettingsPanel({ settings, setSettings }) {
  const [saved, setSaved] = useState(false)
  const save = () => {
    localStorage.setItem('ra_settings', JSON.stringify(settings))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>Settings</div>
        <div style={{ color: 'var(--text2)', fontSize: 13 }}>Configure your profile, API key, and email credentials.</div>
      </div>

      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 22, marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Anthropic API Key</div>
        <Input
          label="API KEY"
          type="password"
          value={settings.apiKey}
          onChange={e => setSettings(s => ({ ...s, apiKey: e.target.value }))}
          placeholder="sk-ant-..."
        />
        <div style={{ color: 'var(--text3)', fontSize: 12, lineHeight: 1.6 }}>
          Get your key at <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>console.anthropic.com</a>. Never shared or stored on our servers.
        </div>
      </div>

      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 22, marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Gmail (for sending applications)</div>
        <div style={{ color: 'var(--text3)', fontSize: 12, marginBottom: 16 }}>Use a Gmail App Password — <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>generate one here</a>.</div>
        <Input label="GMAIL ADDRESS" value={settings.gmailUser} onChange={e => setSettings(s => ({ ...s, gmailUser: e.target.value }))} placeholder="you@gmail.com" />
        <Input label="APP PASSWORD" type="password" value={settings.gmailPass} onChange={e => setSettings(s => ({ ...s, gmailPass: e.target.value }))} placeholder="xxxx xxxx xxxx xxxx" />
      </div>

      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 22, marginBottom: 24 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Your Resume</div>
        <div style={{ color: 'var(--text3)', fontSize: 12, marginBottom: 14 }}>Paste your master resume here. The AI will tailor it for each job.</div>
        <Input
          label="MASTER RESUME"
          multiline rows={12}
          value={settings.resume}
          onChange={e => setSettings(s => ({ ...s, resume: e.target.value }))}
          placeholder="Paste your full resume here..."
        />
      </div>

      <Btn onClick={save} style={{ padding: '11px 28px' }}>
        {saved ? '✓ Saved' : 'Save Settings'}
      </Btn>
    </div>
  )
}

// ── Applications Tracker ──────────────────────────────────────
function ApplicationsPanel({ applications, setApplications }) {
  const statusColors = { Applied: 'green', Interviewing: 'blue', Rejected: 'red', Saved: 'default' }

  if (applications.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text3)' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>No applications yet</div>
        <div style={{ fontSize: 13 }}>Search for jobs and hit Tailor + Apply to track your progress.</div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Applications</div>
          <div style={{ color: 'var(--text2)', fontSize: 13 }}>{applications.length} tracked</div>
        </div>
      </div>

      {applications.map((app, i) => (
        <div key={i} style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '16px 20px', marginBottom: 10,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 3 }}>{app.title}</div>
            <div style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 6 }}>{app.company}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Tag color={statusColors[app.status] || 'default'}>{app.status}</Tag>
              {app.appliedAt && <span style={{ color: 'var(--text3)', fontSize: 11, fontFamily: 'var(--mono)' }}>{new Date(app.appliedAt).toLocaleDateString()}</span>}
              {app.toEmail && <span style={{ color: 'var(--text3)', fontSize: 11 }}>→ {app.toEmail}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              value={app.status}
              onChange={e => setApplications(prev => prev.map((a, j) => j === i ? { ...a, status: e.target.value } : a))}
              onClick={e => e.stopPropagation()}
              style={{
                background: 'var(--bg3)', border: '1px solid var(--border)',
                color: 'var(--text)', borderRadius: 6, padding: '5px 8px',
                fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)',
              }}
            >
              {['Applied', 'Interviewing', 'Offer', 'Rejected', 'Saved'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main Search Panel ─────────────────────────────────────────
function SearchPanel({ settings, onApply }) {
  const [query, setQuery] = useState('')
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [searched, setSearched] = useState(false)
  const statusRef = useRef(null)

  const STATUS = [
    'Scanning LinkedIn...',
    'Scanning Indeed...',
    'Scanning Y Combinator...',
    'Scanning company career pages...',
    'Ranking by fit score...',
    'Drafting outreach emails...',
  ]
  const [statusIdx, setStatusIdx] = useState(0)

  const search = async () => {
    if (!query.trim()) return
    if (!settings.apiKey) { setErr('Add your Anthropic API key in Settings first.'); return }
    setLoading(true); setJobs([]); setErr(''); setSearched(true); setStatusIdx(0)

    statusRef.current = setInterval(() => {
      setStatusIdx(i => Math.min(i + 1, STATUS.length - 1))
    }, 700)

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, apiKey: settings.apiKey })
      })
      const data = await res.json()
      clearInterval(statusRef.current)
      if (data.error) throw new Error(data.error)
      setJobs(data.jobs)
    } catch (e) {
      clearInterval(statusRef.current)
      setErr(e.message)
    }
    setLoading(false)
  }

  return (
    <div>
      {/* Search bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !loading && search()}
          placeholder="e.g. AI sales, enterprise SaaS AE, VP Sales fintech..."
          style={{
            flex: 1, background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '12px 18px', color: 'var(--text)',
            fontSize: 15, outline: 'none', fontFamily: 'var(--font)',
          }}
        />
        <Btn onClick={search} disabled={loading} style={{ padding: '12px 24px', fontSize: 14 }}>
          {loading ? 'Searching...' : 'Search →'}
        </Btn>
      </div>

      {/* Status log */}
      {loading && (
        <div style={{
          background: 'var(--bg2)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '16px 20px', marginBottom: 24,
        }}>
          <div style={{ color: 'var(--text3)', fontSize: 10, fontFamily: 'var(--mono)', letterSpacing: 2, marginBottom: 12 }}>AGENT LOG</div>
          {STATUS.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
              <span style={{ color: i <= statusIdx ? 'var(--accent)' : 'var(--text3)', fontSize: 12, fontFamily: 'var(--mono)', minWidth: 14 }}>
                {i < statusIdx ? '✓' : i === statusIdx ? '›' : '○'}
              </span>
              <span style={{ color: i <= statusIdx ? 'var(--text2)' : 'var(--text3)', fontSize: 12, fontFamily: 'var(--mono)' }}>{s}</span>
            </div>
          ))}
        </div>
      )}

      {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 16, padding: '12px 16px', background: 'rgba(255,77,77,0.08)', borderRadius: 10 }}>{err}</div>}

      {/* Results */}
      {jobs.length > 0 && (
        <div>
          <div style={{ color: 'var(--text3)', fontSize: 11, fontFamily: 'var(--mono)', marginBottom: 14, letterSpacing: 1 }}>
            {jobs.length} MATCHES — CLICK TO EXPAND
          </div>
          {jobs.map((job, i) => (
            <JobCard key={i} job={job} onApply={onApply} />
          ))}
        </div>
      )}

      {!loading && !searched && (
        <div style={{ textAlign: 'center', paddingTop: 60, color: 'var(--text3)' }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>🔍</div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Search any job type</div>
          <div style={{ fontSize: 13 }}>AI sales · SaaS AE · VP Marketing · Channel Manager · and more</div>
        </div>
      )}
    </div>
  )
}

// ── Root App ──────────────────────────────────────────────────
export default function Home() {
  const [tab, setTab] = useState('Search')
  const [applyJob, setApplyJob] = useState(null)
  const [applications, setApplications] = useState([])
  const [settings, setSettings] = useState({
    apiKey: '', gmailUser: '', gmailPass: '', resume: ''
  })

  useEffect(() => {
    try {
      const saved = localStorage.getItem('ra_settings')
      if (saved) setSettings(JSON.parse(saved))
      const apps = localStorage.getItem('ra_applications')
      if (apps) setApplications(JSON.parse(apps))
    } catch {}
  }, [])

  useEffect(() => {
    if (applications.length > 0) {
      localStorage.setItem('ra_applications', JSON.stringify(applications))
    }
  }, [applications])

  const handleApplied = (job) => {
    setApplications(prev => [job, ...prev.filter(a => a.company !== job.company || a.title !== job.title)])
    setApplyJob(null)
  }

  return (
    <>
      <Head>
        <title>ResumeAgent — AI Job Search</title>
        <meta name="description" content="AI-powered job search, resume tailoring, and outreach" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚡</text></svg>" />
      </Head>

      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {/* Nav */}
        <nav style={{
          borderBottom: '1px solid var(--border)',
          padding: '0 28px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          height: 56, position: 'sticky', top: 0,
          background: 'rgba(8,8,8,0.92)', backdropFilter: 'blur(12px)',
          zIndex: 50,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚡</span>
            <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: -0.5 }}>ResumeAgent</span>
            <span style={{ color: 'var(--accent)', fontSize: 10, fontFamily: 'var(--mono)', background: 'rgba(200,241,53,0.1)', padding: '2px 8px', borderRadius: 20, marginLeft: 4 }}>BETA</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                background: tab === t ? 'var(--bg3)' : 'transparent',
                border: 'none', color: tab === t ? 'var(--text)' : 'var(--text3)',
                padding: '6px 14px', borderRadius: 8, fontSize: 13,
                fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)',
                transition: 'all 0.15s',
              }}>
                {t}
                {t === 'Applications' && applications.length > 0 && (
                  <span style={{ marginLeft: 6, background: 'var(--accent)', color: '#080808', fontSize: 10, padding: '1px 6px', borderRadius: 20, fontFamily: 'var(--mono)' }}>
                    {applications.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>

        {/* Main */}
        <main style={{ flex: 1, padding: '32px 28px', maxWidth: 780, width: '100%', margin: '0 auto' }}>
          {tab === 'Search' && <SearchPanel settings={settings} onApply={setApplyJob} />}
          {tab === 'Applications' && <ApplicationsPanel applications={applications} setApplications={setApplications} />}
          {tab === 'Settings' && <SettingsPanel settings={settings} setSettings={setSettings} />}
        </main>

        {/* Footer */}
        <footer style={{ borderTop: '1px solid var(--border)', padding: '16px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ color: 'var(--text3)', fontSize: 12, fontFamily: 'var(--mono)' }}>© 2025 Brian Burge / ResumeAgent. All rights reserved.</span>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <a href="/terms" style={{ color: 'var(--text3)', fontSize: 12, textDecoration: 'none' }} onMouseEnter={e => e.target.style.color='var(--text)'} onMouseLeave={e => e.target.style.color='var(--text3)'}>Terms of Service</a>
            <span style={{ color: 'var(--text3)', fontSize: 12 }}>Powered by Claude AI</span>
          </div>
        </footer>
      </div>

      {applyJob && (
        <ApplyModal
          job={applyJob}
          settings={settings}
          onClose={() => setApplyJob(null)}
          onSaved={handleApplied}
        />
      )}
    </>
  )
}
