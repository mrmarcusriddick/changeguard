"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BarChart3, Bell, Boxes, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, Database, FileClock, Gauge, GitBranch, History, LayoutDashboard, Network, Play, Search, Server, Settings, ShieldCheck, Sparkles, Waypoints, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast, Toaster } from "sonner";

const nav = [["Dashboard", LayoutDashboard], ["Changes", GitBranch], ["Assets", Server], ["Infrastructure Graph", Network], ["Integrations", Boxes], ["Audit", History], ["Settings", Settings]] as const;
const findings = [
  { level: "BLOCKER", icon: XCircle, title: "SQLPROD DNS alias resolves to SERVER17", detail: "Production clients may lose database connectivity if the target record is removed.", source: "Windows DNS", time: "2m ago" },
  { level: "WARNING", icon: AlertTriangle, title: "Active Prometheus monitoring target", detail: "12 alert rules and 4 recording rules currently reference this host.", source: "Prometheus", time: "3m ago" },
  { level: "WARNING", icon: AlertTriangle, title: "Grafana dashboards reference SERVER17", detail: "Six production dashboards use this server as a query variable or data source filter.", source: "Grafana", time: "3m ago" },
  { level: "WARNING", icon: AlertTriangle, title: "TLS certificate remains active", detail: "Certificate expires in 143 days and includes server17.corp.local in its SAN list.", source: "Windows CA", time: "4m ago" },
  { level: "INFO", icon: CircleHelp, title: "Computer object is enabled", detail: "The Active Directory computer account last authenticated 18 minutes ago.", source: "Active Directory", time: "4m ago" },
] as const;
const systems = [["Active Directory", "Computer identity and group membership", "#38bdf8"], ["Windows DNS", "A, PTR, CNAME and dependent records", "#a78bfa"], ["Windows CA", "Issued and pending certificates", "#34d399"], ["Tenable.sc", "Exposure and scan history", "#fb7185"], ["Prometheus", "Targets, alerts and recording rules", "#fbbf24"], ["Grafana", "Dashboards and data-source references", "#fb923c"]] as const;

