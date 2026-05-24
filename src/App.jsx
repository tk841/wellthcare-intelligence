import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || '',
  import.meta.env.VITE_SUPABASE_ANON_KEY || ''
)

const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY || '',
  dangerouslyAllowBrowser: true
})

const RANK_COLORS = {
  'Agent': '#6b7280',
  'Supervisor': '#3b82f6',
  'Director': '#8b5cf6',
  'Managing Director': '#f59e0b',
  'Executive Director': '#ef4444',
  'Managing Exec. Director': '#10b981'
}

// Map WC status to rank name
function statusToRank(status, depth) {
  if (!status || status === 'none') {
    if (depth === 0) return 'Managing Exec. Director'
    if (depth === 1) return 'Executive Director'
    if (depth === 2) return 'Director'
    return 'Agent'
  }
  const s = String(status).toUpperCase()
  if (s === 'EMPLOYEE') return 'Managing Exec. Director'
  if (s.startsWith('REP')) return 'Agent'
  if (s === 'A') return 'Agent'
  return 'Agent'
}

export default function App() {
  const [tab, setTab] = useState('overview')
  const [agents, setAgents] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [expanded, setExpanded] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({})
  const [uploadStatus, setUploadStatus] = useState('')
  const [aiMsgs, setAiMsgs] = useState([{role:'assistant',content:'Hello! I am your WellthCare Intelligence AI. I can analyze your team, identify top performers, and suggest strategies to maximize compensation. What would you like to know?'}])
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const PAGE_SIZE = 1000

  useEffect(() => { loadAgents() }, [page])
  useEffect(() => { if (agents.length) computeStats() }, [agents])

  async function loadAgents() {
    setLoading(true)
    try {
      const { data, error, count } = await supabase
        .from('agents')
        .select('*', { count: 'exact' })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
        .order('depth', { ascending: true })

      if (error) { console.error(error); setLoading(false); return }
      if (data && data.length > 0) {
        if (page === 0) {
          setAgents(data)
        } else {
          setAgents(prev => [...prev, ...data])
        }
        if (count !== null) setTotalCount(count)
        // Auto-load more pages
        if (data.length === PAGE_SIZE && (page + 1) * PAGE_SIZE < (count || 0)) {
          setPage(p => p + 1)
        }
      }
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  function computeStats() {
    const rankCounts = {}
    let totalLives = 0
    agents.forEach(a => {
      const rank = a.rank || statusToRank(a.notes, a.depth)
      rankCounts[rank] = (rankCounts[rank] || 0) + 1
      if (a.lives) totalLives += Number(a.lives) || 0
    })
    setStats({
      total: agents.length,
      totalCount,
      lives: totalLives,
      rankCounts,
      mds: rankCounts['Managing Director'] || 0,
      eds: rankCounts['Executive Director'] || 0
    })
  }

  function getRank(agent) {
    // The 'rank' field stored is actually the depth level as a string
    // Use notes (status) to determine rank
    return statusToRank(agent.notes, agent.depth)
  }

  function getRankColor(agent) {
    return RANK_COLORS[getRank(agent)] || '#6b7280'
  }

  // Build tree from flat agents array
  function buildTree(agentList) {
    const map = {}
    agentList.forEach(a => { map[a.id] = { ...a, children: [] } })
    const roots = []
    agentList.forEach(a => {
      if (a.parent_id && map[a.parent_id]) {
        map[a.parent_id].children.push(map[a.id])
      } else if (!a.parent_id || !map[a.parent_id]) {
        roots.push(map[a.id])
      }
    })
    return roots
  }

  async function uploadToSupabase() {
    setUploadStatus('Reading WellthCare data...')
    try {
      const raw = localStorage.getItem('wc_hierarchy')
      if (!raw) { setUploadStatus('No hierarchy data found in localStorage. Please open WellthCare portal first.'); return }
      const tree = JSON.parse(raw)
      const agentsList = []
      function flatten(node, parentId, depth) {
        agentsList.push({
          id: String(node.id || '').substring(0, 50),
          name: String(node.name || '').substring(0, 200),
          rank: 'depth_' + depth,
          parent_id: parentId ? String(parentId).substring(0, 50) : null,
          depth,
          notes: node.status || ''
        })
        if (node.children) node.children.forEach(c => flatten(c, node.id, depth + 1))
      }
      flatten(tree, null, 0)
      setUploadStatus('Uploading ' + agentsList.length + ' agents...')
      const chunkSize = 500
      let uploaded = 0
      for (let i = 0; i < agentsList.length; i += chunkSize) {
        const chunk = agentsList.slice(i, i + chunkSize)
        const { error } = await supabase.from('agents').upsert(chunk, { onConflict: 'id' })
        if (!error) uploaded += chunk.length
        setUploadStatus('Uploading... ' + uploaded + '/' + agentsList.length)
      }
      setUploadStatus('Done! Uploaded ' + uploaded + ' agents. Refreshing...')
      setPage(0)
      await loadAgents()
    } catch(e) {
      setUploadStatus('Error: ' + e.message)
    }
  }

  async function sendAiMsg() {
    if (!aiInput.trim() || aiLoading) return
    const userMsg = { role: 'user', content: aiInput }
    setAiMsgs(m => [...m, userMsg])
    setAiInput('')
    setAiLoading(true)
    try {
      const topAgents = agents.slice(0, 50).map(a => a.name + ' (depth:' + a.depth + ', status:' + a.notes + ')')
      const systemPrompt = 'You are an expert WellthCare Intelligence advisor. The team has ' + (stats.totalCount || agents.length) + ' agents total. Rank breakdown: ' + JSON.stringify(stats.rankCounts) + '. Top agents: ' + topAgents.join(', ') + '. WellthCare pay: Agent=70%/$14, Supervisor=80%/$16, Director=90%/$18, MD=100%/$20+$1bonus, ED=100%/$20+$1bonus, MED=100%/$20+$0.50bonus. General overrides: 1st gen 12%, 2nd 6%, 3rd 4%, 4th 3%, 5th 2%, 6th 1%. Analyze the team and give strategic advice.'
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemPrompt }, ...aiMsgs, userMsg]
      })
      setAiMsgs(m => [...m, { role: 'assistant', content: resp.choices[0].message.content }])
    } catch(e) {
      setAiMsgs(m => [...m, { role: 'assistant', content: 'Error: ' + e.message }])
    }
    setAiLoading(false)
  }

  const filteredAgents = search
    ? agents.filter(a => a.name?.toLowerCase().includes(search.toLowerCase()) || a.id?.toLowerCase().includes(search.toLowerCase()))
    : agents

  function HierarchyNode({ node, depth = 0 }) {
    const isExpanded = expanded.has(node.id)
    const hasChildren = node.children && node.children.length > 0
    const color = getRankColor(node)
    return (
      <div style={{ marginLeft: depth * 20 + 'px' }}>
        <div
          onClick={() => {
            setSelected(node)
            if (hasChildren) {
              setExpanded(e => {
                const ne = new Set(e)
                ne.has(node.id) ? ne.delete(node.id) : ne.add(node.id)
                return ne
              })
            }
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px',
            cursor: 'pointer', borderRadius: '6px', marginBottom: '2px',
            background: selected?.id === node.id ? '#e0e7ff' : 'transparent',
            borderLeft: '3px solid ' + color
          }}
        >
          <span style={{ fontSize: '12px', color: '#9ca3af', width: '16px' }}>
            {hasChildren ? (isExpanded ? '▼' : '▶') : '·'}
          </span>
          <span style={{ fontWeight: 500, fontSize: '14px' }}>{node.name}</span>
          <span style={{ fontSize: '11px', color, marginLeft: 'auto', background: color + '20', padding: '1px 6px', borderRadius: '10px' }}>
            {getRank(node)}
          </span>
          {hasChildren && <span style={{ fontSize: '11px', color: '#9ca3af' }}>{node.children.length} direct</span>}
        </div>
        {isExpanded && hasChildren && node.children.map(c => <HierarchyNode key={c.id} node={c} depth={depth + 1} />)}
      </div>
    )
  }

  const RANKS = ['Agent','Supervisor','Director','Managing Director','Executive Director','Managing Exec. Director']

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: 36, height: 36, background: '#6366f1', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold' }}>W</div>
          <div>
            <div style={{ color: 'white', fontWeight: 700, fontSize: '18px' }}>WellthCare Intelligence</div>
            <div style={{ color: '#a5b4fc', fontSize: '12px' }}>{loading ? 'Loading...' : (stats.totalCount || agents.length) + ' agents loaded'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {['overview','hierarchy','compensation','ai-advisor'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '6px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontWeight: 500, fontSize: '13px',
              background: tab === t ? 'white' : 'transparent',
              color: tab === t ? '#312e81' : 'white'
            }}>{t === 'ai-advisor' ? 'AI Advisor' : t.charAt(0).toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '24px' }}>
        {/* OVERVIEW TAB */}
        {tab === 'overview' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px', marginBottom: '24px' }}>
              {[
                { label: 'Total Agents', value: stats.totalCount || agents.length, icon: '👥', color: '#6366f1' },
                { label: 'Total Lives', value: stats.lives || 0, icon: '💚', color: '#10b981' },
                { label: 'Mgmt Directors', value: stats.mds || 0, icon: '⭐', color: '#f59e0b' },
                { label: 'Exec Directors', value: stats.eds || 0, icon: '🏆', color: '#ef4444' }
              ].map(c => (
                <div key={c.label} style={{ background: 'white', borderRadius: '12px', padding: '20px', border: '1px solid #e5e7eb', borderTop: '4px solid ' + c.color }}>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>{c.icon}</div>
                  <div style={{ fontSize: '32px', fontWeight: 700, color: c.color }}>{c.value.toLocaleString()}</div>
                  <div style={{ color: '#6b7280', fontSize: '14px' }}>{c.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ background: 'white', borderRadius: '12px', padding: '20px', border: '1px solid #e5e7eb' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 600 }}>Distribution by Status</h3>
                {Object.entries(stats.rankCounts || {}).map(([rank, count]) => (
                  <div key={rank} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <span style={{ color: RANK_COLORS[rank] || '#6b7280', fontWeight: 500 }}>{rank}</span>
                    <span style={{ color: '#374151' }}>{count} ({((count/(stats.total||1))*100).toFixed(1)}%)</span>
                  </div>
                ))}
              </div>
              <div style={{ background: 'white', borderRadius: '12px', padding: '20px', border: '1px solid #e5e7eb' }}>
                <h3 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Data Sync</h3>
                <p style={{ color: '#6b7280', fontSize: '14px', margin: '0 0 16px' }}>
                  Upload the hierarchy from your WellthCare portal session to Supabase for persistent cloud storage and API access.
                </p>
                <button onClick={uploadToSupabase} style={{
                  width: '100%', padding: '12px', background: '#4f46e5', color: 'white',
                  border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '14px'
                }}>Sync Hierarchy to Supabase</button>
                {uploadStatus && <p style={{ margin: '12px 0 0', fontSize: '13px', color: uploadStatus.includes('Error') ? '#ef4444' : '#059669' }}>{uploadStatus}</p>}
                <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#9ca3af' }}>Supabase Project: {import.meta.env.VITE_SUPABASE_URL?.split('//')[1]?.split('.')[0]}</p>
              </div>
            </div>
          </div>
        )}

        {/* HIERARCHY TAB */}
        {tab === 'hierarchy' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '16px' }}>
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
                <input
                  value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search agents by name or ID..."
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ padding: '16px', maxHeight: '70vh', overflow: 'auto' }}>
                {search ? (
                  filteredAgents.map(a => (
                    <div key={a.id} onClick={() => setSelected(a)} style={{
                      padding: '8px 12px', cursor: 'pointer', borderRadius: '6px',
                      background: selected?.id === a.id ? '#e0e7ff' : 'transparent',
                      borderLeft: '3px solid ' + getRankColor(a), marginBottom: '4px'
                    }}>
                      <div style={{ fontWeight: 500 }}>{a.name}</div>
                      <div style={{ fontSize: '12px', color: '#9ca3af' }}>{a.id} · Depth {a.depth} · {a.notes}</div>
                    </div>
                  ))
                ) : (
                  buildTree(agents).map(root => <HierarchyNode key={root.id} node={root} depth={0} />)
                )}
              </div>
            </div>
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', padding: '20px' }}>
              {selected ? (
                <div>
                  <div style={{ width: 48, height: 48, borderRadius: '50%', background: getRankColor(selected) + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
                    <span style={{ fontSize: '20px', color: getRankColor(selected), fontWeight: 700 }}>{selected.name?.[0]}</span>
                  </div>
                  <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 700 }}>{selected.name}</h3>
                  <div style={{ color: getRankColor(selected), fontWeight: 600, marginBottom: '16px' }}>{getRank(selected)}</div>
                  {[
                    ['Agent ID', selected.id],
                    ['Status', selected.notes],
                    ['Hierarchy Depth', selected.depth],
                    ['Parent ID', selected.parent_id || 'Root'],
                    ['Lives', selected.lives || 'N/A'],
                    ['Production', selected.production || 'N/A']
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                      <span style={{ color: '#6b7280', fontSize: '13px' }}>{k}</span>
                      <span style={{ fontWeight: 500, fontSize: '13px' }}>{v}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: '#9ca3af', paddingTop: '40px' }}>
                  <div style={{ fontSize: '40px', marginBottom: '12px' }}>👆</div>
                  <p>Click any agent to see details</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* COMPENSATION TAB */}
        {tab === 'compensation' && (
          <div>
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', padding: '24px', marginBottom: '16px' }}>
              <h2 style={{ margin: '0 0 20px', fontSize: '20px', fontWeight: 700 }}>Agent Compensation & Promotion</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Paid As Rank','Percent','$/Life PEPM','Pay Increase/Level','Requirement for Promotion'].map(h => (
                      <th key={h} style={{ padding: '12px', textAlign: 'left', fontSize: '13px', color: '#374151', fontWeight: 600, borderBottom: '2px solid #e5e7eb' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Agent','70%','$14','N/A','Starting rank','#6b7280'],
                    ['Supervisor','80%','$16','+$2','100 Lives','#3b82f6'],
                    ['Director','90%','$18','+$2','3 Companies + 500 Lives','#8b5cf6'],
                    ['Managing Director','100%','$20','+$2 +$1 MD Bonus','500 Lives + 2 Supervisors','#f59e0b'],
                    ['Executive Director','100%','$20','$1 ED Bonus','4 Sup OR 2 Sup + 1 Dir','#ef4444'],
                    ['Managing Exec. Director','100%','$20','$0.50 MED Bonus','2 MD + 1 ED','#10b981']
                  ].map(([rank, pct, pay, increase, req, color]) => (
                    <tr key={rank} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '12px', fontWeight: 600, color }}>{rank}</td>
                      <td style={{ padding: '12px', color: '#374151' }}>{pct}</td>
                      <td style={{ padding: '12px', color: '#374151' }}>{pay}</td>
                      <td style={{ padding: '12px', color: '#374151' }}>{increase}</td>
                      <td style={{ padding: '12px', color: '#374151' }}>{req}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', padding: '24px' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>General Overrides</h3>
                {[['1st Gen','12%'],['2nd Gen','6%'],['3rd Gen','4%'],['4th Gen','3%'],['5th Gen','2%'],['6th Gen','1%']].map(([gen, pct]) => (
                  <div key={gen} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <span style={{ color: '#374151' }}>{gen}</span>
                    <span style={{ fontWeight: 600, color: '#4f46e5' }}>{pct}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', padding: '24px' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Bonus Pools</h3>
                {[
                  { name: 'Partner Pool', amount: '$2.50 PEPM', reqs: ['Personally have 100 lives', '1 New client in last 90 days'], color: '#6366f1' },
                  { name: 'Founders Pool', amount: '$2.50 PEPM', reqs: ['Achieve Executive Director within 1 year'], color: '#f59e0b' }
                ].map(p => (
                  <div key={p.name} style={{ background: p.color, borderRadius: '8px', padding: '16px', marginBottom: '12px', color: 'white' }}>
                    <div style={{ fontWeight: 700, fontSize: '16px' }}>{p.name}</div>
                    <div style={{ fontSize: '24px', fontWeight: 700, margin: '4px 0' }}>{p.amount}</div>
                    {p.reqs.map(r => <div key={r} style={{ fontSize: '13px', opacity: 0.9 }}>• {r}</div>)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* AI ADVISOR TAB */}
        {tab === 'ai-advisor' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '16px' }}>
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', height: '75vh' }}>
              <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb' }}>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>🤖 WellthCare AI Advisor</h3>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6b7280' }}>Powered by GPT-4o · Analyzing {stats.totalCount || agents.length} agents</p>
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {aiMsgs.map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '80%', padding: '10px 14px', borderRadius: '12px', fontSize: '14px', lineHeight: 1.5,
                      background: m.role === 'user' ? '#4f46e5' : '#f3f4f6',
                      color: m.role === 'user' ? 'white' : '#374151'
                    }}>{m.content}</div>
                  </div>
                ))}
                {aiLoading && <div style={{ color: '#9ca3af', fontSize: '14px' }}>AI is thinking...</div>}
              </div>
              <div style={{ padding: '16px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '8px' }}>
                <input
                  value={aiInput} onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendAiMsg()}
                  placeholder="Ask about your team..."
                  style={{ flex: 1, padding: '10px 14px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px' }}
                />
                <button onClick={sendAiMsg} disabled={aiLoading} style={{
                  padding: '10px 20px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600
                }}>Send</button>
              </div>
            </div>
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', padding: '16px' }}>
              <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Quick Analysis</h3>
              {[
                'Who is close to becoming Managing Director?',
                'Who are the top 10 producers?',
                'How can I maximize override income?',
                'Analyze the full hierarchy structure',
                'Who should I focus on to grow the team?',
                'Explain the MD breakaway system'
              ].map(q => (
                <button key={q} onClick={() => { setAiInput(q); setTab('ai-advisor') }} style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
                  background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: '6px',
                  cursor: 'pointer', fontSize: '12px', color: '#374151', marginBottom: '8px'
                }}>{q}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
        }
