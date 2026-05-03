"use client";

import { useState, useMemo, FormEvent } from "react";
import { Plus, ListChecks, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

type ListItem = {
  id: string;
  text: string;
  completed: boolean;
  position: number;
  created_at: string;
};

type List = {
  id: string;
  name: string;
  type: string;
  emoji: string | null;
  color: string | null;
  position: number;
  list_items: ListItem[];
  created_at: string;
  updated_at: string;
};

type Props = {
  initialLists: List[];
};

export function ListsView({ initialLists }: Props) {
  const [lists, setLists] = useState<List[]>(initialLists);
  const [showCreate, setShowCreate] = useState(false);

  const stats = useMemo(() => {
    let openItems = 0;
    let completedItems = 0;
    for (const l of lists) {
      for (const i of l.list_items) {
        if (i.completed) completedItems++;
        else openItems++;
      }
    }
    return {
      activeLists: lists.length,
      openItems,
      completedItems,
    };
  }, [lists]);

  async function createList(name: string, type: string) {
    const res = await fetch("/api/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, type }),
    });
    if (!res.ok) {
      toast.error("Failed to create list");
      return;
    }
    const data = await res.json();
    setLists((ls) => [...ls, { ...data.list, list_items: [] }]);
    setShowCreate(false);
  }

  async function addItem(listId: string, text: string) {
    const res = await fetch(`/api/lists/${listId}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      toast.error("Failed to add item");
      return;
    }
    const data = await res.json();
    setLists((ls) =>
      ls.map((l) =>
        l.id === listId ? { ...l, list_items: [...l.list_items, data.item] } : l
      )
    );
  }

  async function toggleItem(listId: string, itemId: string, completed: boolean) {
    setLists((ls) =>
      ls.map((l) =>
        l.id === listId
          ? {
              ...l,
              list_items: l.list_items.map((i) =>
                i.id === itemId ? { ...i, completed } : i
              ),
            }
          : l
      )
    );
    await fetch(`/api/list-items/${itemId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completed }),
    });
  }

  async function deleteList(id: string) {
    if (!confirm("Delete this list?")) return;
    const prev = lists;
    setLists((ls) => ls.filter((l) => l.id !== id));
    const res = await fetch(`/api/lists/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setLists(prev);
      toast.error("Failed to delete");
    }
  }

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ListChecks className="size-7" /> Lists
          </h1>
          <p className="text-zinc-400">Read view from shared Supabase. Brain has full CRUD.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="brand-gradient rounded-lg px-4 py-2 text-white text-sm font-semibold flex items-center gap-2"
        >
          <Plus className="size-4" /> New list
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Active Lists" value={stats.activeLists} />
        <StatCard label="Open Items" value={stats.openItems} accent="text-amber-400" />
        <StatCard label="Completed" value={stats.completedItems} accent="text-green-400" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {lists.length === 0 && (
          <div className="col-span-full glass-strong rounded-2xl p-8 text-center">
            <ListChecks className="size-12 mx-auto text-zinc-600 mb-3" />
            <h3 className="font-bold mb-1">No lists yet</h3>
            <p className="text-xs text-zinc-500 mb-4">
              Create your first list to get started.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="brand-gradient rounded-lg px-4 py-2 text-white text-sm font-semibold inline-flex items-center gap-2"
            >
              <Plus className="size-4" /> New list
            </button>
          </div>
        )}

        {lists.map((list) => (
          <ListCard
            key={list.id}
            list={list}
            onAddItem={(text) => addItem(list.id, text)}
            onToggleItem={(itemId, completed) =>
              toggleItem(list.id, itemId, completed)
            }
            onDelete={() => deleteList(list.id)}
          />
        ))}
      </div>

      {showCreate && (
        <CreateListModal
          onClose={() => setShowCreate(false)}
          onCreate={createList}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: string;
}) {
  return (
    <div className="glass rounded-xl p-3 text-center">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className={`text-2xl font-bold ${accent ?? ""}`}>{value}</div>
    </div>
  );
}

function ListCard({
  list,
  onAddItem,
  onToggleItem,
  onDelete,
}: {
  list: List;
  onAddItem: (text: string) => void;
  onToggleItem: (itemId: string, completed: boolean) => void;
  onDelete: () => void;
}) {
  const [adding, setAdding] = useState("");
  const items = [...list.list_items].sort((a, b) => a.position - b.position);
  const open = items.filter((i) => !i.completed).length;
  const total = items.length;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!adding.trim()) return;
    onAddItem(adding);
    setAdding("");
  }

  return (
    <div className="glass rounded-xl p-5 hover:bg-white/8 group">
      <div className="flex justify-between items-start mb-2">
        <div>
          <span className="text-2xl">{list.emoji ?? "📋"}</span>
          <h3 className="font-bold inline-block ml-2">{list.name}</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 rounded-full bg-amber-500/20 text-amber-300">
            {total - open}/{total}
          </span>
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 size-7 hover:bg-red-500/20 rounded-full flex items-center justify-center text-red-400"
            title="Delete list"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <ul className="text-sm space-y-1 ml-1">
        {items.length === 0 && (
          <li className="text-xs text-zinc-500 italic">No items yet</li>
        )}
        {items.slice(0, 6).map((i) => (
          <li
            key={i.id}
            className={`flex items-center gap-2 cursor-pointer ${
              i.completed ? "text-zinc-500 line-through" : "text-zinc-300"
            }`}
            onClick={() => onToggleItem(i.id, !i.completed)}
          >
            <span
              className={`size-3.5 border rounded ${
                i.completed
                  ? "bg-green-500/30 border-green-400/40"
                  : "border-white/30"
              } flex items-center justify-center`}
            >
              {i.completed && <span className="text-[10px] text-green-300">✓</span>}
            </span>
            <span className="truncate">{i.text}</span>
          </li>
        ))}
        {items.length > 6 && (
          <li className="text-xs text-zinc-500 italic">
            + {items.length - 6} more
          </li>
        )}
      </ul>

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          type="text"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="+ Add item"
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={!adding.trim()}
          className="brand-gradient rounded-lg px-3 py-1.5 text-white text-xs font-semibold disabled:opacity-50"
        >
          Add
        </button>
      </form>
    </div>
  );
}

function CreateListModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, type: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("custom");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    await onCreate(name.trim(), type);
    setSubmitting(false);
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="glass-strong rounded-2xl p-6 w-full max-w-md"
      >
        <h2 className="text-xl font-bold mb-4">New list</h2>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Name *</label>
            <input
              autoFocus
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Home Depot run"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Template</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: "shopping", label: "🛒 Shopping" },
                { v: "todo", label: "✅ Todo" },
                { v: "project", label: "🏗️ Project" },
                { v: "habit", label: "💪 Habit" },
                { v: "goal", label: "🎯 Goal" },
                { v: "custom", label: "📋 Custom" },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setType(opt.v)}
                  className={`text-xs px-2 py-2 rounded-lg ${
                    type === opt.v
                      ? "brand-gradient text-white"
                      : "bg-white/5 text-zinc-300 hover:bg-white/10"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 hover:bg-white/5 rounded-lg text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || submitting}
            className="brand-gradient rounded-lg px-5 py-2 text-white font-semibold text-sm disabled:opacity-50 flex items-center gap-2"
          >
            {submitting && <Loader2 className="size-3.5 animate-spin" />}
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
