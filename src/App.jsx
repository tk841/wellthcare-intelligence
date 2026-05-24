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
const RANKS = ['Agent','Supervisor','Director','Managing Director','Executive Director','Managing Exec. Director']
const RANK_COLORS = {'Agent':'#6b7280','Supervisor':'#3b82f6','Director':'#8b5cf6','Managing Director':'#f59e0b','Executive Director':'#ef4444','Managing Exec. Director':'#10b981'}
const RANK_PAY = {'Agent':14,'Supervisor':16,'Director':18,'Managing Director':20,'Executive Director':20,'Managing Exec. Director':20}

export default function App() {
  const [tab, setTab] = useState('overview')
  const [agents, setAgents] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [expanded, setExpanded] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({})
  const [uploadStatus, setUploadStatus] = useState('')
  const [aiMsgs, setAiMsgs] = useState([{role:'assistant',content:"Hello! I am your WellthCare Intelligence AI. I can analyze your team, identify top performers, and suggest strategies to maximize compensation. What would you like to know?"}])
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => { loadAgents() }, [])
  useEffect(() => { if (agents.length) computeStats() }, [agents])

  async function loadAgents() {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('agents').select('*').order('name')
      if (error) throw error
      setAgents(data || [])
    } catch(e) {
      const raw = localStorage.getItem('wc_hierarchy')
      if (raw) setAgents(flattenTree(JSON.parse(raw)))
    }
    setLoading(false)
  }

  function flattenTree(nodes, parentId=null, depth=0) {
    const r = []
    for (const n of (Array.isArray(nodes) ? nodes : [nodes])) {
      r.push({id:n.id||n.agentId||Math.random().toString(36).slice(2),name:n.name||n.agentName||'Unknown',rank:n.rank||'Agent',parent_id:parentId,depth,lives:n.lives||0,production:n.production||0,lq_number:n.lqNumber||'',wc_number:n.wcNumber||''})
      if (n.children?.length) r.push(...flattenTree(n.children, n.id||n.agentId, depth+1))
    }
    return r
  }

  function computeStats() {
    const byRank={}; RANKS.forEach(r=>byRank[r]=0)
    let totalLives=0,totalProd=0
    agents.forEach(a=>{byRank[a.rank]=(byRank[a.rank]||0)+1;totalLives+=a.lives||0;totalProd+=a.production||0})
    setStats({total:agents.length,byRank,totalLives,totalProd})
  }

  async function uploadToSupabase() {
    const raw = localStorage.getItem('wc_hierarchy')
    if (!raw) {setUploadStatus('No hierarchy data in localStorage');return}
    setUploadStatus('Uploading...')
    const flat = flattenTree(JSON.parse(raw))
    try {
      await supabase.from('agents').delete().neq('id','placeholder')
      for (let i=0;i<flat.length;i+=500) {
        const {error} = await supabase.from('agents').upsert(flat.slice(i,i+500))
        if (error) throw error
      }
      setUploadStatus('Uploaded '+flat.length+' agents!')
      loadAgents()
    } catch(e) { setUploadStatus('Error: '+e.message) }
  }

  async function sendAi() {
    if (!aiInput.trim()||aiLoading) return
    const msg = {role:'user',content:aiInput}
    setAiMsgs(p=>[...p,msg]); setAiInput(''); setAiLoading(true)
    try {
      const sys = buildContext()
      const resp = await openai.chat.completions.create({model:'gpt-4o-mini',messages:[{role:'system',content:sys},...aiMsgs.slice(-6),msg],max_tokens:800})
      setAiMsgs(p=>[...p,{role:'assistant',content:resp.choices[0].message.content}])
    } catch(e) { setAiMsgs(p=>[...p,{role:'assistant',content:'Error: '+e.message}]) }
    setAiLoading(false)
  }

  function buildContext() {
    const top5 = [...agents].sort((a,b)=>(b.lives||0)-(a.lives||0)).slice(0,5)
    return `You are an expert WellthCare field manager AI. Team: ${agents.length} agents from Linqqs ERC transport. Ranks: ${JSON.stringify(stats.byRank)}. Total lives: ${stats.totalLives}. Comp system: Agent $14/life, Supervisor $16 (100 lives), Director $18 (500 lives+3co), MD $20+bonus (500 lives+2sup), ED $20+bonus (4sup), MED $20+bonus (2MD+1ED). Overrides: 1st gen 12%, 2nd 6%, 3rd 4%, 4th 3%, 5th 2%, 6th 1%. MD breakaway: when agent hits MD they leave upline's base shop. Top producers: ${top5.map(a=>a.name+'('+a.lives+'L)').join(', ')}. Give actionable insights.`
  }

  function getChildren(id) { return agents.filter(a=>a.parent_id===id) }
  function getTopLevel() { return agents.filter(a=>!a.parent_id||!agents.find(x=>x.id===a.parent_id)) }
  function toggle(id) { setExpanded(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n}) }

  function Node({agent,depth=0}) {
    const ch=getChildren(agent.id),exp=expanded.has(agent.id),c=RANK_COLORS[agent.rank]||'#6b7280'
    return (
      <div style={{marginLeft:depth*18+'px'}}>
        <div onClick={()=>{setSelected(agent);if(ch.length)toggle(agent.id)}} className="node" style={{display:'flex',alignItems:'center',gap:'6px',padding:'5px 8px',borderRadius:'6px',cursor:'pointer',marginBottom:'2px',background:selected?.id===agent.id?'#dbeafe':'transparent',borderLeft:'3px solid '+c}}>
          {ch.length>0&&<span style={{fontSize:'9px',color:'#9ca3af'}}>{exp?'▼':'▶'}</span>}
          <span style={{fontSize:'13px',fontWeight:500,flex:1,color:'#1f2937'}}>{agent.name}</span>
          <span style={{fontSize:'10px',padding:'1px 5px',borderRadius:'999px',background:c+'25',color:c,fontWeight:600}}>{agent.rank?.split(' ').map(w=>w[0]).join('')}</span>
          {agent.lives>0&&<span style={{fontSize:'10px',color:'#9ca3af'}}>{agent.lives}L</span>}
        </div>
        {exp&&ch.map(c2=><Node key={c2.id} agent={c2} depth={depth+1}/>)}
      </div>
    )
  }

  const filtered = agents.filter(a=>!search||a.name?.toLowerCase().includes(search.toLowerCase())||a.rank?.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{minHeight:'100vh',background:'#f1f5f9',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'}}>
      <div style={{background:'linear-gradient(135deg,#0f172a,#1e40af)',padding:'14px 24px',display:'flex',alignItems:'center',gap:'14px'}}>
        <div style={{width:38,height:38,borderRadius:'50%',background:'white',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'16px',fontWeight:800,color:'#1e40af'}}>W</div>
        <div style={{flex:1}}>
          <h1 style={{margin:0,color:'white',fontSize:'18px',fontWeight:700}}>WellthCare Intelligence</h1>
          <p style={{margin:0,color:'#93c5fd',fontSize:'12px'}}>{agents.length} agents loaded</p>
        </div>
        <div style={{display:'flex',gap:'6px'}}>
          {['overview','hierarchy','compensation','ai'].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{padding:'5px 12px',borderRadius:'6px',border:'none',cursor:'pointer',fontSize:'12px',fontWeight:500,background:tab===t?'white':'rgba(255,255,255,0.15)',color:tab===t?'#1e40af':'white'}}>
              {t==='ai'?'AI Advisor':t.charAt(0).toUpperCase()+t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div style={{display:'flex',height:'calc(100vh - 67px)'}}>
        <div style={{flex:1,overflow:'auto',padding:'20px'}}>
          {loading&&<div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>Loading agents...</div>}

          {!loading&&tab==='overview'&&(
            <div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:'14px',marginBottom:'20px'}}>
                {[{l:'Total Agents',v:stats.total||0,c:'#2563eb',i:'👥'},{l:'Total Lives',v:stats.totalLives||0,c:'#10b981',i:'💚'},{l:'Mgmt Directors',v:stats.byRank?.['Managing Director']||0,c:'#f59e0b',i:'⭐'},{l:'Exec Directors',v:stats.byRank?.['Executive Director']||0,c:'#ef4444',i:'🏆'}].map(s=>(
                  <div key={s.l} style={{background:'white',borderRadius:'10px',padding:'18px',boxShadow:'0 1px 3px rgba(0,0,0,0.08)',borderTop:'4px solid '+s.c}}>
                    <div style={{fontSize:'24px',marginBottom:'4px'}}>{s.i}</div>
                    <div style={{fontSize:'26px',fontWeight:700,color:s.c}}>{s.v.toLocaleString()}</div>
                    <div style={{fontSize:'12px',color:'#94a3b8'}}>{s.l}</div>
                  </div>
                ))}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px'}}>
                <div style={{background:'white',borderRadius:'10px',padding:'18px',boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
                  <h3 style={{margin:'0 0 14px',fontSize:'14px',fontWeight:600}}>Distribution by Rank</h3>
                  {RANKS.map(rank=>{
                    const cnt=stats.byRank?.[rank]||0,pct=stats.total?Math.round(cnt/stats.total*100):0
                    return <div key={rank} style={{marginBottom:'8px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',fontSize:'12px',marginBottom:'3px'}}>
                        <span style={{color:RANK_COLORS[rank],fontWeight:500}}>{rank}</span>
                        <span style={{color:'#94a3b8'}}>{cnt} ({pct}%)</span>
                      </div>
                      <div style={{height:6,background:'#f1f5f9',borderRadius:'3px'}}>
                        <div style={{height:'100%',width:pct+'%',background:RANK_COLORS[rank],borderRadius:'3px'}}/>
                      </div>
                    </div>
                  })}
                </div>
                <div style={{background:'white',borderRadius:'10px',padding:'18px',boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
                  <h3 style={{margin:'0 0 14px',fontSize:'14px',fontWeight:600}}>Data Sync</h3>
                  <p style={{fontSize:'12px',color:'#64748b',marginBottom:'10px'}}>Upload the hierarchy from your WellthCare portal session to Supabase for persistent cloud storage and API access.</p>
                  <button onClick={uploadToSupabase} style={{width:'100%',padding:'9px',background:'#2563eb',color:'white',border:'none',borderRadius:'7px',cursor:'pointer',fontSize:'13px',fontWeight:500,marginBottom:'8px'}}>
                    Sync Hierarchy to Supabase
                  </button>
                  {uploadStatus&&<p style={{fontSize:'12px',color:uploadStatus.includes('Error')?'#ef4444':'#10b981',margin:'6px 0 0'}}>{uploadStatus}</p>}
                  <p style={{fontSize:'11px',color:'#cbd5e1',marginTop:'8px'}}>Supabase Project: bpnkdnvikqhodjkmbgmi</p>
                </div>
              </div>
            </div>
          )}

          {!loading&&tab==='hierarchy'&&(
            <div style={{display:'flex',gap:'14px',height:'calc(100vh - 107px)'}}>
              <div style={{width:'320px',flexShrink:0,background:'white',borderRadius:'10px',boxShadow:'0 1px 3px rgba(0,0,0,0.08)',display:'flex',flexDirection:'column'}}>
                <div style={{padding:'10px 12px',borderBottom:'1px solid #f1f5f9'}}>
                  <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search agents..." style={{width:'100%',padding:'7px 10px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'12px',outline:'none',boxSizing:'border-box'}}/>
                </div>
                <div style={{flex:1,overflow:'auto',padding:'6px'}}>
                  {search?filtered.slice(0,50).map(a=>(
                    <div key={a.id} onClick={()=>setSelected(a)} className="node" style={{padding:'7px 9px',borderRadius:'6px',cursor:'pointer',marginBottom:'2px',background:selected?.id===a.id?'#dbeafe':'transparent',borderLeft:'3px solid '+(RANK_COLORS[a.rank]||'#6b7280')}}>
                      <div style={{fontSize:'12px',fontWeight:500}}>{a.name}</div>
                      <div style={{fontSize:'11px',color:'#94a3b8'}}>{a.rank}</div>
                    </div>
                  )):getTopLevel().slice(0,150).map(a=><Node key={a.id} agent={a}/>)}
                </div>
              </div>
              <div style={{flex:1,background:'white',borderRadius:'10px',padding:'18px',boxShadow:'0 1px 3px rgba(0,0,0,0.08)',overflow:'auto'}}>
                {selected?(
                  <div>
                    <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'18px'}}>
                      <div style={{width:48,height:48,borderRadius:'50%',background:(RANK_COLORS[selected.rank]||'#6b7280')+'20',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'20px',fontWeight:700,color:RANK_COLORS[selected.rank]||'#6b7280'}}>{selected.name[0]}</div>
                      <div>
                        <h2 style={{margin:0,fontSize:'16px',fontWeight:700}}>{selected.name}</h2>
                        <span style={{fontSize:'12px',padding:'2px 8px',borderRadius:'999px',background:(RANK_COLORS[selected.rank]||'#6b7280')+'20',color:RANK_COLORS[selected.rank]||'#6b7280',fontWeight:600}}>{selected.rank}</span>
                      </div>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'10px',marginBottom:'16px'}}>
                      {[{l:'Lives',v:selected.lives||0},{l:'Downline',v:getChildren(selected.id).length},{l:'PEPM',v:'$'+(RANK_PAY[selected.rank]||14)}].map(s=>(
                        <div key={s.l} style={{background:'#f8fafc',borderRadius:'7px',padding:'10px',textAlign:'center'}}>
                          <div style={{fontSize:'20px',fontWeight:700,color:'#0f172a'}}>{s.v}</div>
                          <div style={{fontSize:'11px',color:'#94a3b8'}}>{s.l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{background:'#f8fafc',borderRadius:'7px',padding:'10px',fontSize:'12px',lineHeight:'1.8',marginBottom:'14px'}}>
                      {selected.lq_number&&<div><b>LQ#:</b> {selected.lq_number}</div>}
                      {selected.wc_number&&<div><b>WC#:</b> {selected.wc_number}</div>}
                      <div><b>Level:</b> {selected.depth||0}</div>
                      <div><b>Monthly Production:</b> ${(selected.production||0).toLocaleString()}</div>
                    </div>
                    {getChildren(selected.id).length>0&&(
                      <div>
                        <h4 style={{margin:'0 0 8px',fontSize:'12px',fontWeight:600,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.05em'}}>Direct Downline ({getChildren(selected.id).length})</h4>
                        <div style={{maxHeight:'180px',overflow:'auto'}}>
                          {getChildren(selected.id).map(c=>(
                            <div key={c.id} onClick={()=>setSelected(c)} className="node" style={{display:'flex',alignItems:'center',gap:'7px',padding:'5px 8px',borderRadius:'5px',cursor:'pointer',marginBottom:'2px',background:'#f8fafc',borderLeft:'3px solid '+(RANK_COLORS[c.rank]||'#6b7280')}}>
                              <span style={{flex:1,fontSize:'12px'}}>{c.name}</span>
                              <span style={{fontSize:'11px',color:RANK_COLORS[c.rank]||'#94a3b8'}}>{c.rank}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ):(
                  <div style={{textAlign:'center',padding:'60px',color:'#94a3b8'}}>
                    <div style={{fontSize:'40px',marginBottom:'12px'}}>👆</div>
                    <p style={{margin:0}}>Click an agent to view details</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {!loading&&tab==='compensation'&&(
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px'}}>
              <div style={{background:'white',borderRadius:'10px',padding:'18px',boxShadow:'0 1px 3px rgba(0,0,0,0.08)'}}>
                <h3 style={{margin:'0 0 14px',fontSize:'14px',fontWeight:600}}>Rank Pay Scale</h3>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                  <thead><tr style={{background:'#f8fafc'}}>{['Rank','%','$/Life','Requirement'].map(h=><th key={h} style={{padding:'7px 10px',textAlign:'left',fontWeight:600,color:'#374151',borderBottom:'2px solid #e2e8f0'}}>{h}</th>)}</tr></thead>
                  <tbody>
                    {[['Agent','70%','$14','Starting'],['Supervisor','80%','$16','100 Lives'],['Director','90%','$18','3 Co + 500 Lives'],['Managing Director','100%','$20','500L + 2 Sup'],['Executive Director','100%','$20','4 Sup OR 2S+1D'],['Managing Exec. Director','100%','$20','2 MD + 1 ED']].map((r,i)=>(
                      <tr key={i} style={{borderBottom:'1px solid #f1f5f9'}}>
                        <td style={{padding:'7px 10px',color:RANK_COLORS[r[0]]||'#374151',fontWeight:500}}>{r[0]}</td>
                        <td style={{padding:'7px 10px'}}>{r[1]}</td>
                        <td style={{padding:'7px 10px',color:'#10b981',fontWeight:600}}>{r[2]}</td>
                        <td style={{padding:'7px 10px',color:'#94a3b8',fontSize:'11px'}}>{r[3]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <div style={{background:'white',borderRadius:'10px',padding:'18px',boxShadow:'0 1px 3px rgba(0,0,0,0.08)',marginBottom:'14px'}}>
                  <h3 style={{margin:'0 0 14px',fontSize:'14px',fontWeight:600}}>Override Structure</h3>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                    <tbody>
                      {[['1st Gen','12%'],['2nd Gen','6%'],['3rd Gen','4%'],['4th Gen','3%'],['5th Gen','2%'],['6th Gen','1%']].map(([g,p])=>(
                        <tr key={g} style={{borderBottom:'1px solid #f1f5f9'}}>
                          <td style={{padding:'7px 10px',fontWeight:500}}>{g}</td>
                          <td style={{padding:'7px 10px',color:'#10b981',fontWeight:600}}>{p}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{background:'#eff6ff',borderRadius:'10px',padding:'14px',marginBottom:'10px'}}>
                  <strong style={{color:'#1e40af',fontSize:'13px'}}>Partner Pool: $2.50/life PEPM</strong>
                  <p style={{margin:'4px 0 0',fontSize:'11px',color:'#3b82f6'}}>Requires 100 lives + 1 new client in last 90 days</p>
                </div>
                <div style={{background:'#f0fdf4',borderRadius:'10px',padding:'14px'}}>
                  <strong style={{color:'#15803d',fontSize:'13px'}}>Founders Pool: $2.50/life PEPM</strong>
                  <p style={{margin:'4px 0 0',fontSize:'11px',color:'#16a34a'}}>Achieve Executive Director within 1 year</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {tab==='ai'&&(
          <div style={{width:'400px',background:'white',borderLeft:'1px solid #e2e8f0',display:'flex',flexDirection:'column'}}>
            <div style={{padding:'14px 16px',borderBottom:'1px solid #e2e8f0',background:'#0f172a'}}>
              <h3 style={{margin:0,color:'white',fontSize:'14px',fontWeight:600}}>AI Intelligence Advisor</h3>
              <p style={{margin:'3px 0 0',color:'#93c5fd',fontSize:'11px'}}>GPT-4o · {agents.length} agents in context</p>
            </div>
            <div style={{flex:1,overflow:'auto',padding:'14px',display:'flex',flexDirection:'column',gap:'10px'}}>
              {aiMsgs.map((m,i)=>(
                <div key={i} style={{display:'flex',justifyContent:m.role==='user'?'flex-end':'flex-start'}}>
                  <div style={{maxWidth:'88%',padding:'9px 12px',borderRadius:m.role==='user'?'10px 10px 2px 10px':'10px 10px 10px 2px',background:m.role==='user'?'#2563eb':'#f1f5f9',color:m.role==='user'?'white':'#1f2937',fontSize:'12px',lineHeight:'1.5',whiteSpace:'pre-wrap'}}>
                    {m.content}
                  </div>
                </div>
              ))}
              {aiLoading&&<div style={{display:'flex',justifyContent:'flex-start'}}><div style={{background:'#f1f5f9',padding:'9px 12px',borderRadius:'10px 10px 10px 2px',fontSize:'12px',color:'#94a3b8'}}>Analyzing your team data...</div></div>}
            </div>
            <div style={{padding:'10px 14px',borderTop:'1px solid #e2e8f0'}}>
              <div style={{display:'flex',gap:'7px',marginBottom:'8px'}}>
                <input value={aiInput} onChange={e=>setAiInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&sendAi()} placeholder="Ask about your team..." style={{flex:1,padding:'7px 10px',border:'1px solid #e2e8f0',borderRadius:'7px',fontSize:'12px',outline:'none'}}/>
                <button onClick={sendAi} disabled={aiLoading} style={{padding:'7px 12px',background:'#2563eb',color:'white',border:'none',borderRadius:'7px',cursor:'pointer',fontSize:'12px',fontWeight:500,opacity:aiLoading?0.6:1}}>Send</button>
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:'5px'}}>
                {['Who is close to MD?','Top producers','Hierarchy analysis','Maximize overrides'].map(q=>(
                  <button key={q} onClick={()=>setAiInput(q)} style={{padding:'3px 7px',background:'#f1f5f9',border:'none',borderRadius:'5px',cursor:'pointer',fontSize:'10px',color:'#374151'}}>{q}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <style>{`.node:hover{background:#f8fafc!important}*{box-sizing:border-box}`}</style>
    </div>
  )
        }
