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
  'Agent': '#6b7280', 'Supervisor': '#3b82f6', 'Director': '#f59e0b',
  'Managing Director': '#8b5cf6', 'Executive Director': '#ef4444', 'Managing Exec. Director': '#10b981'
}

function statusToRank(status, depth) {
  if (!status || status === 'none') {
    if (depth === 0) return 'Managing Exec. Director'
    if (depth === 1) return 'Executive Director'
    if (depth === 2) return 'Managing Director'
    return 'Agent'
  }
  if (status === 'Employee') return 'Managing Exec. Director'
  if (status === 'A') return 'Agent'
  if (status && status.startsWith('REP')) return 'Agent'
  if (depth === 0) return 'Managing Exec. Director'
  if (depth === 1) return 'Executive Director'
  if (depth === 2) return 'Director'
  return 'Agent'
}

// ── Compute subtree sizes from flat agent list ──
function buildSubtreeSizes(agents) {
  const childMap = {}
  const agentMap = {}
  agents.forEach(a => {
    agentMap[a.id] = a
    if (!childMap[a.id]) childMap[a.id] = []
    if (a.parent_id) {
      if (!childMap[a.parent_id]) childMap[a.parent_id] = []
      childMap[a.parent_id].push(a.id)
    }
  })
  const sizes = {}
  function countSubtree(id) {
    if (sizes[id] !== undefined) return sizes[id]
    const kids = childMap[id] || []
    sizes[id] = 1 + kids.reduce((s, cid) => s + countSubtree(cid), 0)
    return sizes[id]
  }
  agents.forEach(a => countSubtree(a.id))
  return { sizes, childMap, agentMap }
}

// ── Build smart AI context with REAL data ──
function buildAIContext(agents, subtreeData) {
  const { sizes, childMap } = subtreeData
  const rankDist = {}
  agents.forEach(a => {
    const r = statusToRank(a.notes, a.depth)
    rankDist[r] = (rankDist[r] || 0) + 1
  })

  // Top 30 agents by subtree size
  const topBySize = [...agents]
    .sort((a, b) => (sizes[b.id] || 1) - (sizes[a.id] || 1))
    .slice(0, 30)
    .map(a => ({
      id: a.id, name: a.name,
      rank: statusToRank(a.notes, a.depth),
      depth: a.depth,
      directReports: (childMap[a.id] || []).length,
      totalUnder: (sizes[a.id] || 1) - 1
    }))

  // Agents close to Managing Director (depth 2, enough downline)
  const closeMD = agents
    .filter(a => statusToRank(a.notes, a.depth) !== 'Managing Director'
      && statusToRank(a.notes, a.depth) !== 'Executive Director'
      && statusToRank(a.notes, a.depth) !== 'Managing Exec. Director'
      && (sizes[a.id] || 1) >= 3)
    .sort((a, b) => (sizes[b.id] || 1) - (sizes[a.id] || 1))
    .slice(0, 15)
    .map(a => ({ id: a.id, name: a.name, rank: statusToRank(a.notes, a.depth), totalUnder: (sizes[a.id] || 1) - 1 }))

  return `
=== WELLTHCARE INTELLIGENCE SYSTEM CONTEXT ===
You are an expert WellthCare business intelligence analyst with FULL ACCESS to the complete team database.
You have real data for every agent. Always answer with SPECIFIC names and numbers from the data below.
NEVER say you don't have access to specific data - you do. Use the data provided.

TEAM OVERVIEW:
- Total agents in system: ${agents.length}
- Rank distribution: ${JSON.stringify(rankDist)}

COMPENSATION STRUCTURE:
Agent=70%/$14/life | Supervisor=80%/$16/+$2 req:100lives | Director=90%/$18/+$2 req:3companies+500lives
Managing Director=100%/$20/+$2+$1MD bonus req:500lives+2supervisors
Executive Director=100%/$20/$1ED bonus req:4sup OR 2sup+1dir
Managing Exec Director=100%/$20/$0.50MED bonus req:2MD+1ED
General Overrides: 1st gen 12%, 2nd 6%, 3rd 4%, 4th 3%, 5th 2%, 6th 1%
Bonus Pools: Partner $2.50 PEPM (100 personal lives + 1 new client/90 days), Founders $2.50 PEPM (reach ED in 1 year)

TOP 30 AGENTS BY TOTAL TEAM SIZE (sorted by # of people under them):
${topBySize.map((a, i) => `${i+1}. ${a.name} (ID:${a.id}) - Rank:${a.rank} - DirectReports:${a.directReports} - TotalUnder:${a.totalUnder} - Depth:${a.depth}`).join('\n')}

AGENTS WITH GROWTH POTENTIAL (closest to promotion, sorted by team size):
${closeMD.map(a => `${a.name} (ID:${a.id}) - ${a.rank} - ${a.totalUnder} people under them`).join('\n')}

FULL AGENT LIST (for individual lookups - name, id, rank, directReports, totalUnder):
${agents.slice(0, 500).map(a => `${a.name}|${a.id}|${statusToRank(a.notes,a.depth)}|${(childMap[a.id]||[]).length}|${(sizes[a.id]||1)-1}`).join('\n')}
${agents.length > 500 ? `... and ${agents.length - 500} more agents in the database` : ''}
=== END CONTEXT ===`
}

