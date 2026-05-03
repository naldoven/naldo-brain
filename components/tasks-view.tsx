"use client";

import { useState, useMemo, FormEvent } from "react";
import { Plus, Check, Trash2, MoreVertical, CheckCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Board = {
  id: string;
  name: string;
  color: string | null;
  emoji: string | null;
  position: number;
};

type Task = {
  id: string;
  user_id: string;
  board_id: string | null;
  title: string;
  description: string | null;
  status: "queue" | "this_week" | "today" | "in_progress" | "done";
  priority: "high" | "medium" | "low";
  time_estimate: string | null;
  due_at: string | null;
  flagged: boolean;
  position: number;
};

type Props = {
  initialBoards: Board[];
  initialTasks: Task[];
};

export function TasksView({ initialBoards, initialTasks }: Props) {
  const [boards, setBoards] = useState<Board[]>(initialBoards);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);

  const tasksByBoard = useMemo(() => {
    const map = new Map<string | null, Task[]>();
    for (const t of tasks) {
      const k = t.board_id;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    }
    return map;
  }, [tasks]);

  const totalToday = tasks.filter((t) => t.status === "today").length;
  const doneToday = 0; // Phase 2 — done tasks aren't loaded; could fetch separately

  async function completeTask(id: string) {
    const prev = tasks;
    setTasks((ts) => ts.filter((t) => t.id !== id));
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    if (!res.ok) {
      setTasks(prev);
      toast.error("Failed to complete task");
    }
  }

  async function deleteTask(id: string) {
    const prev = tasks;
    setTasks((ts) => ts.filter((t) => t.id !== id));
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setTasks(prev);
      toast.error("Failed to delete");
    }
  }

  async function addTask(boardId: string | null, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: trimmed, board_id: boardId }),
    });
    if (!res.ok) {
      toast.error("Failed to add task");
      return;
    }
    const data = await res.json();
    setTasks((ts) => [...ts, data.task]);
  }

  async function createBoard(name: string) {
    const res = await fetch("/api/boards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, emoji: "📋", color: "#6366F1" }),
    });
    if (!res.ok) {
      toast.error("Failed to create board");
      return;
    }
    const data = await res.json();
    setBoards((bs) => [...bs, data.board]);
  }

  return (
    <div>
      <div className="mb-2">
        <h1 className="text-3xl font-bold">Your Boards</h1>
        <p className="text-zinc-400">Boards with your upcoming tasks</p>
      </div>

      {/* Today progress bar */}
      <div className="mt-6 mb-6">
        <div className="flex justify-between text-sm mb-2">
          <span className="font-semibold">Today</span>
          <span className="text-zinc-400">📋 {doneToday} / {totalToday}</span>
        </div>
        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full brand-gradient rounded-full"
            style={{
              width: totalToday > 0 ? `${(doneToday / totalToday) * 100}%` : "0%",
            }}
          />
        </div>
      </div>

      {/* Boards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {boards.length === 0 && (
          <div className="col-span-full glass-strong rounded-2xl p-8 text-center">
            <CheckCheck className="size-12 mx-auto text-zinc-600 mb-3" />
            <h3 className="font-bold mb-1">No boards yet</h3>
            <p className="text-xs text-zinc-500 mb-4">
              Run the seed function in Supabase or create your first board.
            </p>
            <CreateBoardInline onCreate={createBoard} />
          </div>
        )}

        {boards.map((board) => {
          const boardTasks = tasksByBoard.get(board.id) ?? [];
          return (
            <BoardCard
              key={board.id}
              board={board}
              tasks={boardTasks}
              onComplete={completeTask}
              onDelete={deleteTask}
              onAdd={(title) => addTask(board.id, title)}
            />
          );
        })}

        {boards.length > 0 && <CreateBoardCard onCreate={createBoard} />}
      </div>
    </div>
  );
}

function BoardCard({
  board,
  tasks,
  onComplete,
  onDelete,
  onAdd,
}: {
  board: Board;
  tasks: Task[];
  onComplete: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: (title: string) => void;
}) {
  const [adding, setAdding] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!adding.trim()) return;
    onAdd(adding);
    setAdding("");
  }

  const empty = tasks.length === 0;

  return (
    <div className="glass-strong rounded-2xl p-5">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <div
            className="size-8 rounded-lg flex items-center justify-center font-bold text-white"
            style={{ background: board.color ?? "#6366F1" }}
          >
            {board.emoji ?? "📋"}
          </div>
          <h3 className="font-bold">{board.name}</h3>
        </div>
        <button className="text-zinc-400 hover:text-white">
          <MoreVertical className="size-4" />
        </button>
      </div>

      {empty ? (
        <div className="text-center py-8">
          <div className="size-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-2">
            <Check className="size-5 text-green-400" />
          </div>
          <div className="font-semibold uppercase text-xs tracking-wider text-amber-400">
            All clear
          </div>
          <div className="text-xs text-zinc-400 mt-1">0 pending tasks</div>
        </div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {tasks.slice(0, 8).map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              onComplete={() => onComplete(t.id)}
              onDelete={() => onDelete(t.id)}
            />
          ))}
        </div>
      )}

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          type="text"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="+ Add task"
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

function TaskCard({
  task,
  onComplete,
  onDelete,
}: {
  task: Task;
  onComplete: () => void;
  onDelete: () => void;
}) {
  const priorityClass =
    task.priority === "high"
      ? "bg-red-500/20 text-red-300"
      : task.priority === "medium"
      ? "bg-amber-500/20 text-amber-300"
      : "bg-blue-500/20 text-blue-300";

  return (
    <div className="bg-white/5 rounded-lg p-3 hover:bg-white/8 group">
      <div className="flex justify-between items-start gap-2 mb-2">
        <span className="font-semibold text-sm flex-1">{task.title}</span>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onComplete}
            className="size-6 hover:bg-green-500/20 rounded flex items-center justify-center text-green-400"
            title="Mark done"
          >
            <Check className="size-3" />
          </button>
          <button
            onClick={onDelete}
            className="size-6 hover:bg-red-500/20 rounded flex items-center justify-center text-red-400"
            title="Delete"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>
      <div className="flex gap-1 flex-wrap">
        <span className={`text-xs px-2 py-0.5 rounded-full ${priorityClass}`}>
          {task.priority}
        </span>
        {task.time_estimate && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-zinc-300">
            {task.time_estimate}
          </span>
        )}
        {task.flagged && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
            ⚠ flagged
          </span>
        )}
      </div>
    </div>
  );
}

function CreateBoardCard({ onCreate }: { onCreate: (name: string) => void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  if (!creating) {
    return (
      <button
        onClick={() => setCreating(true)}
        className="glass rounded-2xl p-5 border-2 border-dashed border-white/15 flex items-center justify-center cursor-pointer hover:bg-white/5 min-h-[280px] text-center"
      >
        <div>
          <div className="size-14 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3 border border-white/10">
            <Plus className="size-6" />
          </div>
          <div className="font-semibold">Create new board</div>
        </div>
      </button>
    );
  }

  return (
    <div className="glass rounded-2xl p-5 min-h-[280px] flex flex-col justify-center">
      <input
        autoFocus
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Board name"
        className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 mb-3"
      />
      <div className="flex gap-2">
        <button
          onClick={() => {
            setCreating(false);
            setName("");
          }}
          className="flex-1 px-3 py-2 hover:bg-white/5 rounded-lg text-sm"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            if (name.trim()) {
              onCreate(name.trim());
              setName("");
              setCreating(false);
            }
          }}
          disabled={!name.trim()}
          className="flex-1 brand-gradient rounded-lg px-3 py-2 text-white text-sm font-semibold disabled:opacity-50"
        >
          Create
        </button>
      </div>
    </div>
  );
}

function CreateBoardInline({ onCreate }: { onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || submitting) return;
        setSubmitting(true);
        await onCreate(name.trim());
        setName("");
        setSubmitting(false);
      }}
      className="flex gap-2 max-w-sm mx-auto"
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="My first board"
        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
      />
      <button
        type="submit"
        disabled={!name.trim() || submitting}
        className="brand-gradient rounded-lg px-4 py-2 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
      >
        {submitting && <Loader2 className="size-3.5 animate-spin" />}
        Create
      </button>
    </form>
  );
}
