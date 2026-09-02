"use client";

import { useMemo, useState } from "react";
import { Bookmark, Check, Edit3, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import type { MemoryRecord, MemoryType } from "@companion/shared";
import { Modal } from "./Modal";

const categories: Array<{ label: string; value: "all" | MemoryType }> = [
  { label: "All", value: "all" },
  { label: "About you", value: "semantic" },
  { label: "People", value: "relationship" },
  { label: "Interests", value: "preference" },
  { label: "Important events", value: "episodic" },
  { label: "Goals", value: "goal" },
  { label: "Mood & context", value: "emotional" },
  { label: "Shared", value: "shared" },
];

export function MemoryView({ memories, enabled, companionName, onToggle, onUpdate, onDelete, onAdd }: {
  memories: MemoryRecord[];
  enabled: boolean;
  companionName: string;
  onToggle: () => void;
  onUpdate: (memory: MemoryRecord) => void;
  onDelete: (memoryId: string) => void;
  onAdd: (content: string, type: MemoryType) => void;
}) {
  const [filter, setFilter] = useState<"all" | MemoryType>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<MemoryRecord | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [type, setType] = useState<MemoryType>("semantic");
  const visible = useMemo(() => memories.filter((memory) => memory.status === "active" && (filter === "all" || memory.type === filter) && memory.content.toLowerCase().includes(query.toLowerCase())), [filter, memories, query]);

  return (
    <section className="workspace memory-view" aria-labelledby="memory-title">
      <header className="workspace-header workspace-header--text">
        <div><span className="eyebrow">Continuity you control</span><h1 id="memory-title">Memory</h1><p>{enabled ? `${visible.length} active ${visible.length === 1 ? "memory" : "memories"}. Personal details and meaningful conversation moments are remembered automatically and stay inspectable.` : "Memory is paused. Conversation can continue without new memories."}</p></div>
        <div className="header-actions"><button type="button" className="button button--ghost" onClick={onToggle}>{enabled ? "Pause memory" : "Resume memory"}</button><button type="button" className="button button--primary" onClick={() => setAdding(true)} disabled={!enabled}><Plus aria-hidden="true" /> Add memory</button></div>
      </header>

      <div className="memory-toolbar">
        <label className="search-field"><Search aria-hidden="true" /><span className="visually-hidden">Search memories</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search what ${companionName} remembers`} /></label>
        <div className="filter-row" role="tablist" aria-label="Memory categories">{categories.map((category) => <button type="button" role="tab" aria-selected={filter === category.value} key={category.value} onClick={() => setFilter(category.value)}>{category.label}</button>)}</div>
      </div>

      {!enabled ? <div className="empty-state"><X aria-hidden="true" /><h2>Memory is paused</h2><p>No new memories will be suggested until you resume it. Existing memories remain available to review or delete.</p></div> : null}
      {enabled && visible.length === 0 ? <div className="empty-state"><Search aria-hidden="true" /><h2>No matching memories</h2><p>Try another phrase or add something you explicitly want {companionName} to remember.</p></div> : null}

      <div className="memory-list">
        {enabled ? visible.map((memory) => (
          <article key={memory.id} className="memory-row">
            <div className={`memory-type memory-type--${memory.type}`}><Sparkles aria-hidden="true" /></div>
            <div className="memory-row__content"><span>{memory.type.replace("episodic", "important event")}</span><p>{memory.content}</p><small>Source: conversation · {Math.round(memory.confidence * 100)}% confidence</small></div>
            <div className="memory-row__actions">
              <button type="button" className={memory.pinned ? "icon-button icon-button--active" : "icon-button"} aria-label={memory.pinned ? "Unpin memory" : "Pin memory"} onClick={() => onUpdate({ ...memory, pinned: !memory.pinned, updatedAt: new Date().toISOString() })}><Bookmark aria-hidden="true" /></button>
              <button type="button" className="icon-button" aria-label="Edit memory" onClick={() => { setEditing(memory); setDraft(memory.content); }}><Edit3 aria-hidden="true" /></button>
              <button type="button" className="icon-button icon-button--danger" aria-label="Delete memory" onClick={() => onDelete(memory.id)}><Trash2 aria-hidden="true" /></button>
            </div>
          </article>
        )) : null}
      </div>

      {editing ? <Modal title="Correct this memory" description="Corrections replace the active wording and keep the memory under your control." onClose={() => setEditing(null)}><label className="field">Memory<textarea rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} /></label><div className="modal-actions"><button type="button" className="button button--ghost" onClick={() => setEditing(null)}>Cancel</button><button type="button" className="button button--primary" disabled={!draft.trim()} onClick={() => { onUpdate({ ...editing, content: draft.trim(), normalizedContent: draft.trim().toLowerCase(), updatedAt: new Date().toISOString() }); setEditing(null); }}><Check aria-hidden="true" /> Save correction</button></div></Modal> : null}

      {adding ? <Modal title="Add a memory" description="Only add something you want used for future continuity." onClose={() => setAdding(false)}><label className="field">Category<select value={type} onChange={(event) => setType(event.target.value as MemoryType)}>{categories.filter((category) => category.value !== "all").map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label><label className="field">What should {companionName} remember?<textarea rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} /></label><div className="modal-actions"><button type="button" className="button button--ghost" onClick={() => setAdding(false)}>Cancel</button><button type="button" className="button button--primary" disabled={!draft.trim()} onClick={() => { onAdd(draft.trim(), type); setDraft(""); setAdding(false); }}><Plus aria-hidden="true" /> Add memory</button></div></Modal> : null}
    </section>
  );
}