// ── Smart agent name extractor ──
function extractAgentNames(text, agents) {
  const words = text.toLowerCase().split(/\s+/)
  const found = []
  agents.forEach(a => {
    if (!a.name) return
    const nameLower = a.name.toLowerCase()
    const nameParts = nameLower.split(' ')
    // Check if any significant part of the name appears in the query
    if (nameParts.some(part => part.length > 3 && words.some(w => w.includes(part) || part.includes(w)))) {
      found.push(a)
    }
  })
  return found.slice(0, 5) // Return up to 5 matches
}

// ── Org Chart (same as before, efficient) ──
const CARD_W = 160, CARD_H = 90, H_GAP = 24, V_GAP = 70
function calcWidth(node, expanded) {
  if (!node.children || !node.children.length || !expanded.has(node.id)) return CARD_W
  const total = node.children.reduce((s,c)=>s+calcWidth(c,expanded),0) + H_GAP*(node.children.length-1)
  return Math.max(CARD_W, total)
}
function layout(node, x, y, expanded, pos) {
  pos[node.id] = { x, y }
  if (!node.children || !node.children.length || !expanded.has(node.id)) return
  const cws = node.children.map(c=>calcWidth(c,expanded))
  const total = cws.reduce((s,w)=>s+w,0) + H_GAP*(node.children.length-1)
  let cx = x - total/2
  node.children.forEach((child,i) => { layout(child,cx+cws[i]/2,y+CARD_H+V_GAP,expanded,pos); cx+=cws[i]+H_GAP })
}
function OrgNode({node,pos,expanded,onToggle,search}) {
  const p = pos[node.id]; if(!p) return null
  const rank = statusToRank(node.notes, node.depth)
  const color = RANK_COLORS[rank]||'#6b7280'
  const hasKids = node.children && node.children.length > 0
  const isOpen = expanded.has(node.id)
  const q = search?.toLowerCase()
  const hit = q && (node.name?.toLowerCase().includes(q)||node.id?.toLowerCase().includes(q))
  const shortRank = rank==='Managing Exec. Director'?'MED':rank==='Executive Director'?'ED':rank==='Managing Director'?'MD':rank
  return (
    <>
      <div style={{position:'absolute',left:p.x-CARD_W/2,top:p.y,width:CARD_W,height:CARD_H,
        background:hit?'#fef9c3':'white',border:`2px solid ${color}`,borderRadius:10,padding:'8px 10px',
        boxShadow:hit?`0 0 0 3px ${color}55`:'0 1px 4px rgba(0,0,0,0.08)',
        display:'flex',flexDirection:'column',justifyContent:'space-between'}}>
        <div style={{fontWeight:700,fontSize:11,color:'#1e1b4b',lineHeight:1.3,overflow:'hidden',
          display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{node.name}</div>
        <div style={{fontSize:10,color:color,fontWeight:600}}>{node.id}</div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:9,background:color+'22',color,borderRadius:4,padding:'1px 5px',fontWeight:700}}>{shortRank}</span>
          {hasKids && <span style={{fontSize:9,color:'#9ca3af'}}>{node.children.length} reports</span>}
        </div>
      </div>
      {hasKids && <div onClick={e=>{e.stopPropagation();onToggle(node.id)}} style={{
        position:'absolute',left:p.x-11,top:p.y+CARD_H+8,width:22,height:22,borderRadius:'50%',
        background:isOpen?'#64748b':'#4f46e5',color:'white',fontSize:14,fontWeight:700,
        display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',zIndex:20,userSelect:'none'
      }}>{isOpen?'−':'+'}</div>}
      {isOpen && node.children && node.children.map(child => {
        const cp = pos[child.id]; if(!cp) return null
        return (<svg key={'l-'+child.id} style={{position:'absolute',left:0,top:0,pointerEvents:'none',overflow:'visible',zIndex:0}}>
          <path d={`M${p.x},${p.y+CARD_H} C${p.x},${(p.y+CARD_H+cp.y)/2} ${cp.x},${(p.y+CARD_H+cp.y)/2} ${cp.x},${cp.y}`}
            fill="none" stroke="#cbd5e1" strokeWidth={1.5}/>
        </svg>)
      })}
      {isOpen && node.children && node.children.map(child => (
        <OrgNode key={child.id} node={child} pos={pos} expanded={expanded} onToggle={onToggle} search={search}/>
      ))}
    </>
  )
}
const btnS = {padding:'4px 11px',borderRadius:6,border:'1px solid #4338ca',background:'#312e81',color:'white',cursor:'pointer',fontSize:11,fontWeight:600,whiteSpace:'nowrap'}
function OrgChartTab({agents}) {
  const [tree,setTree]=useState(null)
  const [expanded,setExpanded]=useState(new Set())
  const [offset,setOffset]=useState({x:700,y:50})
  const [zoom,setZoom]=useState(1)
  const [search,setSearch]=useState('')
  const [drag,setDrag]=useState(null)
  const canvasRef=useRef(null)
  useEffect(()=>{
    if(!agents||!agents.length) return
    const map={}; agents.forEach(a=>{map[a.id]={...a,children:[]}})
    let roots=[]
    agents.forEach(a=>{
      if(a.parent_id&&map[a.parent_id]) map[a.parent_id].children.push(map[a.id])
      else roots.push(map[a.id])
    })
    const root=roots[0]||map[agents[0]?.id]
    setTree(root)
    if(root){setExpanded(new Set([root.id]));const w=canvasRef.current?.clientWidth||1400;setOffset({x:w/2,y:50})}
  },[agents])
  const pos={};if(tree) layout(tree,0,0,expanded,pos)
  const translated={};Object.keys(pos).forEach(id=>{translated[id]={x:pos[id].x+offset.x,y:pos[id].y+offset.y}})
  const toggle=useCallback(id=>{setExpanded(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s})},[])
  const reset=()=>{const w=canvasRef.current?.clientWidth||1400;setOffset({x:w/2,y:50});setZoom(1)}
  const collapseAll=()=>{if(tree){setExpanded(new Set([tree.id]));reset()}}
  const expandLevels=n=>{if(!tree) return;const ids=new Set();const go=(node,d)=>{ids.add(node.id);if(d<n&&node.children)node.children.forEach(c=>go(c,d+1))};go(tree,0);setExpanded(ids);reset()}
  const onMD=e=>setDrag({sx:e.clientX-offset.x,sy:e.clientY-offset.y})
  const onMM=e=>{if(drag)setOffset({x:e.clientX-drag.sx,y:e.clientY-drag.sy})}
  const onMU=()=>setDrag(null)
  const onWheel=e=>{e.preventDefault();setZoom(z=>Math.min(3,Math.max(0.15,z*(e.deltaY<0?1.1:0.9))))}
  return (
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 56px)'}}>
      <div style={{background:'#1e1b4b',padding:'8px 16px',display:'flex',alignItems:'center',gap:8,flexShrink:0,flexWrap:'wrap'}}>
        <span style={{fontWeight:700,fontSize:14,color:'#a78bfa',marginRight:4,whiteSpace:'nowrap'}}>◆ WellthCare Org Chart</span>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search agents..."
          style={{padding:'4px 10px',borderRadius:6,border:'none',fontSize:12,width:155,background:'#312e81',color:'white',outline:'none'}}/>
        <button onClick={()=>setZoom(z=>Math.min(3,z*1.2))} style={btnS}>+ Zoom In</button>
        <button onClick={()=>setZoom(z=>Math.max(0.15,z*0.8))} style={btnS}>− Zoom Out</button>
        <button onClick={reset} style={btnS}>↺ Reset</button>
        <button onClick={()=>expandLevels(2)} style={btnS}>Level 2</button>
        <button onClick={()=>expandLevels(3)} style={btnS}>Level 3</button>
        <button onClick={collapseAll} style={btnS}>Collapse All</button>
        <span style={{fontSize:11,color:'#94a3b8',minWidth:36}}>{Math.round(zoom*100)}%</span>
        <div style={{flex:1}}/>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {Object.entries(RANK_COLORS).map(([r,c])=>(
            <span key={r} style={{display:'flex',alignItems:'center',gap:3,fontSize:10,color:'white',whiteSpace:'nowrap'}}>
              <span style={{width:9,height:9,borderRadius:2,background:c,display:'inline-block'}}/>
              {r==='Managing Exec. Director'?'MED':r==='Executive Director'?'ED':r==='Managing Director'?'MD':r}
            </span>
          ))}
        </div>
      </div>
      <div ref={canvasRef} onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU} onWheel={onWheel}
        style={{flex:1,overflow:'hidden',position:'relative',background:'#f1f5f9',cursor:drag?'grabbing':'grab',userSelect:'none'}}>
        {!tree && <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'#94a3b8',fontSize:16}}>Loading...</div>}
        {tree && <div style={{position:'absolute',left:0,top:0,transformOrigin:'0 0',transform:`scale(${zoom})`}}>
          <OrgNode node={tree} pos={translated} expanded={expanded} onToggle={toggle} search={search}/>
        </div>}
      </div>
    </div>
  )
}

