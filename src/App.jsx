import { useState, useEffect, useRef, useCallback } from 'react'
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
  'Agent': '#6b7280', 'Supervisor': '#3b82f6', 'Director': '#8b5cf6',
  'Managing Director': '#f59e0b', 'Executive Director': '#ef4444', 'Managing Exec. Director': '#10b981'
}
const RANK_SHORT = {
  'Agent':'Agent','Supervisor':'Supervisor','Director':'Director',
  'Managing Director':'MD','Executive Director':'ED','Managing Exec. Director':'MED'
}

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
  // Org chart state
  const [orgZoom, setOrgZoom] = useState(1)
  const [orgSearch, setOrgSearch] = useState('')
  const [orgCollapsed, setOrgCollapsed] = useState(new Set())
  const [orgMaxDepth, setOrgMaxDepth] = useState(null)
  const [orgPan, setOrgPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef(null)
  const orgRef = useRef(null)
  const PAGE_SIZE = 1000

  useEffect(() => { loadAgents() }, [page])
  useEffect(() => { if (agents.length) computeStats() }, [agents])

  async function loadAgents() {
    setLoading(true)
    try {
      const { data, error, count } = await supabase
        .from('agents').select('*', { count: 'exact' })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
        .order('depth', { ascending: true })
      if (error) { setLoading(false); return }
      if (data && data.length > 0) {
        if (page === 0) setAgents(data)
        else setAgents(prev => [...prev, ...data])
        if (count !== null) setTotalCount(count)
        if (data.length === PAGE_SIZE && (page + 1) * PAGE_SIZE < (count || 0)) setPage(p => p + 1)
      }
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  function computeStats() {
    const rankCounts = {}
    let totalLives = 0
    agents.forEach(a => {
      const rank = statusToRank(a.notes, a.depth)
      rankCounts[rank] = (rankCounts[rank] || 0) + 1
      if (a.lives) totalLives += Number(a.lives) || 0
    })
    setStats({ total: agents.length, totalCount, lives: totalLives, rankCounts,
      mds: rankCounts['Managing Director'] || 0, eds: rankCounts['Executive Director'] || 0 })
  }

  function getRank(agent) { return statusToRank(agent.notes, agent.depth) }
  function getRankColor(agent) { return RANK_COLORS[getRank(agent)] || '#6b7280' }

  function buildTree(agentList) {
    const map = {}
    agentList.forEach(a => { map[a.id] = { ...a, children: [] } })
    const roots = []
    agentList.forEach(a => {
      if (a.parent_id && map[a.parent_id]) map[a.parent_id].children.push(map[a.id])
      else roots.push(map[a.id])
    })
    return roots
  }
  async function uploadToSupabase() {
    setUploadStatus('Reading WellthCare data...')
    try {
      const raw = localStorage.getItem('wc_hierarchy')
      if (!raw) { setUploadStatus('No hierarchy data found. Please open WellthCare portal first.'); return }
      const tree = JSON.parse(raw)
      const agentsList = []
      function flatten(node, parentId, depth) {
        agentsList.push({ id: String(node.id||'').substring(0,50), name: String(node.name||'').substring(0,200),
          rank: 'depth_'+depth, parent_id: parentId ? String(parentId).substring(0,50) : null, depth, notes: node.status||'' })
        if (node.children) node.children.forEach(c => flatten(c, node.id, depth+1))
      }
      flatten(tree, null, 0)
      setUploadStatus('Uploading '+agentsList.length+' agents...')
      let uploaded = 0
      for (let i = 0; i < agentsList.length; i += 500) {
        const chunk = agentsList.slice(i, i+500)
        const { error } = await supabase.from('agents').upsert(chunk, { onConflict: 'id' })
        if (!error) uploaded += chunk.length
        setUploadStatus('Uploading... '+uploaded+'/'+agentsList.length)
      }
      setUploadStatus('Done! Uploaded '+uploaded+' agents. Refreshing...')
      setPage(0); await loadAgents()
    } catch(e) { setUploadStatus('Error: '+e.message) }
  }

  async function sendAiMsg() {
    if (!aiInput.trim() || aiLoading) return
    const userMsg = { role: 'user', content: aiInput }
    setAiMsgs(m => [...m, userMsg]); setAiInput(''); setAiLoading(true)
    try {
      const topAgents = agents.slice(0,50).map(a => a.name+' (depth:'+a.depth+', status:'+a.notes+')')
      const systemPrompt = 'You are an expert WellthCare Intelligence advisor. Team has '+(stats.totalCount||agents.length)+' agents. Ranks: '+JSON.stringify(stats.rankCounts)+'. Top agents: '+topAgents.join(', ')+'. WellthCare pay: Agent=70%/$14, Supervisor=80%/$16, Director=90%/$18, MD=100%/$20+$1, ED=100%/$20+$1, MED=100%/$20+$0.50. Overrides: 1st 12%, 2nd 6%, 3rd 4%, 4th 3%, 5th 2%, 6th 1%.'
      const resp = await openai.chat.completions.create({ model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemPrompt }, ...aiMsgs, userMsg] })
      setAiMsgs(m => [...m, { role: 'assistant', content: resp.choices[0].message.content }])
    } catch(e) { setAiMsgs(m => [...m, { role: 'assistant', content: 'Error: '+e.message }]) }
    setAiLoading(false)
  }

  // ORG CHART functions
  function handleMouseDown(e) {
    if (e.button !== 0) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX - orgPan.x, y: e.clientY - orgPan.y }
  }
  function handleMouseMove(e) {
    if (!isDragging || !dragStart.current) return
    setOrgPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y })
  }
  function handleMouseUp() { setIsDragging(false); dragStart.current = null }

  function toggleOrgNode(id) {
    setOrgCollapsed(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function collapseAll() {
    const allIds = agents.filter(a => a.depth < (orgMaxDepth || 99)).map(a => a.id)
    setOrgCollapsed(new Set(allIds))
  }
  function expandAll() { setOrgCollapsed(new Set()) }

  // Render org chart node recursively
  function OrgNode({ node, depth }) {
    const rank = getRank(node)
    const color = RANK_COLORS[rank] || '#6b7280'
    const hasChildren = node.children && node.children.length > 0
    const isCollapsed = orgCollapsed.has(node.id)
    const maxD = orgMaxDepth
    const shouldShow = maxD === null || depth <= maxD

    const nameMatch = orgSearch && node.name?.toLowerCase().includes(orgSearch.toLowerCase())
    const highlight = nameMatch ? '#fef3c7' : 'white'

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 8px' }}>
        {/* Card */}
        <div
          onClick={() => { setSelected(node); if (hasChildren) toggleOrgNode(node.id) }}
          style={{
            border: '2px solid '+(nameMatch ? '#f59e0b' : color),
            borderRadius: '10px', background: highlight, padding: '10px 14px',
            minWidth: '140px', maxWidth: '180px', cursor: 'pointer', userSelect: 'none',
            boxShadow: selected?.id === node.id ? '0 0 0 3px '+color+'60' : '0 2px 6px rgba(0,0,0,0.1)',
            position: 'relative', textAlign: 'center', transition: 'box-shadow 0.15s'
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '13px', color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</div>
          <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{node.id}</div>
          <div style={{ display: 'inline-block', background: color+'20', color, borderRadius: '10px', padding: '2px 8px', fontSize: '11px', fontWeight: 600, marginTop: '4px' }}>
            {RANK_SHORT[rank] || rank}
          </div>
          {hasChildren && (
            <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
              {node.children.length} reports
            </div>
          )}
          {hasChildren && (
            <div
              onClick={e => { e.stopPropagation(); toggleOrgNode(node.id) }}
              style={{
                position: 'absolute', bottom: '-14px', left: '50%', transform: 'translateX(-50%)',
                width: '22px', height: '22px', borderRadius: '50%', background: color,
                color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '14px', fontWeight: 700, cursor: 'pointer', zIndex: 10, boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
              }}
            >{isCollapsed ? '+' : '−'}</div>
          )}
        </div>

        {/* Children */}
        {hasChildren && !isCollapsed && shouldShow && (
          <div style={{ marginTop: '28px', position: 'relative' }}>
            {/* Vertical line down */}
            <div style={{ width: '2px', height: '20px', background: '#d1d5db', margin: '0 auto' }} />
            {/* Horizontal line spanning children */}
            {node.children.length > 1 && (
              <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                <div style={{
                  position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
                  width: 'calc(100% - 140px)', height: '2px', background: '#d1d5db'
                }} />
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '0' }}>
              {node.children.map(child => (
                <div key={child.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: '2px', height: '20px', background: '#d1d5db' }} />
                  <OrgNode node={child} depth={depth + 1} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
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
        <div onClick={() => { setSelected(node); if (hasChildren) setExpanded(e => { const ne=new Set(e); ne.has(node.id)?ne.delete(node.id):ne.add(node.id); return ne }) }}
          style={{ display:'flex', alignItems:'center', gap:'8px', padding:'6px 10px', cursor:'pointer', borderRadius:'6px', marginBottom:'2px',
            background: selected?.id===node.id ? '#e0e7ff' : 'transparent', borderLeft:'3px solid '+color }}>
          <span style={{ fontSize:'12px', color:'#9ca3af', width:'16px' }}>{hasChildren?(isExpanded?'▼':'▶'):'·'}</span>
          <span style={{ fontWeight:500, fontSize:'14px' }}>{node.name}</span>
          <span style={{ fontSize:'11px', color, marginLeft:'auto', background:color+'20', padding:'1px 6px', borderRadius:'10px' }}>{getRank(node)}</span>
          {hasChildren && <span style={{ fontSize:'11px', color:'#9ca3af' }}>{node.children.length} direct</span>}
        </div>
        {isExpanded && hasChildren && node.children.map(c => <HierarchyNode key={c.id} node={c} depth={depth+1} />)}
      </div>
    )
  }

  const TABS = [
    { id:'overview', label:'Overview' },
    { id:'org-chart', label:'Org Chart' },
    { id:'hierarchy', label:'Hierarchy' },
    { id:'compensation', label:'Compensation' },
    { id:'ai-advisor', label:'AI Advisor' }
  ]

  // Build org chart tree from first 2000 agents for performance
  const orgAgents = orgSearch
    ? agents.filter(a => a.name?.toLowerCase().includes(orgSearch.toLowerCase()))
    : agents
  const orgTree = buildTree(orgAgents.slice(0, 2000))

  return (
    <div style={{ minHeight:'100vh', background:'#f8fafc', fontFamily:'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background:'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)', padding:'12px 24px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
          <div style={{ width:36, height:36, background:'#6366f1', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:'bold' }}>W</div>
          <div>
            <div style={{ color:'white', fontWeight:700, fontSize:'18px' }}>WellthCare Intelligence</div>
            <div style={{ color:'#a5b4fc', fontSize:'12px' }}>{loading ? 'Loading...' : (stats.totalCount||agents.length)+' agents loaded'}</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:'8px' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding:'6px 14px', borderRadius:'6px', border:'none', cursor:'pointer', fontWeight:500, fontSize:'13px',
              background: tab===t.id ? 'white' : 'transparent', color: tab===t.id ? '#312e81' : 'white'
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: tab==='org-chart' ? '0' : '24px' }}>
        {/* ORG CHART TAB */}
        {tab === 'org-chart' && (
          <div style={{ height:'calc(100vh - 60px)', display:'flex', flexDirection:'column', background:'#f1f5f9' }}>
            {/* Org Chart Toolbar */}
            <div style={{ background:'#1e1b4b', padding:'8px 16px', display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
              <span style={{ color:'#a5b4fc', fontWeight:700, fontSize:'14px', marginRight:'4px' }}>◆ WellthCare Org Chart</span>
              <input value={orgSearch} onChange={e => setOrgSearch(e.target.value)}
                placeholder="Search agents..."
                style={{ padding:'5px 12px', borderRadius:'6px', border:'none', fontSize:'13px', width:'180px', background:'#312e81', color:'white', outline:'none' }} />
              <button onClick={() => setOrgZoom(z => Math.min(z+0.1, 2))}
                style={{ padding:'5px 12px', borderRadius:'6px', border:'none', background:'#3730a3', color:'white', cursor:'pointer', fontSize:'12px', fontWeight:600 }}>+ Zoom In</button>
              <button onClick={() => setOrgZoom(z => Math.max(z-0.1, 0.3))}
                style={{ padding:'5px 12px', borderRadius:'6px', border:'none', background:'#3730a3', color:'white', cursor:'pointer', fontSize:'12px', fontWeight:600 }}>− Zoom Out</button>
              <button onClick={() => { setOrgZoom(1); setOrgPan({x:0,y:0}); expandAll() }}
                style={{ padding:'5px 12px', borderRadius:'6px', border:'none', background:'#3730a3', color:'white', cursor:'pointer', fontSize:'12px', fontWeight:600 }}>↺ Reset</button>
              <button onClick={() => setOrgMaxDepth(2)}
                style={{ padding:'5px 12px', borderRadius:'6px', border:'none', background: orgMaxDepth===2 ? '#6366f1' : '#3730a3', color:'white', cursor:'pointer', fontSize:'12px', fontWeight:600 }}>Level 2</button>
              <button onClick={() => setOrgMaxDepth(3)}
                style={{ padding:'5px 12px', borderRadius:'6px', border:'none', background: orgMaxDepth===3 ? '#6366f1' : '#3730a3', color:'white', cursor:'pointer', fontSize:'12px', fontWeight:600 }}>Level 3</button>
              <button onClick={() => setOrgMaxDepth(null)}
                style={{ padding:'5px 12px', borderRadius:'6px', border:'none', background: orgMaxDepth===null ? '#6366f1' : '#3730a3', color:'white', cursor:'pointer', fontSize:'12px', fontWeight:600 }}>All Levels</button>
              <button onClick={collapseAll}
                style={{ padding:'5px 12px', borderRadius:'6px', border:'none', background:'#3730a3', color:'white', cursor:'pointer', fontSize:'12px', fontWeight:600 }}>Collapse All</button>
              <span style={{ color:'#a5b4fc', fontSize:'12px', marginLeft:'4px' }}>{Math.round(orgZoom*100)}%</span>
              {/* Legend */}
              <div style={{ marginLeft:'auto', display:'flex', gap:'8px', alignItems:'center' }}>
                {Object.entries(RANK_COLORS).map(([rank, color]) => (
                  <span key={rank} style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'11px', color:'white' }}>
                    <span style={{ width:10, height:10, borderRadius:'2px', background:color, display:'inline-block' }}></span>
                    {RANK_SHORT[rank]}
                  </span>
                ))}
              </div>
            </div>

            {/* Selected agent detail bar */}
            {selected && (
              <div style={{ background:'white', borderBottom:'1px solid #e5e7eb', padding:'8px 20px', display:'flex', alignItems:'center', gap:'16px' }}>
                <div style={{ width:32, height:32, borderRadius:'50%', background:getRankColor(selected)+'20', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, color:getRankColor(selected) }}>{selected.name?.[0]}</div>
                <div>
                  <div style={{ fontWeight:700, fontSize:'14px' }}>{selected.name}</div>
                  <div style={{ fontSize:'12px', color:'#6b7280' }}>{selected.id} · {getRank(selected)} · Depth {selected.depth}</div>
                </div>
                <button onClick={() => setSelected(null)} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:'18px' }}>×</button>
              </div>
            )}

            {/* Org Chart Canvas */}
            <div
              ref={orgRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ flex:1, overflow:'hidden', cursor: isDragging ? 'grabbing' : 'grab', position:'relative' }}
            >
              <div style={{
                transform: 'translate('+orgPan.x+'px, '+orgPan.y+'px) scale('+orgZoom+')',
                transformOrigin: '50% 0',
                padding: '40px 60px',
                display: 'inline-flex',
                minWidth: '100%'
              }}>
                {orgTree.map(root => <OrgNode key={root.id} node={root} depth={0} />)}
              </div>
            </div>
          </div>
        )}
        {/* OVERVIEW TAB */}
        {tab === 'overview' && (
          <div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'16px', marginBottom:'24px' }}>
              {[
                { label:'Total Agents', value:(stats.totalCount||agents.length), icon:'👥', color:'#6366f1' },
                { label:'Total Lives', value:(stats.lives||0), icon:'💚', color:'#10b981' },
                { label:'Mgmt Directors', value:(stats.mds||0), icon:'⭐', color:'#f59e0b' },
                { label:'Exec Directors', value:(stats.eds||0), icon:'🏆', color:'#ef4444' }
              ].map(c => (
                <div key={c.label} style={{ background:'white', borderRadius:'12px', padding:'20px', border:'1px solid #e5e7eb', borderTop:'4px solid '+c.color }}>
                  <div style={{ fontSize:'28px', marginBottom:'8px' }}>{c.icon}</div>
                  <div style={{ fontSize:'32px', fontWeight:700, color:c.color }}>{c.value.toLocaleString()}</div>
                  <div style={{ color:'#6b7280', fontSize:'14px' }}>{c.label}</div>
                </div>
              ))}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
              <div style={{ background:'white', borderRadius:'12px', padding:'20px', border:'1px solid #e5e7eb' }}>
                <h3 style={{ margin:'0 0 16px', fontSize:'16px', fontWeight:600 }}>Distribution by Status</h3>
                {Object.entries(stats.rankCounts||{}).map(([rank,count]) => (
                  <div key={rank} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #f3f4f6' }}>
                    <span style={{ color:RANK_COLORS[rank]||'#6b7280', fontWeight:500 }}>{rank}</span>
                    <span style={{ color:'#374151' }}>{count} ({((count/(stats.total||1))*100).toFixed(1)}%)</span>
                  </div>
                ))}
              </div>
              <div style={{ background:'white', borderRadius:'12px', padding:'20px', border:'1px solid #e5e7eb' }}>
                <h3 style={{ margin:'0 0 12px', fontSize:'16px', fontWeight:600 }}>Data Sync</h3>
                <p style={{ color:'#6b7280', fontSize:'14px', margin:'0 0 16px' }}>Upload the hierarchy from your WellthCare portal session to Supabase for persistent cloud storage.</p>
                <button onClick={uploadToSupabase} style={{ width:'100%', padding:'12px', background:'#4f46e5', color:'white', border:'none', borderRadius:'8px', fontWeight:600, cursor:'pointer', fontSize:'14px' }}>Sync Hierarchy to Supabase</button>
                {uploadStatus && <p style={{ margin:'12px 0 0', fontSize:'13px', color:uploadStatus.includes('Error')?'#ef4444':'#059669' }}>{uploadStatus}</p>}
                <p style={{ margin:'8px 0 0', fontSize:'12px', color:'#9ca3af' }}>Supabase Project: {import.meta.env.VITE_SUPABASE_URL?.split('//')[1]?.split('.')[0]}</p>
              </div>
            </div>
          </div>
        )}

        {/* HIERARCHY TAB */}
        {tab === 'hierarchy' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:'16px' }}>
            <div style={{ background:'white', borderRadius:'12px', border:'1px solid #e5e7eb', overflow:'hidden' }}>
              <div style={{ padding:'16px', borderBottom:'1px solid #e5e7eb' }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search agents by name or ID..."
                  style={{ width:'100%', padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:'8px', fontSize:'14px', boxSizing:'border-box' }} />
              </div>
              <div style={{ padding:'16px', maxHeight:'70vh', overflow:'auto' }}>
                {search ? (
                  filteredAgents.map(a => (
                    <div key={a.id} onClick={() => setSelected(a)} style={{ padding:'8px 12px', cursor:'pointer', borderRadius:'6px',
                      background:selected?.id===a.id?'#e0e7ff':'transparent', borderLeft:'3px solid '+getRankColor(a), marginBottom:'4px' }}>
                      <div style={{ fontWeight:500 }}>{a.name}</div>
                      <div style={{ fontSize:'12px', color:'#9ca3af' }}>{a.id} · Depth {a.depth} · {a.notes}</div>
                    </div>
                  ))
                ) : (
                  buildTree(agents).map(root => <HierarchyNode key={root.id} node={root} depth={0} />)
                )}
              </div>
            </div>
            <div style={{ background:'white', borderRadius:'12px', border:'1px solid #e5e7eb', padding:'20px' }}>
              {selected ? (
                <div>
                  <div style={{ width:48, height:48, borderRadius:'50%', background:getRankColor(selected)+'20', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:'12px' }}>
                    <span style={{ fontSize:'20px', color:getRankColor(selected), fontWeight:700 }}>{selected.name?.[0]}</span>
                  </div>
                  <h3 style={{ margin:'0 0 4px', fontSize:'18px', fontWeight:700 }}>{selected.name}</h3>
                  <div style={{ color:getRankColor(selected), fontWeight:600, marginBottom:'16px' }}>{getRank(selected)}</div>
                  {[['Agent ID',selected.id],['Status',selected.notes],['Hierarchy Depth',selected.depth],['Parent ID',selected.parent_id||'Root'],['Lives',selected.lives||'N/A'],['Production',selected.production||'N/A']].map(([k,v]) => (
                    <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid #f3f4f6' }}>
                      <span style={{ color:'#6b7280', fontSize:'13px' }}>{k}</span>
                      <span style={{ fontWeight:500, fontSize:'13px' }}>{v}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign:'center', color:'#9ca3af', paddingTop:'40px' }}>
                  <div style={{ fontSize:'40px', marginBottom:'12px' }}>👆</div>
                  <p>Click any agent to see details</p>
                </div>
              )}
            </div>
          </div>
        )}
        {/* COMPENSATION TAB */}
        {tab === 'compensation' && (
          <div>
            <div style={{ background:'white', borderRadius:'12px', border:'1px solid #e5e7eb', padding:'24px', marginBottom:'16px' }}>
              <h2 style={{ margin:'0 0 20px', fontSize:'20px', fontWeight:700 }}>Agent Compensation & Promotion</h2>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead>
                  <tr style={{ background:'#f8fafc' }}>
                    {['Paid As Rank','Percent','$/Life PEPM','Pay Increase/Level','Requirement for Promotion'].map(h => (
                      <th key={h} style={{ padding:'12px', textAlign:'left', fontSize:'13px', color:'#374151', fontWeight:600, borderBottom:'2px solid #e5e7eb' }}>{h}</th>
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
                  ].map(([rank,pct,pay,increase,req,color]) => (
                    <tr key={rank} style={{ borderBottom:'1px solid #f3f4f6' }}>
                      <td style={{ padding:'12px', fontWeight:600, color }}>{rank}</td>
                      <td style={{ padding:'12px', color:'#374151' }}>{pct}</td>
                      <td style={{ padding:'12px', color:'#374151' }}>{pay}</td>
                      <td style={{ padding:'12px', color:'#374151' }}>{increase}</td>
                      <td style={{ padding:'12px', color:'#374151' }}>{req}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
              <div style={{ background:'white', borderRadius:'12px', border:'1px solid #e5e7eb', padding:'24px' }}>
                <h3 style={{ margin:'0 0 16px', fontSize:'16px', fontWeight:700 }}>General Overrides</h3>
                {[['1st Gen','12%'],['2nd Gen','6%'],['3rd Gen','4%'],['4th Gen','3%'],['5th Gen','2%'],['6th Gen','1%']].map(([gen,pct]) => (
                  <div key={gen} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #f3f4f6' }}>
                    <span style={{ color:'#374151' }}>{gen}</span>
                    <span style={{ fontWeight:600, color:'#4f46e5' }}>{pct}</span>
                  </div>
                ))}
              </div>
              <div style={{ background:'white', borderRadius:'12px', border:'1px solid #e5e7eb', padding:'24px' }}>
                <h3 style={{ margin:'0 0 16px', fontSize:'16px', fontWeight:700 }}>Bonus Pools</h3>
                {[
                  { name:'Partner Pool', amount:'$2.50 PEPM', reqs:['Personally have 100 lives','1 New client in last 90 days'], color:'#6366f1' },
                  { name:'Founders Pool', amount:'$2.50 PEPM', reqs:['Achieve Executive Director within 1 year'], color:'#f59e0b' }
                ].map(p => (
                  <div key={p.name} style={{ background:p.color, borderRadius:'8px', padding:'16px', marginBottom:'12px', color:'white' }}>
                    <div style={{ fontWeight:700, fontSize:'16px' }}>{p.name}</div>
                    <div style={{ fontSize:'24px', fontWeight:700, margin:'4px 0' }}>{p.amount}</div>
                    {p.reqs.map(r => <div key={r} style={{ fontSize:'13px', opacity:0.9 }}>• {r}</div>)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* AI ADVISOR TAB */}
        {tab === 'ai-advisor' && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 280px', gap:'16px' }}>
            <div style={{ background:'white', borderRadius:'12px', border:'1px solid #e5e7eb', display:'flex', flexDirection:'column', height:'75vh' }}>
              <div style={{ padding:'16px', borderBottom:'1px solid #e5e7eb' }}>
                <h3 style={{ margin:0, fontSize:'16px', fontWeight:700 }}>🤖 WellthCare AI Advisor</h3>
                <p style={{ margin:'4px 0 0', fontSize:'13px', color:'#6b7280' }}>Powered by GPT-4o · Analyzing {stats.totalCount||agents.length} agents</p>
              </div>
              <div style={{ flex:1, overflow:'auto', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
                {aiMsgs.map((m,i) => (
                  <div key={i} style={{ display:'flex', justifyContent:m.role==='user'?'flex-end':'flex-start' }}>
                    <div style={{ maxWidth:'80%', padding:'10px 14px', borderRadius:'12px', fontSize:'14px', lineHeight:1.5,
                      background:m.role==='user'?'#4f46e5':'#f3f4f6', color:m.role==='user'?'white':'#374151' }}>{m.content}</div>
                  </div>
                ))}
                {aiLoading && <div style={{ color:'#9ca3af', fontSize:'14px' }}>AI is thinking...</div>}
              </div>
              <div style={{ padding:'16px', borderTop:'1px solid #e5e7eb', display:'flex', gap:'8px' }}>
                <input value={aiInput} onChange={e => setAiInput(e.target.value)} onKeyDown={e => e.key==='Enter' && sendAiMsg()}
                  placeholder="Ask about your team..."
                  style={{ flex:1, padding:'10px 14px', border:'1px solid #d1d5db', borderRadius:'8px', fontSize:'14px' }} />
                <button onClick={sendAiMsg} disabled={aiLoading}
                  style={{ padding:'10px 20px', background:'#4f46e5', color:'white', border:'none', borderRadius:'8px', cursor:'pointer', fontWeight:600 }}>Send</button>
              </div>
            </div>
            <div style={{ background:'white', borderRadius:'12px', border:'1px solid #e5e7eb', padding:'16px' }}>
              <h3 style={{ margin:'0 0 12px', fontSize:'14px', fontWeight:700 }}>Quick Analysis</h3>
              {['Who is close to becoming Managing Director?','Who are the top 10 producers?','How can I maximize override income?','Analyze the full hierarchy structure','Who should I focus on to grow the team?','Explain the MD breakaway system'].map(q => (
                <button key={q} onClick={() => { setAiInput(q); setTab('ai-advisor') }}
                  style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 12px', background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:'6px', cursor:'pointer', fontSize:'12px', color:'#374151', marginBottom:'8px' }}>{q}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
                    }