export default function Home() {
  const [activeNav, setActiveNav] = useState("Dashboard");
  const [query, setQuery] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [generated, setGenerated] = useState(false);
  const filtered = useMemo(() => findings.filter(f => `${f.title} ${f.detail} ${f.source}`.toLowerCase().includes(query.toLowerCase())), [query]);
  function runAnalysis() { setAnalyzing(true); setTimeout(() => { setAnalyzing(false); toast.success("Analysis refreshed", { description: "6 systems queried • No changes executed" }); }, 1200); }
  function createPlan() { setGenerated(true); setDialogOpen(false); toast.success("Draft change plan generated", { description: "7 safe, reviewable steps added to the plan." }); }

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: object, options?: { signal?: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: object) => Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined);
    void register({ name: "refresh_change_analysis", title: "Refresh change analysis", description: "Re-run the safe mock dependency analysis for SERVER17 without executing infrastructure changes.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: async () => { setAnalyzing(true); await new Promise(resolve => setTimeout(resolve, 1200)); setAnalyzing(false); return { change: "Decommission SERVER17", riskScore: 78, systemsQueried: 6, executionPerformed: false }; } });
    void register({ name: "stage_change_plan", title: "Stage draft change plan", description: "Generate a review-only change plan with validation and rollback checkpoints. Does not execute any change.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute: async () => { setGenerated(true); return { status: "draft", steps: 7, executionPerformed: false }; } });
    return () => lifecycle.abort();
  }, []);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><ShieldCheck size={19}/></div><div><b>ChangeGuard</b><span>Change intelligence</span></div></div>
      <nav aria-label="Primary navigation"><p className="nav-label">Workspace</p>{nav.map(([label, Icon]) => <button key={label} className={activeNav === label ? "nav-item active" : "nav-item"} onClick={() => setActiveNav(label)}><Icon size={17}/><span>{label}</span>{label === "Changes" && <em>4</em>}</button>)}</nav>
      <div className="sidebar-footer"><div className="mock-chip"><span/> MOCK MODE</div><p>Analysis only. No infrastructure changes can be executed.</p><div className="version"><span className="healthy"/>All systems operational</div><span>ChangeGuard v0.1.0</span></div>
    </aside>
    <main>
      <header className="topbar"><div className="mobile-brand"><ShieldCheck size={20}/><b>ChangeGuard</b></div><div className="context"><span>Production</span><ChevronDown size={14}/><i/><span>Last sync 42 sec ago</span></div><div className="top-actions"><button aria-label="Notifications"><Bell size={18}/><span className="notification"/></button><div className="avatar">MR</div><div className="profile"><b>Marcus Riddick</b><span>Administrator</span></div></div></header>
      <div className="content">
        <section className="page-heading"><div><div className="eyebrow"><Activity size={13}/> ACTIVE ANALYSIS</div><h1>Decommission SERVER17</h1><p>Dependency and risk assessment before infrastructure change</p></div><div className="heading-actions"><Button variant="outline" onClick={runAnalysis} disabled={analyzing}><Play size={15}/>{analyzing ? "Analyzing…" : "Run analysis"}</Button><Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogTrigger render={<Button><Sparkles size={15}/>Generate change plan</Button>}/><DialogContent className="dark-dialog"><DialogHeader><DialogTitle>Generate a safe change plan</DialogTitle><DialogDescription>ChangeGuard will create reviewable preparation, execution, validation, and rollback steps. It will not execute any change.</DialogDescription></DialogHeader><label className="field-label">Change owner<Input defaultValue="Infrastructure Operations" /></label><label className="field-label">Change window<Input defaultValue="Saturday, 10:00 PM–12:00 AM ET" /></label><label className="field-label">Additional constraints<Textarea placeholder="Add maintenance window, business owner, or rollback requirements…" /></label><Button onClick={createPlan}><Sparkles size={15}/>Generate draft plan</Button></DialogContent></Dialog></div></section>
        <section className="overview-grid">
          <article className="risk-card panel"><div className="panel-label"><Gauge size={15}/> RISK ASSESSMENT</div><div className="risk-main"><div className="risk-ring"><span>78</span><small>/100</small></div><div><Badge className="risk-badge">HIGH RISK</Badge><h2>Action required before change</h2><p>Critical dependencies indicate a high likelihood of service disruption.</p></div></div><div className="risk-factors"><div><span>Dependency criticality</span><b>34 / 40</b><Progress value={85}/></div><div><span>Blast radius</span><b>24 / 30</b><Progress value={80}/></div><div><span>Evidence uncertainty</span><b>20 / 30</b><Progress value={66}/></div></div></article>
          <article className="summary-card panel"><div className="panel-label"><BarChart3 size={15}/> FINDINGS SUMMARY</div><div className="finding-stats"><div className="blocker"><b>1</b><span>Blocker</span></div><div className="warning"><b>3</b><span>Warnings</span></div><div className="info"><b>2</b><span>Information</span></div><div className="unknown"><b>1</b><span>Unknown</span></div></div><div className="coverage"><div><span>Evidence coverage</span><b>86%</b></div><Progress value={86}/><p><CheckCircle2 size={14}/> 6 of 6 systems queried successfully</p></div></article>
          <article className="recommendation panel"><div className="panel-label"><Sparkles size={15}/> AI RECOMMENDATION <Badge variant="outline">Confidence 92%</Badge></div><h2>Do not decommission SERVER17 at this time.</h2><p>Resolve the production SQL alias, migrate active monitoring references, and reissue the TLS certificate before proceeding.</p><button onClick={() => setDialogOpen(true)}>Review recommended actions <ChevronRight size={15}/></button></article>
        </section>
        {generated && <section className="plan-banner"><div><FileClock size={18}/><span><b>Draft change plan ready</b> · 7 reviewable steps with validation and rollback checkpoints</span></div><Button size="sm" variant="outline" onClick={() => toast.info("Plan opened in review mode")}>Review plan</Button></section>}
        <section className="work-grid">
          <article className="panel dependencies"><div className="panel-head"><div><div className="panel-label"><Waypoints size={15}/> DEPENDENCY MAP</div><p>Observed relationships across connected systems</p></div><Badge variant="outline">12 dependencies</Badge></div><div className="graph" aria-label="Dependency graph"><div className="graph-lines"><span className="l1"/><span className="l2"/><span className="l3"/><span className="l4"/><span className="l5"/><span className="l6"/></div><div className="node server-node"><Server size={22}/><b>SERVER17</b><small>Windows Server 2022</small></div><div className="node n1"><Database size={17}/><b>SQLPROD</b><small>DNS alias</small></div><div className="node n2"><Activity size={17}/><b>Prometheus</b><small>Active target</small></div><div className="node n3"><BarChart3 size={17}/><b>Grafana</b><small>6 dashboards</small></div><div className="node n4"><ShieldCheck size={17}/><b>TLS cert</b><small>Active</small></div><div className="node n5"><Network size={17}/><b>AD object</b><small>Enabled</small></div><div className="node n6"><Zap size={17}/><b>Tenable.sc</b><small>2 findings</small></div></div></article>
          <article className="panel evidence"><Tabs defaultValue="findings"><div className="panel-head tabs-head"><TabsList><TabsTrigger value="findings">Findings</TabsTrigger><TabsTrigger value="systems">Systems</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList><div className="search"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter findings" aria-label="Filter findings"/></div></div><TabsContent value="findings" className="finding-list">{filtered.map(item => <div className="finding" key={item.title}><div className={`finding-icon ${item.level.toLowerCase()}`}><item.icon size={17}/></div><div><div className="finding-title"><Badge className={item.level.toLowerCase()}>{item.level}</Badge><b>{item.title}</b></div><p>{item.detail}</p><span>{item.source} · {item.time}</span></div><ChevronRight size={17}/></div>)}{filtered.length === 0 && <div className="empty">No findings match “{query}”.</div>}</TabsContent><TabsContent value="systems" className="system-list">{systems.map(([name,detail,color]) => <div key={name}><span className="system-dot" style={{background:color}}/><div><b>{name}</b><p>{detail}</p></div><Badge variant="outline">Connected</Badge></div>)}</TabsContent><TabsContent value="history" className="history-list"><div><Clock3 size={17}/><span><b>Analysis refreshed</b><small>Today, 6:42 PM · Marcus Riddick</small></span></div><div><FileClock size={17}/><span><b>Change request created</b><small>Today, 6:28 PM · Mock mode</small></span></div></TabsContent></Tabs></article>
        </section>
      </div>
    </main><Toaster theme="dark" position="bottom-right" richColors/>
  </div>;
}