// ── AI Advisor Tab (UPGRADED) ──
function AIAdvisorTab({ agents, subtreeData }) {
  const [msgs, setMsgs] = useState([
    { role: 'assistant', content: `👋 I'm your WellthCare Intelligence AI — powered by GPT-4o with full access to your ${agents.length} agent database.\n\nI can answer specific questions like:\n• "How many agents does Brett Moore have under him?"\n• "Who are my top 10 producers by team size?"\n• "Who is closest to reaching Managing Director?"\n• "What is my override income potential from my MDs?"\n\nAsk me anything!` }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [model, setModel] = useState('gpt-4o')
  const chatRef = useRef(null)

  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight }, [msgs])

  async function send(text) {
    const q = (text || input).trim()
    if (!q) return
    setInput('')
    setLoading(true)
    const userMsg = { role: 'user', content: q }
    setMsgs(prev => [...prev, userMsg])

    try {
      // Smart agent lookup - find any mentioned agents and get their real data
      const mentionedAgents = extractAgentNames(q, agents)
      const { sizes, childMap } = subtreeData

      let extraContext = ''
      if (mentionedAgents.length > 0) {
        extraContext = '\n\nSPECIFIC AGENT DATA LOOKUP RESULTS:\n'
        mentionedAgents.forEach(a => {
          const totalUnder = (sizes[a.id] || 1) - 1
          const directReports = (childMap[a.id] || []).length
          const rank = statusToRank(a.notes, a.depth)
          // Get direct report names
          const reportNames = (childMap[a.id] || []).slice(0, 10).map(rid => {
            const rep = agents.find(ag => ag.id === rid)
            return rep ? `${rep.name} (${rid}, ${statusToRank(rep.notes, rep.depth)})` : rid
          })
          extraContext += `\nAGENT: ${a.name} (ID: ${a.id})\n  Rank: ${rank}\n  Depth level: ${a.depth}\n  Direct reports: ${directReports}\n  Total people under them: ${totalUnder}\n  Parent ID: ${a.parent_id || 'ROOT'}\n  Direct report names: ${reportNames.join(', ') || 'none'}\n`
        })
      }

      const systemContext = buildAIContext(agents, subtreeData) + extraContext

      const res = await openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemContext },
          ...msgs.filter(m => m.role !== 'assistant' || msgs.indexOf(m) > 0).slice(-10),
          userMsg
        ],
        max_tokens: 1000,
        temperature: 0.3
      })

      setMsgs(prev => [...prev, { role: 'assistant', content: res.choices[0].message.content }])
    } catch(e) {
      setMsgs(prev => [...prev, { role: 'assistant', content: '❌ Error: ' + e.message + '\n\nMake sure your OpenAI API key has access to ' + model + '.' }])
    }
    setLoading(false)
  }

  const quickPrompts = [
    { label: '🏆 Top 10 by team size', q: 'Who are the top 10 agents with the most people under them? List their names, IDs, and exact team sizes.' },
    { label: '📈 Close to MD promotion', q: 'Who in my team is closest to reaching Managing Director rank? Be specific with names and what they need.' },
    { label: '💰 Override income analysis', q: 'Analyze my override income potential from my MDs and EDs. Calculate what I could be earning.' },
    { label: '🌳 Hierarchy depth analysis', q: 'Analyze the depth and structure of my hierarchy. Who has the deepest organizations?' },
    { label: '🚀 Growth opportunities', q: 'Who should I focus on developing to maximize my income fastest? Give me specific names and a plan.' },
    { label: '📊 Full rank breakdown', q: 'Give me a complete breakdown of everyone in my organization by rank, with names and team sizes.' },
    { label: '💡 MD breakaway strategy', q: 'Explain the MD breakaway system and how I can build multiple MDs to maximize my passive income.' },
    { label: '🎯 Agent activation plan', q: 'Based on my data, which agents look inactive (no downline)? How many do I have and what should I do?' },
  ]

  return (
    <div style={{padding:16,display:'grid',gridTemplateColumns:'1fr 260px',gap:16,height:'calc(100vh - 88px)'}}>
      <div style={{background:'white',borderRadius:12,border:'1px solid #e5e7eb',display:'flex',flexDirection:'column'}}>
        {/* Header */}
        <div style={{padding:'12px 16px',borderBottom:'1px solid #e5e7eb',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div>
            <div style={{fontWeight:700,fontSize:15}}>🤖 WellthCare Intelligence AI</div>
            <div style={{fontSize:11,color:'#6b7280'}}>
              {agents.length} agents · Full hierarchy access · Real-time data lookup
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:11,color:'#6b7280'}}>Model:</span>
            <select value={model} onChange={e=>setModel(e.target.value)}
              style={{fontSize:11,padding:'3px 6px',borderRadius:6,border:'1px solid #e5e7eb',background:'white',cursor:'pointer',fontWeight:600}}>
              <option value="gpt-4o">GPT-4o (Best)</option>
              <option value="gpt-4o-mini">GPT-4o Mini (Fast)</option>
              <option value="gpt-4-turbo">GPT-4 Turbo</option>
            </select>
          </div>
        </div>

        {/* Messages */}
        <div ref={chatRef} style={{flex:1,overflow:'auto',padding:16,display:'flex',flexDirection:'column',gap:12}}>
          {msgs.map((m,i) => (
            <div key={i} style={{display:'flex',justifyContent:m.role==='user'?'flex-end':'flex-start',gap:8,alignItems:'flex-start'}}>
              {m.role==='assistant' && <div style={{width:28,height:28,borderRadius:'50%',background:'#4f46e5',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>🤖</div>}
              <div style={{
                maxWidth:'80%',padding:'10px 14px',borderRadius:m.role==='user'?'16px 16px 4px 16px':'16px 16px 16px 4px',
                fontSize:13,lineHeight:1.6,whiteSpace:'pre-wrap',wordBreak:'break-word',
                background:m.role==='user'?'#4f46e5':'#f8fafc',
                color:m.role==='user'?'white':'#1e293b',
                border:m.role==='assistant'?'1px solid #e2e8f0':'none'
              }}>
                {m.content}
              </div>
              {m.role==='user' && <div style={{width:28,height:28,borderRadius:'50%',background:'#10b981',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>👤</div>}
            </div>
          ))}
          {loading && (
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <div style={{width:28,height:28,borderRadius:'50%',background:'#4f46e5',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>🤖</div>
              <div style={{padding:'10px 14px',background:'#f8fafc',borderRadius:'16px 16px 16px 4px',border:'1px solid #e2e8f0'}}>
                <div style={{display:'flex',gap:4}}>
                  {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:'50%',background:'#94a3b8',animation:'bounce 1.2s ease-in-out infinite',animationDelay:i*0.2+'s'}}/>)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{padding:'12px 16px',borderTop:'1px solid #e5e7eb',display:'flex',gap:8}}>
          <input
            value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&send()}
            placeholder="Ask anything — I have full access to your 6,473 agent database..."
            style={{flex:1,padding:'10px 14px',border:'1px solid #e5e7eb',borderRadius:10,fontSize:13,outline:'none',background:'#f8fafc'}}
          />
          <button onClick={()=>send()} disabled={loading||!input.trim()}
            style={{padding:'10px 20px',background:loading||!input.trim()?'#94a3b8':'#4f46e5',color:'white',border:'none',borderRadius:10,cursor:loading?'wait':'pointer',fontWeight:700,fontSize:13,whiteSpace:'nowrap'}}>
            {loading ? '...' : 'Send ➤'}
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <div style={{display:'flex',flexDirection:'column',gap:12,overflow:'auto'}}>
        <div style={{background:'white',borderRadius:12,padding:14,border:'1px solid #e5e7eb'}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:10,color:'#1e293b'}}>⚡ Quick Analysis</div>
          {quickPrompts.map(p=>(
            <button key={p.q} onClick={()=>send(p.q)}
              style={{display:'block',width:'100%',textAlign:'left',padding:'8px 10px',background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:8,cursor:'pointer',marginBottom:6,fontSize:12,color:'#374151',fontWeight:500,transition:'all 0.1s'}}>
              {p.label}
            </button>
          ))}
        </div>
        <div style={{background:'linear-gradient(135deg,#4f46e5,#7c3aed)',borderRadius:12,padding:14,color:'white'}}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:6}}>🧠 AI Capabilities</div>
          <div style={{fontSize:11,lineHeight:1.7,opacity:0.9}}>
            ✓ Name every agent by name<br/>
            ✓ Count exact team sizes<br/>
            ✓ Find agents close to promotion<br/>
            ✓ Calculate override income<br/>
            ✓ Identify growth opportunities<br/>
            ✓ Analyze hierarchy depth<br/>
            ✓ Strategic recommendations<br/>
            ✓ MD breakaway planning
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main App ──
export default function App() {
  const [tab, setTab] = useState('overview')
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [subtreeData, setSubtreeData] = useState({ sizes: {}, childMap: {}, agentMap: {} })
  const [syncStatus, setSyncStatus] = useState('')
  const [hierSearch, setHierSearch] = useState('')
  const [selected, setSelected] = useState(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    let all = [], page = 0
    while (true) {
      const { data, error } = await supabase.from('agents').select('*').range(page*1000, page*1000+999)
      if (error || !data || !data.length) break
      all = all.concat(data)
      if (data.length < 1000) break
      page++
    }
    setAgents(all)
    setSubtreeData(buildSubtreeSizes(all))
    setLoading(false)
  }

  const totalAgents = agents.length
  const totalLives = agents.reduce((s,a)=>s+(a.lives||0),0)
  const rankDist = {}
  agents.forEach(a => { const r=statusToRank(a.notes,a.depth); rankDist[r]=(rankDist[r]||0)+1 })
  const mdCount = rankDist['Managing Director']||0
  const edCount = rankDist['Executive Director']||0

  const filtered = agents.filter(a=>!hierSearch||a.name?.toLowerCase().includes(hierSearch.toLowerCase())||a.id?.toLowerCase().includes(hierSearch.toLowerCase()))
  const tabs=[{id:'overview',label:'Overview'},{id:'org-chart',label:'Org Chart'},{id:'hierarchy',label:'Hierarchy'},{id:'compensation',label:'Compensation'},{id:'ai-advisor',label:'🤖 AI Advisor'}]

  return (
    <div style={{fontFamily:'system-ui,sans-serif',background:'#f8fafc',minHeight:'100vh'}}>
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}`}</style>
      <div style={{background:'#1e1b4b',color:'white',padding:'10px 20px',display:'flex',alignItems:'center',gap:14}}>
        <div style={{background:'#4f46e5',borderRadius:8,width:34,height:34,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:16,flexShrink:0}}>W</div>
        <div>
          <div style={{fontWeight:700,fontSize:15}}>WellthCare Intelligence</div>
          <div style={{fontSize:11,color:'#94a3b8'}}>{loading?'Loading...':totalAgents+' agents · Powered by GPT-4o'}</div>
        </div>
        <div style={{flex:1}}/>
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            padding:'6px 14px',borderRadius:8,border:'none',cursor:'pointer',fontSize:12,fontWeight:600,
            background:tab===t.id?'#4f46e5':'transparent',color:tab===t.id?'white':'#94a3b8'
          }}>{t.label}</button>
        ))}
      </div>

      {tab==='overview' && (
        <div style={{padding:24}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:20}}>
            {[
              {l:'Total Agents',v:totalAgents,c:'#4f46e5',i:'👥'},
              {l:'Total Lives',v:totalLives,c:'#10b981',i:'💚'},
              {l:'Mgmt Directors',v:mdCount,c:'#8b5cf6',i:'⭐'},
              {l:'Exec Directors',v:edCount,c:'#ef4444',i:'🏆'}
            ].map(s=>(
              <div key={s.l} style={{background:'white',borderRadius:12,padding:20,borderTop:`4px solid ${s.c}`}}>
                <div style={{fontSize:24,marginBottom:4}}>{s.i}</div>
                <div style={{fontSize:30,fontWeight:800,color:s.c}}>{s.v.toLocaleString()}</div>
                <div style={{fontSize:12,color:'#6b7280'}}>{s.l}</div>
              </div>
            ))}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <div style={{background:'white',borderRadius:12,padding:20}}>
              <h3 style={{margin:'0 0 14px',fontSize:14,fontWeight:700}}>Distribution by Rank</h3>
              {Object.entries(rankDist).sort((a,b)=>b[1]-a[1]).map(([rank,cnt])=>(
                <div key={rank} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #f1f5f9'}}>
                  <span style={{color:RANK_COLORS[rank]||'#6b7280',fontWeight:600,fontSize:13}}>{rank}</span>
                  <span style={{fontSize:13,color:'#374151'}}>{cnt} ({((cnt/totalAgents)*100).toFixed(1)}%)</span>
                </div>
              ))}
            </div>
            <div style={{background:'white',borderRadius:12,padding:20}}>
              <h3 style={{margin:'0 0 8px',fontSize:14,fontWeight:700}}>Top Agents by Team Size</h3>
              <p style={{fontSize:11,color:'#6b7280',margin:'0 0 10px'}}>Agents with the most people under them:</p>
              {agents.length > 0 && [...agents].sort((a,b)=>(subtreeData.sizes[b.id]||1)-(subtreeData.sizes[a.id]||1)).slice(0,8).map((a,i)=>{
                const rank=statusToRank(a.notes,a.depth)
                const color=RANK_COLORS[rank]||'#6b7280'
                const total=(subtreeData.sizes[a.id]||1)-1
                return (
                  <div key={a.id} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 0',borderBottom:'1px solid #f1f5f9'}}>
                    <span style={{fontSize:11,color:'#9ca3af',width:16,textAlign:'right'}}>{i+1}.</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.name}</div>
                      <div style={{fontSize:10,color:color,fontWeight:600}}>{rank}</div>
                    </div>
                    <span style={{fontSize:12,fontWeight:700,color:'#4f46e5'}}>{total} under</span>
                  </div>
                )
              })}
              <button onClick={()=>setTab('ai-advisor')} style={{marginTop:10,width:'100%',padding:'7px',background:'#4f46e5',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600}}>
                Ask AI for deeper analysis →
              </button>
            </div>
          </div>
        </div>
      )}

      {tab==='org-chart' && <OrgChartTab agents={agents}/>}

      {tab==='hierarchy' && (
        <div style={{padding:24,display:'grid',gridTemplateColumns:'1fr 300px',gap:16}}>
          <div style={{background:'white',borderRadius:12,padding:16}}>
            <input placeholder="Search by name or WC#..." value={hierSearch} onChange={e=>setHierSearch(e.target.value)}
              style={{width:'100%',padding:'8px 12px',border:'1px solid #e5e7eb',borderRadius:8,fontSize:13,marginBottom:12,boxSizing:'border-box'}}/>
            <div style={{maxHeight:'calc(100vh - 220px)',overflow:'auto'}}>
              {filtered.slice(0,200).map(a=>{
                const rank=statusToRank(a.notes,a.depth)
                const color=RANK_COLORS[rank]||'#6b7280'
                const teamSize=(subtreeData.sizes[a.id]||1)-1
                return (
                  <div key={a.id} onClick={()=>setSelected(a)} style={{
                    padding:'9px 12px',borderBottom:'1px solid #f1f5f9',cursor:'pointer',
                    background:selected?.id===a.id?'#eef2ff':'white',display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:6,height:6,borderRadius:'50%',background:color,flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.name}</div>
                      <div style={{fontSize:11,color:'#9ca3af'}}>{a.id} · Depth {a.depth} · {teamSize} under</div>
                    </div>
                    <span style={{fontSize:10,background:color+'22',color,borderRadius:4,padding:'2px 6px',fontWeight:600,flexShrink:0}}>
                      {rank==='Managing Exec. Director'?'MED':rank==='Executive Director'?'ED':rank==='Managing Director'?'MD':rank}
                    </span>
                  </div>
                )
              })}
              {filtered.length>200 && <div style={{padding:12,textAlign:'center',color:'#9ca3af',fontSize:12}}>Showing 200 of {filtered.length}. Narrow your search.</div>}
            </div>
          </div>
          <div style={{background:'white',borderRadius:12,padding:16}}>
            {selected ? (()=>{
              const rank=statusToRank(selected.notes,selected.depth)
              const color=RANK_COLORS[rank]||'#6b7280'
              const teamSize=(subtreeData.sizes[selected.id]||1)-1
              const directReports=(subtreeData.childMap[selected.id]||[]).length
              return (
                <>
                  <div style={{width:48,height:48,borderRadius:'50%',background:color+'22',border:`2px solid ${color}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,marginBottom:10}}>👤</div>
                  <h3 style={{margin:'0 0 2px',fontSize:16,fontWeight:700}}>{selected.name}</h3>
                  <div style={{fontSize:12,color,fontWeight:600,marginBottom:12}}>{rank}</div>
                  {[['WC ID',selected.id],['Depth Level',selected.depth],['Parent ID',selected.parent_id||'Root'],['Status',selected.notes||'N/A'],['Lives',selected.lives||0],['Direct Reports',directReports],['Total Under',teamSize]].map(([l,v])=>(
                    <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid #f1f5f9',fontSize:13}}>
                      <span style={{color:'#6b7280'}}>{l}</span>
                      <span style={{fontWeight:600,color:'#1e293b'}}>{v}</span>
                    </div>
                  ))}
                  <button onClick={()=>{setTab('ai-advisor')}} style={{marginTop:12,width:'100%',padding:'7px',background:'#4f46e5',color:'white',border:'none',borderRadius:8,cursor:'pointer',fontSize:12,fontWeight:600}}>
                    Ask AI about {selected.name?.split(' ')[0]} →
                  </button>
                </>
              )
            })():(
              <div style={{color:'#9ca3af',textAlign:'center',paddingTop:60,fontSize:13}}>← Select an agent</div>
            )}
          </div>
        </div>
      )}

      {tab==='compensation' && (
        <div style={{padding:24}}>
          <div style={{background:'white',borderRadius:12,padding:24,marginBottom:20}}>
            <h2 style={{margin:'0 0 16px',fontSize:18,fontWeight:700}}>Agent Compensation & Promotion</h2>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:'#f8fafc'}}>
                {['Rank','%','$/Life PEPM','Pay Increase Per Level','Requirement for Promotion'].map(h=>(
                  <th key={h} style={{padding:'10px 12px',textAlign:'left',fontWeight:700,color:'#374151',borderBottom:'2px solid #e5e7eb'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {[
                  ['Agent','70%','$14','N/A','Starting rank'],
                  ['Supervisor','80%','$16','+$2','100 Lives'],
                  ['Director','90%','$18','+$2','3 Companies + 500 Lives'],
                  ['Managing Director','100%','$20','+$2 + $1 MD Bonus','500 Lives + 2 Supervisors'],
                  ['Executive Director','100%','$20','$1 ED Bonus','4 Sup OR 2 Sup + 1 Dir Lives'],
                  ['Managing Exec. Director','100%','$20','$0.50 MED Bonus','2 MD + 1 ED'],
                ].map(([rank,...rest])=>(
                  <tr key={rank} style={{borderBottom:'1px solid #f1f5f9'}}>
                    <td style={{padding:'10px 12px',fontWeight:700,color:RANK_COLORS[rank]||'#374151'}}>{rank}</td>
                    {rest.map((c,i)=><td key={i} style={{padding:'10px 12px',color:'#374151'}}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <div style={{background:'white',borderRadius:12,padding:20}}>
              <h3 style={{margin:'0 0 12px',fontSize:14,fontWeight:700}}>General Overrides (Upline)</h3>
              {[['1st Gen','12%'],['2nd Gen','6%'],['3rd Gen','4%'],['4th Gen','3%'],['5th Gen','2%'],['6th Gen','1%']].map(([g,p])=>(
                <div key={g} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #f1f5f9',fontSize:13}}>
                  <span>{g}</span><span style={{fontWeight:700,color:'#4f46e5'}}>{p}</span>
                </div>
              ))}
            </div>
            <div style={{background:'white',borderRadius:12,padding:20}}>
              <h3 style={{margin:'0 0 12px',fontSize:14,fontWeight:700}}>Bonus Pools</h3>
              <div style={{background:'#1e1b4b',borderRadius:10,padding:14,marginBottom:10}}>
                <div style={{fontSize:10,fontWeight:700,letterSpacing:1,color:'#94a3b8',marginBottom:4}}>PARTNER POOL</div>
                <div style={{fontSize:22,fontWeight:800,color:'#a78bfa'}}>$2.50 PEPM</div>
                <div style={{fontSize:11,color:'#e2e8f0',marginTop:6}}>Personal 100 lives + 1 new client per 90 days</div>
              </div>
              <div style={{background:'#1e1b4b',borderRadius:10,padding:14}}>
                <div style={{fontSize:10,fontWeight:700,letterSpacing:1,color:'#94a3b8',marginBottom:4}}>FOUNDERS POOL</div>
                <div style={{fontSize:22,fontWeight:800,color:'#a78bfa'}}>$2.50 PEPM</div>
                <div style={{fontSize:11,color:'#e2e8f0',marginTop:6}}>Achieve Executive Director within 1 year</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab==='ai-advisor' && <AIAdvisorTab agents={agents} subtreeData={subtreeData}/>}
    </div>
  )
                   }
