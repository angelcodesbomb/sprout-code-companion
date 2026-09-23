import { AnimatePresence, motion } from "motion/react";
import { Code2, GitBranch, Search, Settings } from "lucide-react";
import { useState } from "react";
import { SproutMark } from "../shared/SproutMark";
import { ThemeToggle } from "../shared/ThemeToggle";
import { AgentSidebar } from "../agents/AgentSidebar";
import { FileSystemMap } from "../filemap/FileSystemMap";
import { CodeExplainer } from "../editor/CodeExplainer";

export function DashboardShell({ agents, files, codeBlocks, isDark, onThemeToggle }) {
  const [view, setView] = useState("map");
  const [activeAgent, setActiveAgent] = useState("Review");
  return (
    <main className="dashboard-shell">
      <header className="dashboard-topbar">
        <a href="/" className="dashboard-topbar__brand"><SproutMark /></a>
        <div className="project-chip"><span>SP</span><div><small>CURRENT PROJECT</small><strong>sprout-app</strong></div></div>
        <label className="dashboard-search"><Search size={15}/><input aria-label="Search project" placeholder="Search project..." /></label>
        <ThemeToggle isDark={isDark} onToggle={onThemeToggle}/><button className="icon-control" type="button" aria-label="Settings"><Settings size={18}/></button>
      </header>
      <div className="dashboard-body">
        <AgentSidebar agents={agents} activeAgent={activeAgent} onAgentSelect={setActiveAgent}/>
        <div className="dashboard-main">
          <div className="workspace-tabs" role="tablist" aria-label="Workspace views">
            <button type="button" role="tab" aria-selected={view === "map"} className={view === "map" ? "is-active" : ""} onClick={() => setView("map")}><GitBranch size={16}/> File map</button>
            <button type="button" role="tab" aria-selected={view === "code"} className={view === "code" ? "is-active" : ""} onClick={() => setView("code")}><Code2 size={16}/> Explain code</button>
            <span className="workspace-tabs__status"><i/> {activeAgent} agent is active</span>
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={view} className="workspace-view" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: .22 }}>
              {view === "map" ? <FileSystemMap nodes={files} title="See how everything connects." subtitle="Hover over a file to understand its job."/> : <CodeExplainer title="Code, without the code-speak." fileName="useProjectFiles.js" blocks={codeBlocks}/>} 
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
