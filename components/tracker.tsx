"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Brand } from "@/components/brand";
import styles from "@/app/tracker.module.css";

type Kind = "Project" | "Workstream" | "Module" | "Submodule" | "Activity";
export type Item = { id: string; parent: string | null; kind: Kind; name: string; progress: number; owner: string; due: string; priority: string; notes: string; blocked?: boolean; blocker?: string; archived?: boolean };
const children: Record<Kind, Kind[]> = {
  Project: ["Workstream"], Workstream: ["Module"], Module: ["Submodule", "Activity"], Submodule: ["Activity"], Activity: [],
};

export function descendants(items: Item[], id: string): Item[] {
  return items.filter(item => item.parent === id).flatMap(item => [item, ...descendants(items, item.id)]);
}

function progressOf(activities: Item[]) {
  return activities.length ? Math.round(activities.reduce((sum, item) => sum + item.progress, 0) / activities.length) : null;
}

function todayKey() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export default function Tracker({items, saveProject, canEdit, accessPanel}: {
  items: Item[];
  saveProject: (id: string, items: Item[]) => Promise<void>;
  canEdit: (id: string) => boolean;
  accessPanel: (id: string) => ReactNode;
}) {
  const [storageError, setStorageError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Item | null>(null);
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("");
  const [showArchive, setShowArchive] = useState(false);

  const project = items.find(item => item.id === selected && !item.archived);
  const editable = Boolean(project && canEdit(project.id));
  const projects = items.filter(item => item.kind === "Project" && !item.archived);
  const projectItems = project ? descendants(items, project.id) : [];
  const activeItems = items.filter(item => !item.archived);
  const activeProjectItems = project ? descendants(activeItems, project.id) : [];
  const activities = activeProjectItems.filter(item => item.kind === "Activity");
  const archived = project ? projectItems.filter(item => item.archived) : items.filter(item => item.kind === "Project" && item.archived);
  const workstreams = activeProjectItems.filter(item => item.kind === "Workstream");
  const completed = activities.filter(item => item.progress === 100).length;
  const progress = progressOf(activities);
  const today = todayKey();
  const overdue = (item: Item) => Boolean(item.due && item.due < today && item.progress < 100);
  const search = query.trim().toLowerCase();
  const filtering = Boolean(search || owner || priority || status);
  const matchesActivity = (item: Item) => {
    const text = [item.name, item.owner, item.notes, item.blocker].join(" ").toLowerCase();
    return (!search || text.includes(search))
      && (!owner || (owner === "__unassigned" ? !item.owner : item.owner === owner))
      && (!priority || (priority === "__unassigned" ? !item.priority : item.priority === priority))
      && (!status
        || (status === "blocked" && item.blocked)
        || (status === "overdue" && overdue(item))
        || (status === "completed" && item.progress === 100)
        || (status === "in-progress" && item.progress > 0 && item.progress < 100)
        || (status === "not-started" && item.progress === 0));
  };
  const visibleIds = new Set<string>();
  for (const item of activities.filter(matchesActivity)) {
    let current: Item | undefined = item;
    while (current) {
      visibleIds.add(current.id);
      current = activeItems.find(candidate => candidate.id === current?.parent);
    }
  }
  const destinations = draft && project
    ? [project, ...activeProjectItems].filter(item => children[item.kind].includes(draft.kind))
    : [];

  function resetView() {
    setQuery("");
    setOwner("");
    setPriority("");
    setStatus("");
    setShowArchive(false);
  }

  function add(kind: Kind, parent: string | null) {
    setDraft({ id: crypto.randomUUID(), parent, kind, name: "", progress: 0, owner: "", due: "", priority: "", notes: "" });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !draft.name.trim() || saving || (draft.kind !== "Project" && !editable)) return;
    const entry = { ...draft, name: draft.name.trim() };
    const next = items.some(item => item.id === entry.id)
      ? items.map(item => item.id === entry.id ? entry : item)
      : [...items, entry];
    if (!await persist(entry.kind === "Project" ? entry.id : project!.id, next)) return;
    if (entry.kind === "Project") {
      if (selected !== entry.id) resetView();
      setSelected(entry.id);
    }
    setDraft(null);
  }

  async function persist(projectId: string, next: Item[]) {
    if (saving) return false;
    setSaving(true);
    setStorageError("");
    try {
      await saveProject(projectId, next);
      return true;
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Your changes could not be saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(item: Item) {
    const projectId = item.kind === "Project" ? item.id : selected;
    if (!projectId || !canEdit(projectId)) return;
    if (!await persist(projectId, items.map(entry => entry.id === item.id ? { ...entry, archived: !entry.archived } : entry))) return;
    setDraft(null);
    if (item.id === selected) {
      resetView();
      setSelected(null);
      setShowArchive(true);
    }
  }

  function reorder(item: Item, direction: number) {
    if (!selected || !editable) return;
    const siblings = activeItems.filter(entry => entry.parent === item.parent);
    const sibling = siblings[siblings.indexOf(item) + direction];
    if (!sibling) return;
    void persist(selected, items.map(entry => entry.id === item.id ? sibling : entry.id === sibling.id ? item : entry));
  }

  function renderChildren(parent: Item) {
    const siblings = activeItems.filter(item => item.parent === parent.id);
    return siblings.map((item, index) => {
      if (filtering && !visibleIds.has(item.id)) return null;
      return <li key={item.id}>
        <div className={styles.row}>
          <div>
            <small>{item.kind}</small><strong>{item.name}</strong>
            {item.kind === "Activity" && <small>{[item.owner, item.priority, item.due && "Due " + item.due].filter(Boolean).join(" · ")}</small>}
            {item.blocked && <small className={styles.flag}>Blocked{item.blocker ? ` · ${item.blocker}` : ""}</small>}
            {item.kind === "Activity" && overdue(item) && <small className={styles.flag}>Overdue</small>}
          </div>
          <div className={styles.actions}>
            {item.kind === "Activity" && <span>{item.progress}%</span>}
            {editable && <><button className="button" aria-label={`Edit ${item.name}`} onClick={() => setDraft(item)}>Edit</button>
            {children[item.kind].map(kind => <button className="button" key={kind} onClick={() => add(kind, item.id)}>Add {kind}</button>)}
            <button className="button" aria-label={`Move ${item.name} up`} disabled={index === 0 || filtering} onClick={() => reorder(item, -1)}>↑</button>
            <button className="button" aria-label={`Move ${item.name} down`} disabled={index === siblings.length - 1 || filtering} onClick={() => reorder(item, 1)}>↓</button>
            <button className="button" aria-label={`Archive ${item.name}`} onClick={() => toggleArchive(item)}>Archive</button></>}
          </div>
        </div>
        {children[item.kind].length > 0 && <ul className={styles.tree}>{renderChildren(item)}</ul>}
      </li>;
    });
  }

  return <>
    <header className={styles.header}><Brand /><span>Project Tracker</span></header>
    <main id="main-content" className={styles.main}>
      <div className={styles.heading}>
        <div>
          {project && <button className={styles.back} onClick={() => { setSelected(null); setDraft(null); resetView(); }}>← All projects</button>}
          <h1>{project ? project.name : "Projects"}</h1>
        </div>
        {project
          ? editable && <div className={styles.actions}><button className="button" onClick={() => setDraft(project)}>Edit Project</button><button className="button" onClick={() => toggleArchive(project)}>Archive Project</button><button className="button primary" onClick={() => add("Workstream", project.id)}>Add Workstream</button></div>
          : <button className="button primary" onClick={() => add("Project", null)}>Create Project</button>}
      </div>

      {<div className={styles.archive}>
        <button type="button" className="button" aria-expanded={showArchive} onClick={() => setShowArchive(!showArchive)}>
          {showArchive ? "Hide archive" : `View archive (${archived.length})`}
        </button>
        {showArchive && <section aria-label="Archived items" className={styles.panel}>
          {archived.length ? <ul className={styles.tree}>{archived.map(item => <li className={styles.row} key={item.id}>
            <span>{item.kind} · {item.name}</span>
            <button disabled={saving || !canEdit(item.kind === "Project" ? item.id : selected ?? "")} className="button" aria-label={`Restore ${item.name}`} onClick={() => toggleArchive(item)}>Restore</button>
          </li>)}</ul> : <p>No archived items.</p>}
        </section>}
      </div>}
      {storageError && <p role="alert" className={styles.error}>{storageError}</p>}
      {draft && <form className={styles.panel} onSubmit={save} key={draft.id}>
        <h2>{items.some(item => item.id === draft.id) ? "Edit" : "New"} {draft.kind}</h2>
        <div className={styles.fields}>
          <label>Name<input autoFocus required maxLength={120} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
          {draft.parent && destinations.length > 1 && <label>Parent<select value={draft.parent} onChange={e => setDraft({ ...draft, parent: e.target.value })}>
            {destinations.map(item => <option key={item.id} value={item.id}>
              {item.kind} · {item.name}{item.parent ? ` (${items.find(parent => parent.id === item.parent)?.name ?? ""})` : ""}
            </option>)}
          </select></label>}
          {draft.kind === "Activity" && <>
            <label>Owner<input value={draft.owner} onChange={e => setDraft({ ...draft, owner: e.target.value })} /></label>
            <label>Priority<select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })}><option value="">Unassigned</option><option>Must Have</option><option>Should Have</option><option>Nice to Have</option></select></label>
            <label>Due date<input type="date" value={draft.due} onChange={e => setDraft({ ...draft, due: e.target.value })} /></label>
            <label>Progress (%)<input type="number" min={0} max={100} required value={draft.progress} onChange={e => setDraft({ ...draft, progress: Number(e.target.value) })} /></label>
            <label className={styles.checkbox}><input type="checkbox" checked={Boolean(draft.blocked)} onChange={e => setDraft({ ...draft, blocked: e.target.checked })} />Blocked</label>
            {draft.blocked && <label>Blocker reason<input required value={draft.blocker ?? ""} onChange={e => setDraft({ ...draft, blocker: e.target.value })} /></label>}
            <label>Notes<textarea rows={3} value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></label>
          </>}
        </div>
        <div className={styles.actions}><button type="button" className="button" onClick={() => setDraft(null)}>Cancel</button><button className="button primary" disabled={saving || !draft.name.trim() || Boolean(draft.blocked && !draft.blocker?.trim())}>Save</button></div>
      </form>}

      {project ? <>
        {accessPanel(project.id)}
        <section className={styles.summary} aria-label="Project summary">
          <div><small>Overall progress</small><strong>{progress === null ? "—" : progress + "%"}</strong></div>
          <div><small>Activities</small><strong>{activities.length}</strong></div>
          <div><small>Completed</small><strong>{completed}</strong></div>
          <div><button className={styles.metric} onClick={() => { setQuery(""); setOwner(""); setPriority(""); setStatus("overdue"); }}>Overdue</button><strong>{activities.filter(overdue).length}</strong></div>
          <div><button className={styles.metric} onClick={() => { setQuery(""); setOwner(""); setPriority(""); setStatus("blocked"); }}>Blocked</button><strong>{activities.filter(item => item.blocked).length}</strong></div>
        </section>
        <h2 className={styles.sectionTitle}>Workstream progress</h2>
        {workstreams.length ? <ul className={`${styles.projects} ${styles.workstreams}`}>
          {workstreams.map(item => {
            const tasks = descendants(activeItems, item.id).filter(child => child.kind === "Activity");
            const value = progressOf(tasks);
            return <li className={styles.panel} key={item.id}>
              <strong>{item.name}</strong>
              {value === null ? <p>No activities</p> : <><p>{value}% · {tasks.length} {tasks.length === 1 ? "activity" : "activities"}</p><progress aria-label={`${item.name} progress`} value={value} max={100} /></>}
            </li>;
          })}
        </ul> : <p className={styles.panel}>Add a workstream to start organizing this project.</p>}

        {workstreams.length > 0 && <>
          <h2 className={styles.sectionTitle}>Project activities</h2>
          <div className={`${styles.fields} ${styles.filters}`}>
            <label>Search activities<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, owner, or notes" /></label>
            <label>Filter by owner<select value={owner} onChange={e => setOwner(e.target.value)}><option value="">All owners</option><option value="__unassigned">Unassigned</option>{[...new Set(activities.map(item => item.owner).filter(Boolean))].sort().map(value => <option key={value}>{value}</option>)}</select></label>
            <label>Filter by priority<select value={priority} onChange={e => setPriority(e.target.value)}><option value="">All priorities</option><option value="__unassigned">Unassigned</option><option>Must Have</option><option>Should Have</option><option>Nice to Have</option></select></label>
            <label>Filter by status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option><option value="not-started">Not started</option><option value="in-progress">In progress</option><option value="completed">Completed</option><option value="blocked">Blocked</option><option value="overdue">Overdue</option></select></label>
          </div>
          {filtering && <div className={styles.filterSummary}><p role="status">{activities.filter(matchesActivity).length} matching activities</p><button className="button" onClick={resetView}>Clear filters</button></div>}
          <ul className={styles.tree}>{renderChildren(project)}</ul>
        </>}
      </> : projects.length ? <ul className={styles.projects}>
        {projects.map(item => <li key={item.id}><button className={styles.projectCard} onClick={() => { setSelected(item.id); setDraft(null); resetView(); }}>{item.name}<span aria-hidden="true">→</span></button></li>)}
      </ul> : <section className={styles.panel}><h2>No projects yet</h2><p>Create a project to start tracking work.</p></section>}
    </main>
  </>;
}
