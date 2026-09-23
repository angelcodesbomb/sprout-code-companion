import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

const agents = [
  { name: "UI", status: "idle", tone: "pink", description: "Checks layouts and components" },
  { name: "Database", status: "idle", tone: "cyan", description: "Understands your data model" },
  { name: "API", status: "active", tone: "mint", description: "Maps requests and responses" },
  { name: "Review", status: "active", tone: "coral", description: "Reviews code in context" },
  { name: "Security", status: "idle", tone: "pink", description: "Looks for risky patterns" },
  { name: "Validation", status: "idle", tone: "cyan", description: "Checks inputs and edge cases" },
];
const files = [
  { name: "src", type: "folder", position: "root", tone: "coral", description: "The main home for everything your app runs." },
  { name: "components", type: "folder", position: "mid-left", tone: "pink", description: "Reusable pieces that make up the interface." },
  { name: "lib", type: "folder", position: "mid-right", tone: "mint", description: "Shared helpers used across the project." },
  { name: "Button.jsx", type: "file", position: "low-left", tone: "cyan", description: "A reusable button with consistent styles and behavior." },
  { name: "FileMap.jsx", type: "file", position: "low-center", tone: "coral", description: "Draws the visual map of files and their connections." },
  { name: "api.js", type: "file", position: "low-right", tone: "mint", description: "Keeps all communication with outside services in one place." },
];
const codeBlocks = [
  { id: "imports", title: "Brings in the tools", explanation: "These lines import React's state helper and the project service that knows how to fetch files.", lines: [{ number: 1, html: '<b>import</b> { useState } <b>from</b> <em>"react"</em>;' }, { number: 2, html: '<b>import</b> { getFiles } <b>from</b> <em>"../lib/project"</em>;' }] },
  { id: "hook", title: "Creates the file-list helper", explanation: "This custom hook keeps the current file list and loading state together so any screen can reuse them.", lines: [{ number: 4, html: '<b>export function</b> <mark>useProjectFiles</mark>(projectId) {' }, { number: 5, html: '  <b>const</b> [files, setFiles] = useState([]);' }, { number: 6, html: '  <b>const</b> [loading, setLoading] = useState(<u>true</u>);' }] },
  { id: "load", title: "Loads and stores the files", explanation: "This function asks for the project's files, saves the result, and then marks loading as finished.", lines: [{ number: 8, html: '  <b>async function</b> <mark>loadFiles</mark>() {' }, { number: 9, html: '    <b>const</b> result = <b>await</b> getFiles(projectId);' }, { number: 10, html: '    setFiles(result);' }, { number: 11, html: '    setLoading(<u>false</u>);' }, { number: 12, html: '  }' }] },
  { id: "return", title: "Shares what the screen needs", explanation: "The hook gives other components the file list, loading status, and a function to refresh everything.", lines: [{ number: 14, html: '  <b>return</b> { files, loading, refresh: loadFiles };' }, { number: 15, html: '}' }] },
];

export const Route = createFileRoute("/workspace")({
  head: () => ({ meta: [
    { title: "Workspace — Sprout" },
    { name: "description", content: "Explore a visual codebase map and plain-English code explanations in Sprout." },
    { property: "og:title", content: "Sprout Workspace" },
    { property: "og:description", content: "Explore a visual codebase map and clear code explanations." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ]}),
  component: Workspace,
});

function Workspace() {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => { document.documentElement.classList.toggle("dark", isDark); return () => document.documentElement.classList.remove("dark"); }, [isDark]);
  return <DashboardShell agents={agents} files={files} codeBlocks={codeBlocks} isDark={isDark} onThemeToggle={() => setIsDark((value) => !value)}/>;
}
