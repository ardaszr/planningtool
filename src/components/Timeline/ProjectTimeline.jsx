import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
  useLayoutEffect,
} from "react";
import dayjs from "dayjs";
import weekOfYear from "dayjs/plugin/weekOfYear";
import utc from "dayjs/plugin/utc";

import groupsData from "../../data/groups";
import itemsByDate, { defaultCompletedIds, seedMilestones, seedInstantEvents } from "../../data/items";

import "./timeline.css";

import img1 from "../../assets/UZAY-Yatay.png";
import img2 from "../../assets/AYAP-1.png";

dayjs.extend(weekOfYear);
dayjs.extend(utc);

// --- SETTINGS ---
const SIDEBAR_WIDTH = 240;
const SNAP_MINUTES = 5;
const STORAGE_KEY_ITEMS = "TIMELINE_ITEMS_DB";
const STORAGE_KEY_LANE_COUNTS = "TIMELINE_LANE_COUNTS";
const STORAGE_KEY_LANE_HEIGHT = "TIMELINE_LANE_HEIGHT";
const STORAGE_KEY_PROJECTS = "TIMELINE_PROJECT_TREE";
const STORAGE_KEY_COLLAPSED = "TIMELINE_COLLAPSED_PROJECTS";
const STORAGE_KEY_GROUPS = "TIMELINE_DYNAMIC_GROUPS";
const STORAGE_KEY_MILESTONES = "TIMELINE_MILESTONES";
const STORAGE_KEY_INSTANTS = "TIMELINE_INSTANT_EVENTS";
const STORAGE_KEY_LAUNCH_TIME = "TIMELINE_LAUNCH_TIME";

const DEFAULT_LANE_COUNT = 3;
const DEFAULT_LANE_HEIGHT = 32;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

// --- LEGACY DATA CONVERTER ---
// items.js (date-keyed) → flat array with absStart/absEnd
function convertLegacyItems(itemsByDateObj) {
  const allItems = [];
  for (const [dateKey, dayItems] of Object.entries(itemsByDateObj)) {
    if (!Array.isArray(dayItems)) continue;
    const dayStart = dayjs.utc(dateKey).startOf("day");
    for (const it of dayItems) {
      allItems.push({
        ...it,
        kind: it.kind || "task",
        absStart: dayStart.add(it.startMin, "minute").toISOString(),
        absEnd: dayStart.add(it.endMin, "minute").toISOString(),
      });
    }
  }
  return allItems;
}

// --- LOAD MASTER ITEMS (localStorage first, then seed) ---
function loadMasterItems() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_ITEMS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.warn("localStorage read error:", e);
  }
  // Seed from items.js
  const seeded = convertLegacyItems(itemsByDate);
  try {
    localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(seeded));
  } catch (e) {
    console.warn("localStorage write error:", e);
  }
  return seeded;
}

function saveMasterItems(items) {
  try {
    localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(items));
  } catch (e) {
    console.warn("localStorage save error:", e);
  }
}

// --- PER-GROUP LANE COUNTS ---
function loadLaneCounts() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_LANE_COUNTS);
    if (saved) { const p = JSON.parse(saved); if (p && typeof p === "object") return p; }
  } catch (e) { /* fallback */ }
  return {};
}
function saveLaneCounts(obj) {
  try { localStorage.setItem(STORAGE_KEY_LANE_COUNTS, JSON.stringify(obj)); } catch (e) {}
}
function loadLaneHeight() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_LANE_HEIGHT);
    if (saved) { const v = Number(JSON.parse(saved)); if (v >= 20 && v <= 50) return v; }
  } catch (e) {}
  return DEFAULT_LANE_HEIGHT;
}
function saveLaneHeight(h) {
  try { localStorage.setItem(STORAGE_KEY_LANE_HEIGHT, JSON.stringify(h)); } catch (e) {}
}

// --- DYNAMIC GROUPS ---
function loadDynamicGroups(seedGroups) {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_GROUPS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return seedGroups.map((g) => ({ id: g.id, title: g.title }));
}
function saveDynamicGroups(groups) {
  try { localStorage.setItem(STORAGE_KEY_GROUPS, JSON.stringify(groups)); } catch (e) {}
}

// --- PROJECT TREE ---
function buildDefaultProjectTree(groups) {
  const tree = [];
  const chunkSize = Math.max(2, Math.ceil(groups.length / 3));
  for (let i = 0; i < groups.length; i += chunkSize) {
    const chunk = groups.slice(i, i + chunkSize);
    tree.push({
      id: `proj-${Math.floor(i / chunkSize) + 1}`,
      name: `Project ${Math.floor(i / chunkSize) + 1}`,
      groupIds: chunk.map((g) => g.id),
    });
  }
  return tree;
}

function loadProjectTree(groups) {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_PROJECTS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) { /* fallback */ }
  return buildDefaultProjectTree(groups);
}

function saveProjectTree(tree) {
  try { localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(tree)); }
  catch (e) { /* silent */ }
}

function loadCollapsedProjects() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_COLLAPSED);
    if (saved) return new Set(JSON.parse(saved));
  } catch (e) { /* fallback */ }
  return new Set();
}

function saveCollapsedProjects(set) {
  try { localStorage.setItem(STORAGE_KEY_COLLAPSED, JSON.stringify([...set])); }
  catch (e) { /* silent */ }
}

// --- MILESTONES ---
function loadMilestones() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_MILESTONES);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  // Seed from items.js
  const seed = seedMilestones || [];
  try { localStorage.setItem(STORAGE_KEY_MILESTONES, JSON.stringify(seed)); } catch (e) {}
  return seed;
}
function saveMilestones(arr) {
  try { localStorage.setItem(STORAGE_KEY_MILESTONES, JSON.stringify(arr)); } catch (e) {}
}

// --- INSTANT EVENTS ---
function loadInstantEvents() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_INSTANTS);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  const seed = seedInstantEvents || [];
  try { localStorage.setItem(STORAGE_KEY_INSTANTS, JSON.stringify(seed)); } catch (e) {}
  return seed;
}
function saveInstantEvents(arr) {
  try { localStorage.setItem(STORAGE_KEY_INSTANTS, JSON.stringify(arr)); } catch (e) {}
}

// --- EVENT TYPE RENK HARİTASI ---
const EVENT_TYPE_COLORS = {
  meeting: "#3498db",
  milestone: "#f39c12",
  deadline: "#e67e22",
  maintenance: "#95a5a6",
  other: "#1abc9c",
};

const EVENT_TYPE_LABELS = {
  meeting: "Meeting",
  milestone: "Milestone",
  deadline: "Deadline",
  maintenance: "Maintenance",
  other: "Other",
};

// --- YARDIMCI FONKSİYONLAR ---
function moveDependentItems(items, parentId, shiftAmount, totalMinutes, pushShifts) {
  if (shiftAmount === 0) return items;
  const dependents = items.filter(
    (it) => it.dependencies && it.dependencies.includes(parentId)
  );
  if (dependents.length === 0) return items;

  let nextItems = [...items];
  dependents.forEach((dep) => {
    const idx = nextItems.findIndex((x) => x.id === dep.id);
    if (idx !== -1) {
      const currentItem = nextItems[idx];

      // Subtract shift already applied by pushWithinSameLane
      const alreadyMoved = pushShifts ? (pushShifts.get(dep.id) || 0) : 0;
      const effectiveShift = shiftAmount - alreadyMoved;

      if (effectiveShift !== 0) {
        let newStart = currentItem.startMin + effectiveShift;
        let newEnd = currentItem.endMin + effectiveShift;

        if (newStart < 0) {
          const diff = 0 - newStart;
          newStart += diff;
          newEnd += diff;
        }
        if (newEnd > totalMinutes) {
          const diff = newEnd - totalMinutes;
          newStart -= diff;
          newEnd -= diff;
        }

        nextItems[idx] = { ...currentItem, startMin: newStart, endMin: newEnd };
      }

      // Recurse with the full shiftAmount — children judge their own pushShift
      nextItems = moveDependentItems(nextItems, dep.id, shiftAmount, totalMinutes, pushShifts);
    }
  });
  return nextItems;
}

function computeConflicts(items) {
  const conflicted = new Set();
  const buckets = new Map();
  for (const it of items) {
    const lane = it.lane ?? 0;
    const key = `${it.groupId}|${lane}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(it);
  }
  for (const list of buckets.values()) {
    const sorted = [...list].sort((a, b) => a.startMin - b.startMin);
    for (let i = 0; i < sorted.length; i++) {
      const A = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const B = sorted[j];
        if (B.startMin >= A.endMin) break;
        if (overlaps(A.startMin, A.endMin, B.startMin, B.endMin)) {
          conflicted.add(A.id);
          conflicted.add(B.id);
        }
      }
    }
  }
  return conflicted;
}

function pushWithinSameLane({
  items,
  draggedId,
  newStartMin,
  snap = SNAP_MINUTES,
  totalMinutes,
}) {
  const dragged = items.find((x) => x.id === draggedId);
  if (!dragged) return { ok: false, blocked: true, nextItems: items };

  const groupId = dragged.groupId;
  const lane = dragged.lane ?? 0;
  const duration = dragged.endMin - dragged.startMin;

  let startMin = newStartMin;
  startMin = Math.round(startMin / snap) * snap;
  let endMin = startMin + duration;

  if (startMin < 0) {
    startMin = 0;
    endMin = duration;
  }
  if (endMin > totalMinutes) {
    endMin = totalMinutes;
    startMin = totalMinutes - duration;
  }

  const bucket = items
    .filter((x) => x.groupId === groupId && (x.lane ?? 0) === lane)
    .sort((a, b) => a.startMin - b.startMin);

  const others = bucket.filter((x) => x.id !== draggedId);
  const updated = new Map(items.map((x) => [x.id, { ...x }]));
  updated.set(draggedId, { ...dragged, startMin, endMin });

  let cursorEnd = endMin;
  const after = others
    .filter((x) => x.startMin >= startMin)
    .sort((a, b) => a.startMin - b.startMin);

  for (const it of after) {
    const current = updated.get(it.id);
    if (current.startMin < cursorEnd) {
      if (!current.movable) return { ok: false, blocked: true, nextItems: items };
      const dur = current.endMin - current.startMin;
      let ns = cursorEnd;
      ns = Math.round(ns / snap) * snap;
      let ne = ns + dur;
      if (ne > totalMinutes) return { ok: false, blocked: true, nextItems: items };
      updated.set(it.id, { ...current, startMin: ns, endMin: ne });
      cursorEnd = ne;
    } else {
      cursorEnd = Math.max(cursorEnd, current.endMin);
    }
  }
  const nextItems = items.map((x) => updated.get(x.id) || x);
  return { ok: true, blocked: false, nextItems };
}

// --- MODAL COMPONENT ---
const TaskInfoModal = ({
  task,
  onClose,
  onToggleComplete,
  onUpdateTask,
  onDeleteItem,
  isAdmin,
  groupsData,
  projectTree = [],
  laneCounts = {},
  timelineStart,
  totalMinutes,
  snapMinutes = SNAP_MINUTES,
  allTasks = [],
  closeOnApply = false,
}) => {
  const isEvent = task?.kind === "event";
  const getLC = (gId) => laneCounts[gId] ?? DEFAULT_LANE_COUNT;

  const [applyColorToLaneGroup, setApplyColorToLaneGroup] = useState(false);
  const [validationPopup, setValidationPopup] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false); // { type: 'error'|'warning', messages: [], onConfirm?: fn }

  // Admin edit state'leri
  const [editTitle, setEditTitle] = useState("");
  const [editId, setEditId] = useState("");
  const [editLane, setEditLane] = useState("0");
  const [editDesc, setEditDesc] = useState("");
  const [editGroupId, setEditGroupId] = useState("");
  const [editProjectId, setEditProjectId] = useState("");
  const [editStartDT, setEditStartDT] = useState(""); // "YYYY-MM-DDTHH:mm" (datetime-local)
  const [editEndDT, setEditEndDT] = useState("");     // "YYYY-MM-DDTHH:mm" (datetime-local)
  const [depToAdd, setDepToAdd] = useState("");
  const [editDepsIds, setEditDepsIds] = useState([]);

  // Event-specific state
  const [editEventType, setEditEventType] = useState("meeting");
  const [editParticipants, setEditParticipants] = useState("");

  const clampInt = (v, min, max, fallback) => {
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };

  const [editDurationMin, setEditDurationMin] = useState(0);

  // Datetime helpers
  const dtToDay = (dtStr) => dayjs.utc(dtStr || "2026-01-01T00:00");
  const dayToDTStr = (d) => d.format("YYYY-MM-DDTHH:mm");

  const handleStartDTChange = (val) => {
    setEditStartDT(val);
    const s = dtToDay(val);
    const e = dtToDay(editEndDT);
    if (s.isAfter(e) || s.isSame(e)) {
      const newEnd = s.add(Math.max(snapMinutes, editDurationMin), "minute");
      setEditEndDT(dayToDTStr(newEnd));
      setEditDurationMin(Math.max(snapMinutes, newEnd.diff(s, "minute")));
    } else {
      setEditDurationMin(Math.max(snapMinutes, e.diff(s, "minute")));
    }
  };

  const handleEndDTChange = (val) => {
    setEditEndDT(val);
    const s = dtToDay(editStartDT);
    const e = dtToDay(val);
    if (e.isBefore(s) || e.isSame(s)) {
      const newEnd = s.add(snapMinutes, "minute");
      setEditEndDT(dayToDTStr(newEnd));
      setEditDurationMin(snapMinutes);
    } else {
      setEditDurationMin(Math.max(snapMinutes, e.diff(s, "minute")));
    }
  };

  useEffect(() => {
    setApplyColorToLaneGroup(false);

    if (!task) return;

    setEditTitle(String(task.title ?? ""));
    setEditId(String(task.id ?? ""));
    setEditLane(String(task.lane ?? 0));
    setEditGroupId(String(task.groupId ?? ""));
    const ownerProj = projectTree.find((p) => p.groupIds.includes(task.groupId));
    setEditProjectId(ownerProj ? ownerProj.id : (projectTree[0]?.id ?? ""));
    setEditDepsIds(Array.isArray(task.dependencies) ? task.dependencies.map(Number) : []);
    setDepToAdd("");
    setEditDesc(String(task.description ?? "").slice(0, 500));

    // Event fields
    setEditEventType(task.eventType || "meeting");
    setEditParticipants(task.participants || "");

    // Compute absolute start/end for datetime-local inputs
    let stAbs, enAbs;
    if (task.absStart) {
      stAbs = dayjs.utc(task.absStart);
    } else {
      const safeStartRel = Number.isFinite(Number(task.startMin)) ? Number(task.startMin) : 0;
      stAbs = timelineStart.add(safeStartRel, "minute");
    }
    if (task.absEnd) {
      enAbs = dayjs.utc(task.absEnd);
    } else {
      const safeStartRel = Number.isFinite(Number(task.startMin)) ? Number(task.startMin) : 0;
      const safeEndRel = Number.isFinite(Number(task.endMin)) ? Number(task.endMin) : safeStartRel + snapMinutes;
      enAbs = timelineStart.add(safeEndRel, "minute");
    }
    if (enAbs.isBefore(stAbs) || enAbs.isSame(stAbs)) {
      enAbs = stAbs.add(snapMinutes, "minute");
    }

    setEditStartDT(stAbs.format("YYYY-MM-DDTHH:mm"));
    setEditEndDT(enAbs.format("YYYY-MM-DDTHH:mm"));
    setEditDurationMin(Math.max(snapMinutes, enAbs.diff(stAbs, "minute")));
  }, [task, groupsData, projectTree, snapMinutes, timelineStart]);

  if (!task) return null;

  // Status
  const getStatusLabel = () => {
    if (isEvent) {
      if (!task.movable) return "Locked";
      return EVENT_TYPE_LABELS[task.eventType] || "Event";
    }
    if (task.completed) return "Completed";
    if (!task.movable) return "Locked";
    return "Planned";
  };

  const getStatusColor = () => {
    if (isEvent) {
      if (task.urgent) return "#c0392b";
      return EVENT_TYPE_COLORS[task.eventType] || "#1abc9c";
    }
    if (task.completed) return "#bdc3c7";
    if (task.urgent) return "#c0392b";
    if (task.invisible) return "#95a5a6";
    return task.color || "#4f8df5";
  };

  // Handler for Admin Property Changes
  const handlePropChange = (field, value) => {
    if (!onUpdateTask) return;
    let updates = { [field]: value };

    if (field === "urgent") {
      if (value === true) {
        const prev = task.urgent
          ? task._prevColorBeforeUrgent
          : task.color || "#4f8df5";
        updates._prevColorBeforeUrgent = prev;
        updates.color = "#e74c3c";
      } else {
        const restore = task._prevColorBeforeUrgent;
        if (restore) updates.color = restore;
        updates._prevColorBeforeUrgent = null;
      }
    }

    if (field === "statusSelect") {
      if (value === "locked") {
        updates.movable = false;
        updates.invisible = false;
      }
      if (value === "planned") {
        updates.movable = true;
        updates.invisible = false;
      }
      if (value === "invisible") {
        updates.invisible = true;
      }
    }

    if (field === "color") {
      if (task.urgent) {
        updates._prevColorBeforeUrgent = value;
        updates.color = "#e74c3c";
      } else {
        updates.color = value;
      }
      updates._applyToSameGroupLane = applyColorToLaneGroup;
    }

    onUpdateTask(task.id, updates);
  };

  // Admin: formdaki editleri uygula
  // --- VALIDATION HELPER ---
  const validateAndApply = (forceApply = false) => {
    if (!onUpdateTask) return;

    const nextTitle = String(editTitle || "").trim();
    const nextId = clampInt(editId, 1, 100, task.id);
    const nextGroupId = clampInt(editGroupId, 1, 9999, task.groupId);
    const nextLane = clampInt(editLane, 0, getLC(nextGroupId) - 1, task.lane ?? 0);
    const desc = String(editDesc || "").slice(0, 500);

    // Parse datetime-local inputs → absolute dayjs objects
    const absStartNew = dayjs.utc(editStartDT);
    let absEndNew = dayjs.utc(editEndDT);
    if (!absStartNew.isValid() || !absEndNew.isValid()) return;
    if (absEndNew.isBefore(absStartNew) || absEndNew.isSame(absStartNew)) {
      absEndNew = absStartNew.add(snapMinutes, "minute");
    }

    // Relative to timeline viewport
    const relStartMin = absStartNew.diff(timelineStart, "minute");
    const relEndMin = absEndNew.diff(timelineStart, "minute");

    // --- UNIQUENESS CHECKS ---
    const others = allTasks.filter((t) => t.id !== task.id);
    const sameKindOthers = others.filter((t) => (t.kind || "task") === (isEvent ? "event" : "task"));
    const errors = [];
    const warnings = [];

    // 1) Title uniqueness (same kind)
    const titleConflict = sameKindOthers.find(
      (t) => t.title.trim().toLowerCase() === nextTitle.toLowerCase()
    );
    if (titleConflict) {
      errors.push(`"${nextTitle}" adında başka bir ${isEvent ? "event" : "task"} zaten mevcut (#${titleConflict.id}).`);
    }

    // 2) ID uniqueness (across all)
    if (nextId !== task.id) {
      const idConflict = others.find((t) => t.id === nextId);
      if (idConflict) {
        errors.push(`ID ${nextId} zaten "${idConflict.title}" tarafından kullanılıyor.`);
      }
    }

    // 3) Time range conflict (compare absolute timestamps)
    const newAbsStartISO = absStartNew.toISOString();
    const newAbsEndISO = absEndNew.toISOString();
    const timeConflict = sameKindOthers.find(
      (t) => t.absStart === newAbsStartISO && t.absEnd === newAbsEndISO && t.groupId === nextGroupId && (t.lane ?? 0) === nextLane
    );
    if (timeConflict) {
      if (!isEvent) {
        errors.push(`"${timeConflict.title}" (#${timeConflict.id}) ile birebir aynı zaman aralığında çakışma var. Lütfen zamanı kaydırın.`);
      } else {
        if (!forceApply) {
          warnings.push(`"${timeConflict.title}" (#${timeConflict.id}) ile aynı zaman aralığını paylaşıyor. Yine de kaydetmek istiyor musunuz?`);
        }
      }
    }

    if (errors.length > 0) {
      setValidationPopup({ type: "error", messages: errors, onConfirm: null });
      return;
    }

    if (warnings.length > 0 && !forceApply) {
      setValidationPopup({
        type: "warning",
        messages: warnings,
        onConfirm: () => {
          setValidationPopup(null);
          validateAndApply(true);
        },
      });
      return;
    }

    // --- APPLY ---
    const updates = {
      title: nextTitle || task.title,
      id: nextId,
      groupId: nextGroupId,
      lane: nextLane,
      description: desc,
      startMin: relStartMin,
      endMin: relEndMin,
      absStart: absStartNew.toISOString(),
      absEnd: absEndNew.toISOString(),
    };

    if (!isEvent) {
      updates.dependencies = (editDepsIds || []).map(Number);
      updates.depLags = task.depLags || {};
    }

    if (isEvent) {
      updates.eventType = editEventType;
      updates.participants = editParticipants;
    }

    onUpdateTask(task.id, updates);
    setEditDurationMin(Math.max(snapMinutes, absEndNew.diff(absStartNew, "minute")));
    setValidationPopup(null);
    if (closeOnApply) onClose();
  };

  const applyAdminEdits = () => validateAndApply(false);

  const modalHeaderIcon = isEvent ? "📅" : "";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={isEvent ? { background: "#eaf6ff" } : {}}>
          <h3>
            {modalHeaderIcon} {task.title}
            <span style={{ marginLeft: 8, fontSize: "0.8em" }}>
              {task.urgent && <span title="Urgent">⚠️</span>}
              {!task.movable && (
                <span title="Locked" style={{ marginLeft: 4 }}>🔒</span>
              )}
              {!isEvent && task.completed && (
                <span style={{ color: "green", marginLeft: 4 }}>✅</span>
              )}
              {isEvent && (
                <span
                  className="event-type-badge"
                  style={{ background: EVENT_TYPE_COLORS[task.eventType] || "#1abc9c" }}
                >
                  {EVENT_TYPE_LABELS[task.eventType] || "Event"}
                </span>
              )}
            </span>
          </h3>
          <button className="modal-close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {/* Kind Badge */}
          <div className="modal-row">
            <strong>Type:</strong>
            <span
              className="status-badge"
              style={{ background: isEvent ? "#2980b9" : "#8e44ad" }}
            >
              {isEvent ? "Event" : "Mission"}
            </span>
          </div>

          {/* Title */}
          <div className="modal-row">
            <strong>{isEvent ? "Event Name:" : "Task Name:"}</strong>
            {isAdmin ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                style={{ width: 220, padding: 4, borderRadius: 4 }}
              />
            ) : (
              <span>{task.title}</span>
            )}
          </div>

          {/* ID */}
          <div className="modal-row">
            <strong>ID:</strong>
            {isAdmin ? (
              <input
                type="number"
                min={1}
                max={100}
                value={editId}
                onChange={(e) => setEditId(e.target.value)}
                style={{ width: 120, padding: 4, borderRadius: 4 }}
              />
            ) : (
              <span>{task.id}</span>
            )}
          </div>

          {/* Project */}
          <div className="modal-row">
            <strong>Project:</strong>
            {isAdmin ? (
              <select
                value={editProjectId}
                onChange={(e) => {
                  const pid = e.target.value;
                  setEditProjectId(pid);
                  const proj = projectTree.find((p) => p.id === pid);
                  if (proj && proj.groupIds.length > 0) {
                    setEditGroupId(String(proj.groupIds[0]));
                    setEditLane("0");
                  }
                }}
                style={{ padding: 4, borderRadius: 4, minWidth: 160 }}
              >
                {projectTree.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            ) : (
              <span>{(() => { const p = projectTree.find((pp) => pp.groupIds.includes(task.groupId)); return p ? p.name : "—"; })()}</span>
            )}
          </div>

          {/* Sub-project */}
          <div className="modal-row">
            <strong>Sub-project:</strong>
            {isAdmin ? (() => {
              const selProj = projectTree.find((p) => p.id === editProjectId);
              const subGroups = selProj
                ? selProj.groupIds.map((gId) => groupsData.find((g) => g.id === gId)).filter(Boolean)
                : [];
              return (
                <select
                  value={String(editGroupId)}
                  onChange={(e) => { setEditGroupId(e.target.value); setEditLane("0"); }}
                  style={{ padding: 4, borderRadius: 4, minWidth: 160 }}
                >
                  {subGroups.map((g) => (
                    <option key={g.id} value={String(g.id)}>{g.title}</option>
                  ))}
                  {subGroups.length === 0 && <option value="">— no sub-projects —</option>}
                </select>
              );
            })() : (
              <span>{task.groupName || task.groupId}</span>
            )}
          </div>

          {/* Layer */}
          <div className="modal-row">
            <strong>Layer:</strong>
            {isAdmin ? (() => {
              const currentLC = getLC(Number(editGroupId) || 0);
              return (
                <select
                  value={String(editLane)}
                  onChange={(e) => setEditLane(e.target.value)}
                  style={{ padding: 4, borderRadius: 4, minWidth: 120 }}
                >
                  {Array.from({ length: currentLC }, (_, i) => (
                    <option key={i} value={String(i)}>Lane {i}</option>
                  ))}
                </select>
              );
            })() : (
              <span>{task.lane !== undefined ? task.lane : "None"}</span>
            )}
          </div>

          {/* ====== EVENT-SPECIFIC: Event Type ====== */}
          {isEvent && (
            <div className="modal-row">
              <strong>Event Type:</strong>
              {isAdmin ? (
                <select
                  value={editEventType}
                  onChange={(e) => setEditEventType(e.target.value)}
                  style={{ padding: 4, borderRadius: 4, minWidth: 160 }}
                >
                  {Object.entries(EVENT_TYPE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              ) : (
                <span
                  className="status-badge"
                  style={{ background: EVENT_TYPE_COLORS[task.eventType] || "#1abc9c" }}
                >
                  {EVENT_TYPE_LABELS[task.eventType] || "Other"}
                </span>
              )}
            </div>
          )}

          {/* ====== EVENT-SPECIFIC: Participants ====== */}
          {isEvent && (
            <div className="modal-row">
              <strong>Participants:</strong>
              {isAdmin ? (
                <input
                  type="text"
                  value={editParticipants}
                  onChange={(e) => setEditParticipants(e.target.value)}
                  placeholder="e.g. Ali, Veli, Ayşe"
                  style={{ width: 220, padding: 4, borderRadius: 4 }}
                />
              ) : (
                <span>{task.participants || "—"}</span>
              )}
            </div>
          )}

          {/* ====== TASK-SPECIFIC: Dependency ====== */}
          {!isEvent && (
            <div className="modal-row">
              <strong>Dependency:</strong>
              {!isAdmin ? (
                <span>
                  {task.dependencies && task.dependencies.length > 0
                    ? task.dependencies.join(", ")
                    : "None"}
                </span>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <select
                      value={editDepsIds[0] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) setEditDepsIds([]);
                        else setEditDepsIds([Number(v)]);
                      }}
                    >
                      <option value="">Select a task...</option>
                      {allTasks
                        .filter((t) => t.id !== task.id && t.kind !== "event")
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                          </option>
                        ))}
                    </select>
                    <button
                      className="btn-secondary"
                      type="button"
                      disabled={!depToAdd}
                      onClick={() => {
                        const idNum = Number(depToAdd);
                        if (!Number.isFinite(idNum)) return;
                        const next = Array.from(new Set([...(editDepsIds || []), idNum]));
                        setEditDepsIds(next);
                        setDepToAdd("");

                        const depTask = allTasks.find((t) => Number(t.id) === Number(idNum));
                        const baseStart = Number.isFinite(task.startMin) ? task.startMin : 0;
                        const baseEnd = Number.isFinite(task.endMin) ? task.endMin : baseStart + snapMinutes;
                        const dur = Math.max(snapMinutes, baseEnd - baseStart);
                        const parentEnd = depTask && Number.isFinite(depTask.endMin) ? depTask.endMin : 0;
                        const lag = Math.max(0, baseStart - parentEnd);
                        const nextDepLags = { ...(task.depLags || {}), [Number(idNum)]: lag };

                        let newStartMin = Math.max(baseStart, parentEnd + lag);
                        newStartMin = Math.round(newStartMin / snapMinutes) * snapMinutes;
                        let newEndMin = newStartMin + dur;
                        if (newEndMin > 1440) {
                          newEndMin = 1440;
                          newStartMin = Math.max(0, 1440 - dur);
                        }

                        onUpdateTask?.(task.id, {
                          dependencies: next.map((d) => Number(d)),
                          depLags: nextDepLags,
                          startMin: newStartMin,
                          endMin: newEndMin,
                        });
                      }}
                    >
                      Add
                    </button>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(editDepsIds || []).length === 0 ? (
                      <span style={{ opacity: 0.7 }}>None</span>
                    ) : (
                      editDepsIds.map((id) => {
                        const t = allTasks.find((x) => x.id === id);
                        const label = t ? `#${id} — ${t.title}` : `#${id}`;
                        return (
                          <span
                            key={id}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "4px 8px",
                              borderRadius: 999,
                              background: "#f1f3f5",
                              border: "1px solid #e5e7eb",
                              fontSize: 12,
                            }}
                            title={label}
                          >
                            {label}
                            <button
                              type="button"
                              style={{
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                fontWeight: 700,
                                lineHeight: 1,
                              }}
                              onClick={() => {
                                const next = (editDepsIds || []).filter((x) => x !== id);
                                const nextDepLags = { ...(task.depLags || {}) };
                                delete nextDepLags[id];
                                setEditDepsIds(next);
                                onUpdateTask?.(task.id, { dependencies: next, depLags: nextDepLags });
                              }}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Time Range (Multi-Day Support) */}
          <div className="modal-row">
            <strong>Start (UTC):</strong>
            {isAdmin ? (
              <input
                type="datetime-local"
                value={editStartDT}
                onChange={(e) => handleStartDTChange(e.target.value)}
                step={300}
                style={{ padding: 4, borderRadius: 4, fontSize: "0.85em" }}
              />
            ) : (
              <span>
                {task.absStart
                  ? dayjs.utc(task.absStart).format("MMM DD, HH:mm")
                  : timelineStart.add(Number.isFinite(Number(task.startMin)) ? Number(task.startMin) : 0, "minute").format("MMM DD, HH:mm")}
              </span>
            )}
          </div>
          <div className="modal-row">
            <strong>End (UTC):</strong>
            {isAdmin ? (
              <input
                type="datetime-local"
                value={editEndDT}
                onChange={(e) => handleEndDTChange(e.target.value)}
                step={300}
                style={{ padding: 4, borderRadius: 4, fontSize: "0.85em" }}
              />
            ) : (
              <span>
                {task.absEnd
                  ? dayjs.utc(task.absEnd).format("MMM DD, HH:mm")
                  : timelineStart.add(Number.isFinite(Number(task.endMin)) ? Number(task.endMin) : 0, "minute").format("MMM DD, HH:mm")}
              </span>
            )}
          </div>

          <div className="modal-row">
            <strong>Duration:</strong>
            <span>{(() => {
              const dur = isAdmin ? editDurationMin : (task.endMin - task.startMin);
              if (dur >= 1440) {
                const days = Math.floor(dur / 1440);
                const hours = Math.floor((dur % 1440) / 60);
                const mins = dur % 60;
                return `📅 ${days}d ${hours}h ${mins}m (Multi-Day)`;
              }
              if (dur >= 60) {
                return `${Math.floor(dur / 60)}h ${dur % 60}m`;
              }
              return `${dur} mins`;
            })()}</span>
          </div>

          <div className="modal-row">
            <strong>Status:</strong>
            <span className="status-badge" style={{ background: getStatusColor() }}>
              {getStatusLabel()}
            </span>
          </div>

          <div
            className="modal-row"
            style={{
              fontSize: "0.85em",
              color: task.urgent ? "#c0392b" : "#7f8c8d",
            }}
          >
            <strong>Priority:</strong> {task.urgent ? "CRITICAL / URGENT" : "Normal"}
          </div>

          {/* Description */}
          <div className="modal-desc">
            {isAdmin ? (
              <>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value.slice(0, 500))}
                  maxLength={500}
                  rows={4}
                  placeholder="Description (max 500 chars)"
                  style={{
                    width: "100%",
                    padding: 8,
                    borderRadius: 6,
                    border: "1px solid #ddd",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
                <div
                  style={{
                    textAlign: "right",
                    fontSize: 11,
                    opacity: 0.7,
                    marginTop: 4,
                  }}
                >
                  {String(editDesc || "").length}/500
                </div>
              </>
            ) : (
              task.description || "No description provided."
            )}
          </div>

          {/* --- ADMIN PANELİ --- */}
          {isAdmin && (
            <div
              style={{
                marginTop: 20,
                padding: 10,
                background: "#f8f9fa",
                borderRadius: 6,
                border: "1px solid #ddd",
              }}
            >
              <h4 style={{ marginTop: 0, marginBottom: 10, color: "#2c3e50" }}>
                Admin Controls
              </h4>

              {/* Status Dropdown */}
              <div className="modal-row">
                <strong>Set Status:</strong>
                <select
                  value={task.invisible ? "invisible" : !task.movable ? "locked" : "planned"}
                  onChange={(e) => handlePropChange("statusSelect", e.target.value)}
                  style={{ padding: 4, borderRadius: 4 }}
                >
                  <option value="planned">{isEvent ? "Active" : "Planned"} (Movable)</option>
                  <option value="locked">Locked (Fixed)</option>
                </select>
              </div>

              {/* Urgency Toggle */}
              <div className="modal-row">
                <strong>Urgency:</strong>
                <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={!!task.urgent}
                    onChange={(e) => handlePropChange("urgent", e.target.checked)}
                    style={{ marginRight: 6 }}
                  />
                  Mark as Urgent
                </label>
              </div>

              {/* Color Picker */}
              <div className="modal-row">
                <strong>{isEvent ? "Event" : "Task"} Color:</strong>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <input
                    type="color"
                    value={
                      task.urgent
                        ? task._prevColorBeforeUrgent || "#4f8df5"
                        : task.color || "#4f8df5"
                    }
                    onChange={(e) => handlePropChange("color", e.target.value)}
                    style={{
                      width: 40,
                      height: 25,
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                    }}
                  />
                  <span style={{ marginLeft: 8, fontSize: "0.8em", color: "#666" }}>
                    {task.urgent
                      ? task._prevColorBeforeUrgent || "#4f8df5"
                      : task.color || "#4f8df5"}
                  </span>
                </div>
              </div>

              {/* Apply to same group & layer */}
              <div className="modal-row" style={{ marginTop: 2 }}>
                <strong />
                <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={applyColorToLaneGroup}
                    onChange={(e) => setApplyColorToLaneGroup(e.target.checked)}
                    style={{ marginRight: 6 }}
                  />
                  Apply to all {isEvent ? "events" : "tasks"} in same group &amp; layer
                </label>
              </div>

              {/* Complete Button - ONLY FOR TASKS */}
              {!isEvent && (
                <div className="modal-row" style={{ marginTop: 10 }}>
                  <strong />
                  <button
                    className="btn-primary"
                    style={{ backgroundColor: task.completed ? "#f39c12" : "#27ae60" }}
                    onClick={() => onToggleComplete(task.id)}
                  >
                    {task.completed ? "Mark Incomplete" : "Mark Complete"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* --- VALIDATION POPUP --- */}
        {validationPopup && (
          <div className="validation-popup-overlay">
            <div className={`validation-popup ${validationPopup.type === "error" ? "validation-error" : "validation-warning"}`}>
              <div className="validation-popup-icon">
                {validationPopup.type === "error" ? "🚫" : "⚠️"}
              </div>
              <div className="validation-popup-title">
                {validationPopup.type === "error" ? "Çakışma Tespit Edildi" : "Uyarı"}
              </div>
              <div className="validation-popup-messages">
                {validationPopup.messages.map((msg, i) => (
                  <p key={i}>{msg}</p>
                ))}
              </div>
              <div className="validation-popup-actions">
                {validationPopup.type === "warning" && validationPopup.onConfirm && (
                  <button
                    className="btn-primary"
                    style={{ background: "#f39c12" }}
                    onClick={validationPopup.onConfirm}
                  >
                    Yine de Kaydet
                  </button>
                )}
                <button
                  className="btn-secondary"
                  onClick={() => setValidationPopup(null)}
                >
                  {validationPopup.type === "error" ? "Tamam, Düzenleyeceğim" : "İptal"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="modal-footer" style={{ justifyContent: "space-between" }}>
          {isAdmin ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-primary" onClick={applyAdminEdits}>
                Apply Changes
              </button>
              {onDeleteItem && !closeOnApply && (
                confirmDelete ? (
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <span style={{ fontSize: "0.8em", color: "#e74c3c", fontWeight: 700 }}>Emin misiniz?</span>
                    <button
                      className="btn-secondary"
                      style={{ background: "#e74c3c", color: "#fff", fontSize: "0.8em", padding: "4px 10px" }}
                      onClick={() => { onDeleteItem(task.id); onClose(); }}
                    >
                      Evet, Sil
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ fontSize: "0.8em", padding: "4px 10px" }}
                      onClick={() => setConfirmDelete(false)}
                    >
                      İptal
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn-secondary"
                    style={{ background: "#e74c3c22", color: "#e74c3c", border: "1px solid #e74c3c55" }}
                    onClick={() => setConfirmDelete(true)}
                    title="Bu öğeyi kalıcı olarak sil"
                  >
                    🗑 Sil
                  </button>
                )
              )}
            </div>
          ) : <div />}
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

const ProjectTimeline = () => {
  // --- ADMIN & SERVER STATE ---
  const [isAdmin, setIsAdmin] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginError, setLoginError] = useState("");

  // --- CUSTOM LOGO IMAGES ---
  const [customImg1, setCustomImg1] = useState(() => {
    try { return localStorage.getItem("TIMELINE_CUSTOM_IMG1") || null; } catch (e) { return null; }
  });
  const [customImg2, setCustomImg2] = useState(() => {
    try { return localStorage.getItem("TIMELINE_CUSTOM_IMG2") || null; } catch (e) { return null; }
  });

  const handleImageUpload = (imgIndex) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/svg+xml,image/webp";
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        if (imgIndex === 1) {
          setCustomImg1(dataUrl);
          try { localStorage.setItem("TIMELINE_CUSTOM_IMG1", dataUrl); } catch (err) {}
        } else {
          setCustomImg2(dataUrl);
          try { localStorage.setItem("TIMELINE_CUSTOM_IMG2", dataUrl); } catch (err) {}
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };
  const [completedIds, setCompletedIds] = useState(() => {
    try {
      const saved = localStorage.getItem("SERVER_COMPLETED_DB");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (error) {
      console.error("LocalStorage load error:", error);
    }
    // Seed from items.js
    const seed = defaultCompletedIds || [];
    try { localStorage.setItem("SERVER_COMPLETED_DB", JSON.stringify(seed)); } catch (e) {}
    return seed;
  });

  // --- ZAMAN AYARLARI ---
  const [selectedDate, setSelectedDate] = useState(dayjs.utc());
  const [clock, setClock] = useState(dayjs.utc().format("HH:mm:ss"));

  // --- DROPDOWN STATES ---
  const [activeDropdown, setActiveDropdown] = useState(null);

  const [selectedTask, setSelectedTask] = useState(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [dragState, setDragState] = useState(null);
  const suppressNextClickRef = useRef(false);
  const [isLocked, setIsLocked] = useState(true);
  const isAutoScrolling = useRef(false);

  // --- DYNAMIC GROUPS (editable copy of seed groups) ---
  const [dynamicGroups, setDynamicGroups] = useState(() => loadDynamicGroups(groupsData));

  // --- PER-GROUP LANE CONFIGURATION ---
  const [laneCounts, setLaneCounts] = useState(() => loadLaneCounts());
  const [laneHeight, setLaneHeight] = useState(() => loadLaneHeight());

  const getLaneCount = useCallback((groupId) => {
    return laneCounts[groupId] ?? DEFAULT_LANE_COUNT;
  }, [laneCounts]);

  const setGroupLaneCount = (groupId, count) => {
    const c = clamp(count, 1, 8);
    setLaneCounts((prev) => {
      const next = { ...prev, [groupId]: c };
      saveLaneCounts(next);
      return next;
    });
  };

  const updateLaneHeight = (h) => {
    const val = clamp(h, 20, 50);
    setLaneHeight(val);
    saveLaneHeight(val);
  };

  const getRowHeight = useCallback((groupId) => {
    return getLaneCount(groupId) * laneHeight;
  }, [getLaneCount, laneHeight]);

  // --- PROJECT TREE (sub-projects, collapse/expand) ---
  const [projectTree, setProjectTree] = useState(() => loadProjectTree(dynamicGroups));
  const [collapsedProjects, setCollapsedProjects] = useState(() => loadCollapsedProjects());
  const [showProjectEditor, setShowProjectEditor] = useState(false);

  const toggleProjectCollapse = (projId) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projId)) next.delete(projId);
      else next.add(projId);
      saveCollapsedProjects(next);
      return next;
    });
  };

  // --- PROJECT / SUBPROJECT CRUD ---
  const addProject = (name) => {
    const id = `proj-${Date.now()}`;
    setProjectTree((prev) => {
      const next = [...prev, { id, name, groupIds: [] }];
      saveProjectTree(next);
      return next;
    });
  };

  const removeProject = (projId) => {
    setProjectTree((prev) => {
      const next = prev.filter((p) => p.id !== projId);
      saveProjectTree(next);
      return next;
    });
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      next.delete(projId);
      saveCollapsedProjects(next);
      return next;
    });
  };

  const renameProject = (projId, newName) => {
    setProjectTree((prev) => {
      const next = prev.map((p) => p.id === projId ? { ...p, name: newName } : p);
      saveProjectTree(next);
      return next;
    });
  };

  const addSubproject = (projId, title) => {
    const newGid = Date.now();
    const newGroup = { id: newGid, title };
    setDynamicGroups((prev) => {
      const next = [...prev, newGroup];
      saveDynamicGroups(next);
      return next;
    });
    setProjectTree((prev) => {
      const next = prev.map((p) =>
        p.id === projId ? { ...p, groupIds: [...p.groupIds, newGid] } : p
      );
      saveProjectTree(next);
      return next;
    });
  };

  const removeSubproject = (projId, groupId) => {
    setProjectTree((prev) => {
      const next = prev.map((p) =>
        p.id === projId ? { ...p, groupIds: p.groupIds.filter((gId) => gId !== groupId) } : p
      );
      saveProjectTree(next);
      return next;
    });
  };

  const renameSubproject = (groupId, newTitle) => {
    setDynamicGroups((prev) => {
      const next = prev.map((g) => g.id === groupId ? { ...g, title: newTitle } : g);
      saveDynamicGroups(next);
      return next;
    });
  };

  // --- LANE SETTINGS PANEL ---
  const [showLaneSettings, setShowLaneSettings] = useState(false);

  // --- MILESTONES ---
  const [milestones, setMilestones] = useState(() => loadMilestones());
  const [showMilestoneEditor, setShowMilestoneEditor] = useState(false);

  const addMilestone = (title, datetime, color) => {
    setMilestones((prev) => {
      const next = [...prev, { id: `ms-${Date.now()}`, title, datetime, color: color || "#e67e22" }];
      saveMilestones(next);
      return next;
    });
  };

  const removeMilestone = (msId) => {
    setMilestones((prev) => {
      const next = prev.filter((m) => m.id !== msId);
      saveMilestones(next);
      return next;
    });
  };

  const updateMilestone = useCallback((msId, updates) => {
    setMilestones((prev) => {
      const next = prev.map((m) => m.id === msId ? { ...m, ...updates } : m);
      saveMilestones(next);
      return next;
    });
  }, []);

  // --- INSTANT EVENTS ---
  const [instantEvents, setInstantEvents] = useState(() => loadInstantEvents());
  const [showInstantEditor, setShowInstantEditor] = useState(false);

  // --- LAUNCH TIME (T-0 for elapsed time row) ---
  const [launchTime, setLaunchTime] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_LAUNCH_TIME);
      if (saved) return saved;
    } catch (e) {}
    return null;
  });
  const [showElapsedRow, setShowElapsedRow] = useState(() => !!launchTime);

  const updateLaunchTime = (isoStr) => {
    setLaunchTime(isoStr);
    if (isoStr) {
      try { localStorage.setItem(STORAGE_KEY_LAUNCH_TIME, isoStr); } catch (e) {}
      setShowElapsedRow(true);
    } else {
      try { localStorage.removeItem(STORAGE_KEY_LAUNCH_TIME); } catch (e) {}
      setShowElapsedRow(false);
    }
  };

  const INSTANT_SYMBOLS = ["▲", "▼", "●", "◆", "■", "★", "△", "▽", "◇", "○"];

  const addInstantEvent = (title, datetime, groupId, symbol, color) => {
    setInstantEvents((prev) => {
      const next = [...prev, { id: `ie-${Date.now()}`, title, datetime, groupId: Number(groupId), symbol: symbol || "▲", color: color || "#333333" }];
      saveInstantEvents(next);
      return next;
    });
  };

  const removeInstantEvent = (ieId) => {
    setInstantEvents((prev) => {
      const next = prev.filter((ie) => ie.id !== ieId);
      saveInstantEvents(next);
      return next;
    });
  };

  const updateInstantEvent = useCallback((ieId, updates) => {
    setInstantEvents((prev) => {
      const next = prev.map((ie) => ie.id === ieId ? { ...ie, ...updates } : ie);
      saveInstantEvents(next);
      return next;
    });
  }, []);

  const scaleWrapperRef = useRef(null);
  const rowsWrapperRef = useRef(null);
  const sidebarBodyRef = useRef(null);
  const isSyncingVScrollRef = useRef(false);

  const timelineStart = useMemo(
    () => selectedDate.subtract(1, "day").hour(12).startOf("hour"),
    [selectedDate]
  );
  const timelineEnd = useMemo(
    () => selectedDate.add(1, "day").hour(12).startOf("hour"),
    [selectedDate]
  );
  const totalMinutes = useMemo(
    () => timelineEnd.diff(timelineStart, "minute"),
    [timelineStart, timelineEnd]
  );

  // --- PERSISTENT MASTER ITEMS (localStorage) ---
  const [masterItems, setMasterItems] = useState(() => loadMasterItems());

  const updateMaster = useCallback((updaterFn) => {
    setMasterItems((prev) => {
      const next = typeof updaterFn === "function" ? updaterFn(prev) : updaterFn;
      saveMasterItems(next);
      return next;
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    const seeded = convertLegacyItems(itemsByDate);
    saveMasterItems(seeded);
    setMasterItems(seeded);
  }, []);

  // --- EXPORT / IMPORT PROJECT ---
  const exportProject = useCallback(() => {
    const payload = {
      _format: "timeline-project-v1",
      _exportedAt: new Date().toISOString(),
      items: masterItems,
      completedIds,
      milestones,
      laneCounts,
      laneHeight,
      dynamicGroups,
      projectTree,
      collapsedProjects: [...collapsedProjects],
      customImg1: customImg1 || null,
      customImg2: customImg2 || null,
      instantEvents,
      launchTime: launchTime || null,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timeline-export-${dayjs().format("YYYY-MM-DD-HHmm")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [masterItems, completedIds, milestones, laneCounts, laneHeight, dynamicGroups, projectTree, collapsedProjects, customImg1, customImg2, instantEvents, launchTime]);

  const importProject = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data._format !== "timeline-project-v1") {
            alert("Invalid file format. Expected a timeline project export.");
            return;
          }
          // Restore items
          if (Array.isArray(data.items)) {
            saveMasterItems(data.items);
            setMasterItems(data.items);
          }
          // Restore completed IDs
          if (Array.isArray(data.completedIds)) {
            setCompletedIds(data.completedIds);
            try { localStorage.setItem("SERVER_COMPLETED_DB", JSON.stringify(data.completedIds)); } catch (err) {}
          }
          // Restore milestones
          if (Array.isArray(data.milestones)) {
            setMilestones(data.milestones);
            saveMilestones(data.milestones);
          }
          // Restore lane counts
          if (data.laneCounts && typeof data.laneCounts === "object") {
            setLaneCounts(data.laneCounts);
            saveLaneCounts(data.laneCounts);
          }
          // Restore lane height
          if (typeof data.laneHeight === "number") {
            setLaneHeight(data.laneHeight);
            saveLaneHeight(data.laneHeight);
          }
          // Restore dynamic groups
          if (Array.isArray(data.dynamicGroups)) {
            setDynamicGroups(data.dynamicGroups);
            saveDynamicGroups(data.dynamicGroups);
          }
          // Restore project tree
          if (Array.isArray(data.projectTree)) {
            setProjectTree(data.projectTree);
            saveProjectTree(data.projectTree);
          }
          // Restore collapsed projects
          if (Array.isArray(data.collapsedProjects)) {
            const set = new Set(data.collapsedProjects);
            setCollapsedProjects(set);
            saveCollapsedProjects(set);
          }
          // Restore custom images
          if (data.customImg1) {
            setCustomImg1(data.customImg1);
            try { localStorage.setItem("TIMELINE_CUSTOM_IMG1", data.customImg1); } catch (err) {}
          }
          if (data.customImg2) {
            setCustomImg2(data.customImg2);
            try { localStorage.setItem("TIMELINE_CUSTOM_IMG2", data.customImg2); } catch (err) {}
          }
          // Restore instant events
          if (Array.isArray(data.instantEvents)) {
            setInstantEvents(data.instantEvents);
            saveInstantEvents(data.instantEvents);
          }
          // Restore launch time
          if (data.launchTime) {
            updateLaunchTime(data.launchTime);
          }
        } catch (err) {
          alert("Failed to parse project file: " + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  // --- VIEWPORT FILTERING (replaces day-based itemsByDate lookup) ---
  const itemsForRange = useMemo(() => {
    const tsStart = timelineStart;
    const tsEnd = timelineEnd;

    return masterItems
      .filter((it) => {
        const s = dayjs.utc(it.absStart);
        const e = dayjs.utc(it.absEnd);
        // Item overlaps with viewport?
        return s.isBefore(tsEnd) && e.isAfter(tsStart);
      })
      .map((it) => {
        const s = dayjs.utc(it.absStart);
        const e = dayjs.utc(it.absEnd);
        const relStart = s.diff(tsStart, "minute");
        const relEnd = e.diff(tsStart, "minute");
        const group = dynamicGroups.find((g) => g.id === it.groupId);
        const isCompletedFromServer = completedIds.includes(it.id);

        // Multi-day detection
        const isMultiDay = (relEnd - relStart) > 1440 || relStart < 0 || relEnd > totalMinutes;

        return {
          ...it,
          kind: it.kind || "task",
          startMin: relStart,   // CAN be negative (started before viewport)
          endMin: relEnd,       // CAN exceed totalMinutes (ends after viewport)
          groupName: group ? group.title : it.groupId,
          description: it.description,
          completed: it.kind === "event" ? false : isCompletedFromServer,
          absStart: it.absStart,
          absEnd: it.absEnd,
          urgent: it.urgent || false,
          color: it.color,
          movable: it.movable !== false,
          invisible: it.invisible || false,
          _prevColorBeforeUrgent: it._prevColorBeforeUrgent || null,
          eventType: it.eventType || null,
          participants: it.participants || "",
          isMultiDay,
        };
      });
  }, [masterItems, timelineStart, timelineEnd, totalMinutes, completedIds, dynamicGroups]);

  // Local State for Items (Editable)
  const [items, setItems] = useState(itemsForRange);

  // Keep selectedTask in sync
  useEffect(() => {
    if (!selectedTask) return;
    const selId = Number(selectedTask.id);
    const fresh = items.find((t) => Number(t.id) === selId);
    if (fresh && fresh !== selectedTask) {
      setSelectedTask(fresh);
    }
  }, [items, selectedTask]);

  useEffect(() => {
    setItems(itemsForRange);
    setDragState(null);
  }, [itemsForRange]);

  // --- Shared: generate next available ID ---
  const getNextId = useCallback(
    (currentItems) => {
      const usedIds = new Set(currentItems.map((t) => Number(t.id)));
      let newId = 1;
      while (usedIds.has(newId) && newId <= 100) newId += 1;
      return newId;
    },
    []
  );

  // --- CREATE NEW TASK (ADMIN) ---
  const openCreateTask = () => {
    const now = dayjs.utc();
    const nowRel = now.diff(timelineStart, "minute", true);
    const snapFn = (m) => Math.round(m / SNAP_MINUTES) * SNAP_MINUTES;

    const startMin = clamp(snapFn(nowRel), 0, Math.max(0, totalMinutes - SNAP_MINUTES));
    const defaultDur = Math.max(SNAP_MINUTES, 120);
    const endMin = clamp(startMin + defaultDur, startMin + SNAP_MINUTES, totalMinutes);

    const newId = getNextId(items);
    const defaultGroupId = dynamicGroups?.[0]?.id ?? 1;
    const g = dynamicGroups.find((gg) => gg.id === defaultGroupId);

    const draft = {
      id: newId,
      kind: "task",
      title: `Mission ${newId}`,
      groupId: defaultGroupId,
      groupName: g ? g.title : String(defaultGroupId),
      lane: 0,
      startMin,
      endMin,
      urgent: false,
      color: "#4f8df5",
      movable: true,
      invisible: false,
      completed: false,
      description: "",
      dependencies: [],
      depLags: {},
      absStart: timelineStart.add(startMin, "minute").toISOString(),
      absEnd: timelineStart.add(endMin, "minute").toISOString(),
    };

    setCreateDraft(draft);
    setIsCreateOpen(true);
  };

  // --- CREATE NEW EVENT (ADMIN) ---
  const openCreateEvent = () => {
    const now = dayjs.utc();
    const nowRel = now.diff(timelineStart, "minute", true);
    const snapFn = (m) => Math.round(m / SNAP_MINUTES) * SNAP_MINUTES;

    const startMin = clamp(snapFn(nowRel), 0, Math.max(0, totalMinutes - SNAP_MINUTES));
    const defaultDur = Math.max(SNAP_MINUTES, 60); // Events default 1h
    const endMin = clamp(startMin + defaultDur, startMin + SNAP_MINUTES, totalMinutes);

    const newId = getNextId(items);
    const defaultGroupId = dynamicGroups?.[0]?.id ?? 1;
    const g = dynamicGroups.find((gg) => gg.id === defaultGroupId);

    const draft = {
      id: newId,
      kind: "event",
      title: `Event ${newId}`,
      groupId: defaultGroupId,
      groupName: g ? g.title : String(defaultGroupId),
      lane: 0,
      startMin,
      endMin,
      urgent: false,
      color: EVENT_TYPE_COLORS.meeting,
      movable: true,
      invisible: false,
      completed: false,
      description: "",
      dependencies: [],
      depLags: {},
      absStart: timelineStart.add(startMin, "minute").toISOString(),
      absEnd: timelineStart.add(endMin, "minute").toISOString(),
      // Event specific
      eventType: "meeting",
      participants: "",
    };

    setCreateDraft(draft);
    setIsCreateOpen(true);
  };

  const handleCreateItem = (newItem) => {
    const used = new Set(items.map((t) => Number(t.id)));
    let idNum = clamp(Number(newItem.id), 1, 9999);
    while (used.has(idNum) && idNum <= 9999) idNum += 1;

    const next = {
      ...newItem,
      id: idNum,
      startMin: Number(newItem.startMin ?? 0),
      endMin: Number(newItem.endMin ?? 0),
    };

    // Ensure absolute timestamps exist
    if (!next.absStart) next.absStart = timelineStart.add(next.startMin, "minute").toISOString();
    if (!next.absEnd) next.absEnd = timelineStart.add(next.endMin, "minute").toISOString();

    const gg = dynamicGroups.find((x) => x.id === next.groupId);
    next.groupName = gg ? gg.title : next.groupName;

    // Add to local items
    setItems((prev) => [...prev, next]);

    // Persist to master (localStorage)
    updateMaster((prev) => [...prev, {
      ...next,
      // Remove transient fields
      groupName: undefined,
      isMultiDay: undefined,
    }]);
  };

  // --- DELETE ITEM ---
  const handleDeleteItem = (itemId) => {
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    updateMaster((prev) => prev.filter((i) => i.id !== itemId));
    setSelectedTask(null);

    // Clean up completedIds
    setCompletedIds((prevIds) => {
      const newIds = prevIds.filter((id) => id !== itemId);
      localStorage.setItem("SERVER_COMPLETED_DB", JSON.stringify(newIds));
      return newIds;
    });
  };

  // Helper: sync local items array back to masterItems (localStorage)
  const syncItemsToMaster = useCallback((localItems) => {
    updateMaster((prevMaster) => {
      const masterMap = new Map(prevMaster.map((m) => [m.id, m]));
      for (const li of localItems) {
        const { groupName, isMultiDay, ...persistFields } = li;
        masterMap.set(li.id, { ...masterMap.get(li.id), ...persistFields });
      }
      return Array.from(masterMap.values());
    });
  }, [updateMaster]);

  // --- UPDATING ITEM ATTRIBUTES (ADMIN) ---
  const handleUpdateTask = (taskId, updates) => {
    setItems((prevItems) => {
      const propagateDeps = (itemsArr, movedId, snapFn, visited = new Set()) => {
        if (visited.has(movedId)) return itemsArr;
        visited.add(movedId);

        const moved = itemsArr.find((x) => x.id === movedId);
        if (!moved) return itemsArr;

        const movedEnd = moved.endMin;

        const children = itemsArr.filter(
          (t) => Array.isArray(t.dependencies) && t.dependencies.includes(movedId)
        );

        let next = itemsArr;

        for (const child of children) {
          if (child.movable === false) continue;

          const lag = (child.depLags && child.depLags[movedId]) ?? 0;
          const dur = (child.endMin ?? 0) - (child.startMin ?? 0);

          let newStart = snapFn(movedEnd + lag);
          let newEnd = newStart + dur;

          // Multi-day fix: use totalMinutes instead of hardcoded 1440
          if (newStart < 0) {
            newStart = 0;
            newEnd = dur;
          }
          if (newEnd > totalMinutes) {
            newEnd = totalMinutes;
            newStart = totalMinutes - dur;
          }

          next = next.map((x) =>
            x.id === child.id ? { ...x, startMin: newStart, endMin: newEnd } : x
          );

          next = propagateDeps(next, child.id, snapFn, visited);
        }

        return next;
      };

      const applyToSameGroupLane = !!updates?._applyToSameGroupLane;
      const { _applyToSameGroupLane, ...rawUpdates } = updates || {};

      if (Object.prototype.hasOwnProperty.call(rawUpdates, "dependencies")) {
        const arr = Array.isArray(rawUpdates.dependencies) ? rawUpdates.dependencies : [];
        rawUpdates.dependencies = arr
          .map((d) => Number(d))
          .filter((n) => Number.isFinite(n));
      }

      const baseTask = prevItems.find((x) => x.id === taskId);
      if (!baseTask) return prevItems;

      const normGroup = (v) => String(v);
      const normLane = (v) => Number(v ?? 0);

      const baseGroupId = normGroup(baseTask.groupId);
      const baseLane = normLane(baseTask.lane);

      const shouldBroadcast = applyToSameGroupLane === true;

      const hasColorField = Object.prototype.hasOwnProperty.call(rawUpdates, "color");
      const hasPrevField = Object.prototype.hasOwnProperty.call(
        rawUpdates,
        "_prevColorBeforeUrgent"
      );

      const oldId = baseTask.id;
      let requestedNewId = oldId;
      if (Object.prototype.hasOwnProperty.call(rawUpdates, "id")) {
        const n = Number(rawUpdates.id);
        if (Number.isFinite(n)) requestedNewId = clamp(n, 1, 9999);
      }

      let finalNewId = oldId;
      if (requestedNewId !== oldId) {
        const exists = prevItems.some((x) => x.id === requestedNewId);
        if (!exists) finalNewId = requestedNewId;
        else delete rawUpdates.id;
      }

      const idChanged = finalNewId !== oldId;

      const next = prevItems.map((item) => {
        const sameBucket =
          normGroup(item.groupId) === baseGroupId && normLane(item.lane) === baseLane;

        const isTarget = item.id === taskId || (shouldBroadcast && sameBucket);
        if (!isTarget) return item;

        if (item.id === taskId) {
          let merged = { ...item, ...rawUpdates };
          if (idChanged) merged.id = finalNewId;

          // Ensure absStart/absEnd are in sync
          if (rawUpdates.absStart) merged.absStart = rawUpdates.absStart;
          else if (rawUpdates.startMin !== undefined) merged.absStart = timelineStart.add(rawUpdates.startMin, "minute").toISOString();
          if (rawUpdates.absEnd) merged.absEnd = rawUpdates.absEnd;
          else if (rawUpdates.endMin !== undefined) merged.absEnd = timelineStart.add(rawUpdates.endMin, "minute").toISOString();

          if (Object.prototype.hasOwnProperty.call(rawUpdates, "groupId")) {
            const g = dynamicGroups.find((gg) => gg.id === merged.groupId);
            merged.groupName = g ? g.title : merged.groupName;
          }

          return merged;
        }

        let merged = { ...item };
        if (hasColorField) merged.color = rawUpdates.color;
        if (hasPrevField) merged._prevColorBeforeUrgent = rawUpdates._prevColorBeforeUrgent;

        if (item.urgent) {
          const normalColor =
            (hasPrevField && rawUpdates._prevColorBeforeUrgent) ||
            (hasColorField ? rawUpdates.color : merged._prevColorBeforeUrgent) ||
            merged._prevColorBeforeUrgent ||
            "#4f8df5";

          merged._prevColorBeforeUrgent = normalColor;
          merged.color = "#e74c3c";
        }

        return merged;
      });

      let next2 = next;
      if (idChanged) {
        next2 = next.map((it) => {
          if (!Array.isArray(it.dependencies) || it.dependencies.length === 0) return it;
          const replaced = it.dependencies.map((d) =>
            Number(d) === Number(oldId) ? finalNewId : d
          );
          return { ...it, dependencies: replaced };
        });

        setCompletedIds((prevIds) => {
          if (!prevIds.includes(oldId)) return prevIds;
          const updatedIds = prevIds.map((x) => (x === oldId ? finalNewId : x));
          localStorage.setItem("SERVER_COMPLETED_DB", JSON.stringify(updatedIds));
          return updatedIds;
        });
      }

      const timeChanged =
        Object.prototype.hasOwnProperty.call(rawUpdates, "startMin") ||
        Object.prototype.hasOwnProperty.call(rawUpdates, "endMin");

      const movedId = idChanged ? finalNewId : taskId;

      let finalNext = next2;

      // Only propagate deps for tasks (not events)
      if (timeChanged && baseTask.kind !== "event") {
        const snapFn = (m) => Math.round(m / SNAP_MINUTES) * SNAP_MINUTES;
        finalNext = propagateDeps(finalNext, movedId, snapFn);
      }

      const selectedLookupId = movedId;
      const updatedSelected = finalNext.find((x) => x.id === selectedLookupId);
      if (selectedTask && selectedTask.id === taskId && updatedSelected) {
        setSelectedTask(updatedSelected);
      }

      // ---- SYNC TO MASTER (localStorage) ----
      syncItemsToMaster(finalNext);

      return finalNext;
    });
  };

  const [nowLeft, setNowLeft] = useState(-9999);

  // --- DROPDOWN LISTS CALCULATION (ALL items, not just viewport) ---
  const completedTasks = useMemo(() => {
    return masterItems
      .filter((i) => {
        const kind = i.kind || "task";
        if (kind === "event") return false;
        if (i.invisible) return false;
        return completedIds.includes(i.id);
      })
      .map((i) => {
        const group = dynamicGroups.find((g) => g.id === i.groupId);
        return {
          ...i,
          kind: i.kind || "task",
          completed: true,
          groupName: group ? group.title : i.groupId,
          absEnd: dayjs.utc(i.absEnd),
          absStart: dayjs.utc(i.absStart),
        };
      })
      .sort((a, b) => b.absEnd.valueOf() - a.absEnd.valueOf());
  }, [masterItems, completedIds, dynamicGroups]);

  const overdueTasksMemo = useMemo(() => {
    const now = dayjs.utc();
    return masterItems
      .filter((i) => {
        const kind = i.kind || "task";
        if (kind === "event") return false;
        if (i.invisible) return false;
        if (completedIds.includes(i.id)) return false;
        const end = dayjs.utc(i.absEnd);
        return end.isBefore(now);
      })
      .map((i) => {
        const group = dynamicGroups.find((g) => g.id === i.groupId);
        return {
          ...i,
          kind: i.kind || "task",
          completed: false,
          groupName: group ? group.title : i.groupId,
          absEnd: dayjs.utc(i.absEnd),
          absStart: dayjs.utc(i.absStart),
        };
      })
      .sort((a, b) => a.absEnd.valueOf() - b.absEnd.valueOf());
  }, [masterItems, completedIds, dynamicGroups]);

  const toggleDropdown = (name) => {
    setActiveDropdown((prev) => (prev === name ? null : name));
  };

  const handleJumpToTask = (task) => {
    const absS = dayjs.isDayjs(task.absStart) ? task.absStart : dayjs.utc(task.absStart);
    const absE = dayjs.isDayjs(task.absEnd) ? task.absEnd : dayjs.utc(task.absEnd);
    const midpoint = absS.add(absE.diff(absS, "minute") / 2, "minute");
    const targetDay = midpoint.startOf("day");
    if (!targetDay.isSame(selectedDate, "day")) {
      setSelectedDate(targetDay);
    }
    setIsLocked(false);
    setSelectedTask(task);
    setActiveDropdown(null);
  };

  // --- ACTIONS ---
  const toggleTaskCompletion = (taskId) => {
    if (!isAdmin) return;
    // Events can't be completed
    const target = items.find((i) => i.id === taskId);
    if (target && target.kind === "event") return;

    setCompletedIds((prevIds) => {
      let newIds;
      if (prevIds.includes(taskId)) {
        newIds = prevIds.filter((id) => id !== taskId);
      } else {
        newIds = [...prevIds, taskId];
      }
      localStorage.setItem("SERVER_COMPLETED_DB", JSON.stringify(newIds));
      return newIds;
    });

    setItems((prev) =>
      prev.map((i) => (i.id === taskId ? { ...i, completed: !i.completed } : i))
    );

    setSelectedTask((prev) => {
      if (prev && prev.id === taskId) {
        return { ...prev, completed: !prev.completed };
      }
      return prev;
    });
  };

  // --- LAYOUT & ZOOM ---
  const [baseMinutePx, setBaseMinutePx] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(1000);

  useLayoutEffect(() => {
    const update = () => {
      const w = Math.max(320, window.innerWidth - SIDEBAR_WIDTH - 2);
      setViewportWidth(w);
      setBaseMinutePx(w / (24 * 60));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const minutePx = baseMinutePx * zoomLevel;
  const timelineWidth = totalMinutes * minutePx;

  // --- MILESTONE MARKERS (viewport positions) ---
  const milestoneMarkers = useMemo(() => {
    return milestones
      .map((ms) => {
        const dt = dayjs.utc(ms.datetime);
        if (!dt.isValid()) return null;
        const diffMins = dt.diff(timelineStart, "minute", true);
        const left = diffMins * minutePx;
        if (left < -20 || left > timelineWidth + 20) return null;
        return { ...ms, left, dt };
      })
      .filter(Boolean);
  }, [milestones, timelineStart, minutePx, timelineWidth]);

  // --- INSTANT EVENT MARKERS (per-group positioned) ---
  const instantMarkers = useMemo(() => {
    return instantEvents
      .map((ie) => {
        const dt = dayjs.utc(ie.datetime);
        if (!dt.isValid()) return null;
        const diffMins = dt.diff(timelineStart, "minute", true);
        const left = diffMins * minutePx;
        if (left < -20 || left > timelineWidth + 20) return null;
        return { ...ie, left, dt };
      })
      .filter(Boolean);
  }, [instantEvents, timelineStart, minutePx, timelineWidth]);

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev * 1.25, 5));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev / 1.25, 0.5));
  const handleResetZoom = () => setZoomLevel(1);

  // --- SCROLL & LIVE ---
  const handleScroll = useCallback((e) => {
    const target = e.currentTarget;

    const x = target.scrollLeft;
    if (target === rowsWrapperRef.current && scaleWrapperRef.current) {
      scaleWrapperRef.current.scrollLeft = x;
    }
    if (target === scaleWrapperRef.current && rowsWrapperRef.current) {
      rowsWrapperRef.current.scrollLeft = x;
    }

    if (
      (target === rowsWrapperRef.current || target === sidebarBodyRef.current) &&
      rowsWrapperRef.current &&
      sidebarBodyRef.current &&
      !isSyncingVScrollRef.current
    ) {
      isSyncingVScrollRef.current = true;
      const y = target.scrollTop;
      if (target === rowsWrapperRef.current) sidebarBodyRef.current.scrollTop = y;
      else rowsWrapperRef.current.scrollTop = y;
      requestAnimationFrame(() => {
        isSyncingVScrollRef.current = false;
      });
    }

    if (!isAutoScrolling.current) setIsLocked(false);
  }, []);

  useEffect(() => {
    const tick = () => {
      const now = dayjs.utc();
      setClock(now.format("HH:mm:ss"));

      if (now.isBefore(timelineStart) || now.isAfter(timelineEnd)) {
        setNowLeft(-9999);
      } else {
        const diffMins = now.diff(timelineStart, "minute", true);
        const left = diffMins * minutePx;
        setNowLeft(left);

        if (isLocked && rowsWrapperRef.current && scaleWrapperRef.current) {
          const centerPos = left - viewportWidth / 2;
          isAutoScrolling.current = true;
          rowsWrapperRef.current.scrollLeft = centerPos;
          scaleWrapperRef.current.scrollLeft = centerPos;
          requestAnimationFrame(() => {
            isAutoScrolling.current = false;
          });
        }
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timelineStart, timelineEnd, minutePx, viewportWidth, isLocked]);

  // --- RENDER HELPERS ---
  const crispLeft = useCallback((x, isBold) => {
    const r = Math.round(x);
    return isBold ? r : r + 0.5;
  }, []);

  const ticks = useMemo(() => {
    const arr = [];
    const step = zoomLevel < 0.6 ? 15 : 5;
    for (let m = 0; m <= totalMinutes; m += step) {
      const x = m * minutePx;
      let kind = "minor";
      if (m % 60 === 0) kind = "major";
      else if (m % 60 === 30) kind = "half";
      else if (m % 15 === 0) kind = "quarter";
      const isBold = kind === "major" || kind === "half";
      arr.push({ m, left: crispLeft(x, isBold), kind });
    }
    return arr;
  }, [minutePx, totalMinutes, crispLeft, zoomLevel]);

  const hourLabels = useMemo(() => {
    const arr = [];
    for (let h = 0; h <= totalMinutes / 60; h++) {
      const m = h * 60;
      const x = m * minutePx;
      const left = crispLeft(x, true);
      const timePoint = timelineStart.add(m, "minute");
      arr.push({
        h,
        left,
        label: timePoint.format("HH:mm"),
        isMidnight: timePoint.hour() === 0,
      });
    }
    return arr;
  }, [minutePx, totalMinutes, timelineStart, crispLeft]);

  const dateHeaders = useMemo(() => {
    const arr = [];
    let current = timelineStart.clone();
    while (current.isBefore(timelineEnd)) {
      const nextMidnight = current.add(1, "day").startOf("day");
      const segmentEnd = nextMidnight.isBefore(timelineEnd) ? nextMidnight : timelineEnd;
      const startMin = current.diff(timelineStart, "minute");
      const durationMin = segmentEnd.diff(current, "minute");
      if (durationMin > 0) {
        arr.push({
          label: current.format("MMM DD"),
          left: startMin * minutePx,
          width: durationMin * minutePx,
        });
      }
      current = segmentEnd;
    }
    return arr;
  }, [timelineStart, timelineEnd, minutePx]);

  // --- ELAPSED TIME ROW LABELS ---
  const elapsedLabels = useMemo(() => {
    if (!launchTime || !showElapsedRow) return [];
    const t0 = dayjs.utc(launchTime);
    if (!t0.isValid()) return [];
    const arr = [];
    for (let h = 0; h <= totalMinutes / 60; h++) {
      const absTime = timelineStart.add(h, "hour");
      const diffMins = absTime.diff(t0, "minute");
      const diffHours = diffMins / 60;
      const roundedH = Math.round(diffHours);
      const left = h * 60 * minutePx;

      // Show at L-0 position (closest hour to launch)
      const isZero = Math.abs(diffMins) < 30;
      const label = isZero ? "L" : roundedH > 0 ? `L+${roundedH}` : `L${roundedH}`;

      // Day boundary: every 24h from T-0
      const isDayBoundary = roundedH !== 0 && roundedH % 24 === 0;
      const dayNumber = Math.round(roundedH / 24);

      arr.push({ left, label, isZero, value: roundedH, isDayBoundary, dayNumber });
    }
    return arr;
  }, [launchTime, showElapsedRow, timelineStart, totalMinutes, minutePx]);

  // T-0 vertical line position
  const t0Left = useMemo(() => {
    if (!launchTime || !showElapsedRow) return null;
    const t0 = dayjs.utc(launchTime);
    if (!t0.isValid()) return null;
    const diffMins = t0.diff(timelineStart, "minute", true);
    const left = diffMins * minutePx;
    if (left < -20 || left > timelineWidth + 20) return null;
    return left;
  }, [launchTime, showElapsedRow, timelineStart, minutePx, timelineWidth]);

  const majorGridlines = useMemo(() => {
    const arr = [];
    for (let h = 0; h <= totalMinutes / 60; h++) {
      const x = h * 60 * minutePx;
      const isMidnight = timelineStart.add(h, "hour").hour() === 0;
      arr.push({ h, left: crispLeft(x, false), isMidnight });
    }
    return arr;
  }, [minutePx, totalMinutes, timelineStart, crispLeft]);

  const dayStrip = useMemo(() => {
    const arr = [];
    for (let i = -3; i <= 3; i++) arr.push(selectedDate.add(i, "day"));
    return arr;
  }, [selectedDate]);

  // --- DRAG & DROP & CLICK ---
  const materializedItems = useMemo(() => {
    return items.map((it) => ({
      ...it,
      start: timelineStart.add(it.startMin, "minute").toISOString(),
      end: timelineStart.add(it.endMin, "minute").toISOString(),
    }));
  }, [items, timelineStart]);

  const previewItems = useMemo(() => {
    if (!dragState) return items;
    const dragged = items.find((x) => x.id === dragState.itemId);
    if (!dragged) return items;

    const duration = dragged.endMin - dragged.startMin;
    const previewLeft = dragState.initialLeft + dragState.dx;
    let newStartMin = Math.round(previewLeft / minutePx);
    newStartMin = Math.round(newStartMin / SNAP_MINUTES) * SNAP_MINUTES;
    let newEndMin = newStartMin + duration;

    if (newStartMin < 0) {
      newStartMin = 0;
      newEndMin = duration;
    }
    if (newEndMin > totalMinutes) {
      newEndMin = totalMinutes;
      newStartMin = totalMinutes - duration;
    }

    return items.map((x) =>
      x.id === dragged.id ? { ...x, startMin: newStartMin, endMin: newEndMin } : x
    );
  }, [dragState, items, minutePx, totalMinutes]);

  const conflictedIds = useMemo(() => computeConflicts(previewItems), [previewItems]);

  const handleMouseMove = useCallback(
    (e) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.startMouseX;
      if (Math.abs(dx) > 3) {
        suppressNextClickRef.current = true;
      }
      let newLeft = dragState.initialLeft + dx;
      const maxLeft = timelineWidth - dragState.width;
      newLeft = clamp(newLeft, 0, maxLeft);
      setDragState((prev) =>
        prev ? { ...prev, dx: newLeft - dragState.initialLeft } : prev
      );
    },
    [dragState, timelineWidth]
  );

  const handleMouseUp = useCallback(() => {
    if (!dragState) return;

    if (Math.abs(dragState.dx) < 3) {
      const clickedItem = items.find((i) => i.id === dragState.itemId);
      if (clickedItem) {
        const absStart = timelineStart.add(clickedItem.startMin, "minute");
        const absEnd = timelineStart.add(clickedItem.endMin, "minute");
        const group = dynamicGroups.find((g) => g.id === clickedItem.groupId);
        setSelectedTask({
          ...clickedItem,
          groupName: group ? group.title : clickedItem.groupId,
          start: absStart.toISOString(),
          end: absEnd.toISOString(),
          description: clickedItem.description,
        });
      }
      setDragState(null);
      if (suppressNextClickRef.current) {
        setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 0);
      }
      return;
    }

    const finalLeft = dragState.initialLeft + dragState.dx;
    let newStartMin = Math.round(finalLeft / minutePx);
    newStartMin = Math.round(newStartMin / SNAP_MINUTES) * SNAP_MINUTES;

    setItems((prev) => {
      const originalItem = prev.find((i) => i.id === dragState.itemId);
      if (!originalItem) return prev;

      const pushed = pushWithinSameLane({
        items: prev,
        draggedId: dragState.itemId,
        newStartMin,
        snap: SNAP_MINUTES,
        totalMinutes,
      });
      if (!pushed.ok || pushed.blocked) return prev;
      if (computeConflicts(pushed.nextItems).size > 0) return prev;

      const movedItem = pushed.nextItems.find((i) => i.id === dragState.itemId);
      const shiftAmount = movedItem.startMin - originalItem.startMin;

      let finalItems;
      // Events don't propagate dependencies
      if (originalItem.kind === "event") {
        finalItems = pushed.nextItems;
      } else {
        // Build map of shifts already applied by pushWithinSameLane
        const pushShifts = new Map();
        pushed.nextItems.forEach((item) => {
          const orig = prev.find((p) => p.id === item.id);
          if (orig && item.id !== dragState.itemId && orig.startMin !== item.startMin) {
            pushShifts.set(item.id, item.startMin - orig.startMin);
          }
        });
        finalItems = moveDependentItems(pushed.nextItems, dragState.itemId, shiftAmount, totalMinutes, pushShifts);
      }

      // Update absStart/absEnd for all moved items & sync to master
      const withAbs = finalItems.map((it) => {
        const prevVersion = prev.find((p) => p.id === it.id);
        if (prevVersion && (prevVersion.startMin !== it.startMin || prevVersion.endMin !== it.endMin)) {
          return {
            ...it,
            absStart: timelineStart.add(it.startMin, "minute").toISOString(),
            absEnd: timelineStart.add(it.endMin, "minute").toISOString(),
          };
        }
        return it;
      });

      syncItemsToMaster(withAbs);
      return withAbs;
    });

    setDragState(null);
  }, [dragState, minutePx, totalMinutes, items, timelineStart, syncItemsToMaster, dynamicGroups]);

  const handleItemMouseDown = (e, it, baseLeft, width) => {
    if (!isAdmin) return;
    if (!it.movable) return;
    e.preventDefault();
    e.stopPropagation();
    setIsLocked(false);
    setDragState({
      itemId: it.id,
      startMouseX: e.clientX,
      initialLeft: baseLeft,
      dx: 0,
      width,
    });
  };

  const handleItemClick = (e, it) => {
    e.stopPropagation();
    if (suppressNextClickRef.current) return;
    setSelectedTask(it);
  };

  useEffect(() => {
    if (!dragState) return;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, handleMouseMove, handleMouseUp]);

  // --- MILESTONE DRAG ---
  const [msDragState, setMsDragState] = useState(null);

  const handleMsMouseDown = (e, ms) => {
    if (!isAdmin) return;
    e.preventDefault();
    e.stopPropagation();
    setIsLocked(false);
    setMsDragState({
      msId: ms.id,
      startMouseX: e.clientX,
      initialLeft: ms.left,
    });
  };

  const handleMsMouseMove = useCallback(
    (e) => {
      if (!msDragState) return;
      const dx = e.clientX - msDragState.startMouseX;
      setMsDragState((prev) => (prev ? { ...prev, dx } : prev));
    },
    [msDragState]
  );

  const handleMsMouseUp = useCallback(() => {
    if (!msDragState) return;
    const dx = msDragState.dx || 0;
    if (Math.abs(dx) >= 3) {
      const finalLeft = msDragState.initialLeft + dx;
      const snappedMin = Math.round(finalLeft / minutePx / SNAP_MINUTES) * SNAP_MINUTES;
      const newDt = timelineStart.add(snappedMin, "minute");
      updateMilestone(msDragState.msId, { datetime: newDt.toISOString() });
    }
    setMsDragState(null);
  }, [msDragState, minutePx, timelineStart, updateMilestone]);

  useEffect(() => {
    if (!msDragState) return;
    window.addEventListener("mousemove", handleMsMouseMove);
    window.addEventListener("mouseup", handleMsMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMsMouseMove);
      window.removeEventListener("mouseup", handleMsMouseUp);
    };
  }, [msDragState, handleMsMouseMove, handleMsMouseUp]);

  // --- INSTANT EVENT DRAG ---
  const [ieDragState, setIeDragState] = useState(null);

  const handleIeMouseDown = (e, ie) => {
    if (!isAdmin) return;
    e.preventDefault();
    e.stopPropagation();
    setIsLocked(false);
    setIeDragState({ ieId: ie.id, startMouseX: e.clientX, initialLeft: ie.left });
  };

  const handleIeMouseMove = useCallback(
    (e) => {
      if (!ieDragState) return;
      const dx = e.clientX - ieDragState.startMouseX;
      setIeDragState((prev) => (prev ? { ...prev, dx } : prev));
    },
    [ieDragState]
  );

  const handleIeMouseUp = useCallback(() => {
    if (!ieDragState) return;
    const dx = ieDragState.dx || 0;
    if (Math.abs(dx) >= 3) {
      const finalLeft = ieDragState.initialLeft + dx;
      const snappedMin = Math.round(finalLeft / minutePx / SNAP_MINUTES) * SNAP_MINUTES;
      const newDt = timelineStart.add(snappedMin, "minute");
      updateInstantEvent(ieDragState.ieId, { datetime: newDt.toISOString() });
    }
    setIeDragState(null);
  }, [ieDragState, minutePx, timelineStart, updateInstantEvent]);

  useEffect(() => {
    if (!ieDragState) return;
    window.addEventListener("mousemove", handleIeMouseMove);
    window.addEventListener("mouseup", handleIeMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleIeMouseMove);
      window.removeEventListener("mouseup", handleIeMouseUp);
    };
  }, [ieDragState, handleIeMouseMove, handleIeMouseUp]);

  const yearLabel = selectedDate.format("YYYY");
  const monthLabel = selectedDate.format("MMMM");
  const weekLabel = `Week ${selectedDate.week()}`;
  const dayLabel = selectedDate.format("DD MMM ddd");
  const hasData = items.length > 0;

  const handleDatePickerChange = (e) => {
    const val = e.target.value;
    if (val) {
      setIsLocked(false);
      setSelectedDate(dayjs.utc(val));
    }
  };

  const handleResumeLive = () => {
    setIsLocked(true);
    setSelectedDate(dayjs.utc());
  };

  return (
    <div className="timeline-root">
      {/* LOGIN MODAL */}
      {showLoginModal && (
        <div className="login-modal-overlay" onClick={() => setShowLoginModal(false)}>
          <div className="login-modal" onClick={(e) => e.stopPropagation()}>
            <div className="login-modal-header">
              <span className="login-lock-icon">🔐</span>
              <h3>Admin Login</h3>
            </div>
            <div className="login-modal-body">
              <label>Username</label>
              <input
                id="login-username"
                type="text"
                placeholder="Enter username"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") document.getElementById("login-password")?.focus();
                }}
              />
              <label>Password</label>
              <input
                id="login-password"
                type="password"
                placeholder="Enter password"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const u = document.getElementById("login-username")?.value;
                    const p = document.getElementById("login-password")?.value;
                    if (u === "admin" && p === "admin") {
                      setIsAdmin(true);
                      setShowLoginModal(false);
                      setLoginError("");
                    } else {
                      setLoginError("Invalid username or password");
                    }
                  }
                }}
              />
              {loginError && <div className="login-error">{loginError}</div>}
            </div>
            <div className="login-modal-footer">
              <button
                className="login-btn-cancel"
                onClick={() => setShowLoginModal(false)}
              >
                Cancel
              </button>
              <button
                className="login-btn-submit"
                onClick={() => {
                  const u = document.getElementById("login-username")?.value;
                  const p = document.getElementById("login-password")?.value;
                  if (u === "admin" && p === "admin") {
                    setIsAdmin(true);
                    setShowLoginModal(false);
                    setLoginError("");
                  } else {
                    setLoginError("Invalid username or password");
                  }
                }}
              >
                Login
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedTask && (
        <TaskInfoModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onToggleComplete={toggleTaskCompletion}
          onUpdateTask={handleUpdateTask}
          onDeleteItem={handleDeleteItem}
          isAdmin={isAdmin}
          groupsData={dynamicGroups}
          projectTree={projectTree}
          laneCounts={laneCounts}
          timelineStart={timelineStart}
          totalMinutes={totalMinutes}
          snapMinutes={SNAP_MINUTES}
          allTasks={items}
        />
      )}

      {isCreateOpen && createDraft && (
        <TaskInfoModal
          task={createDraft}
          onClose={() => {
            setIsCreateOpen(false);
            setCreateDraft(null);
          }}
          onToggleComplete={() => {}}
          onUpdateTask={(_, updates) => {
            const merged = { ...createDraft, ...updates };
            handleCreateItem(merged);
          }}
          onDeleteItem={null}
          isAdmin={true}
          groupsData={dynamicGroups}
          projectTree={projectTree}
          laneCounts={laneCounts}
          timelineStart={timelineStart}
          totalMinutes={totalMinutes}
          snapMinutes={SNAP_MINUTES}
          allTasks={items}
          closeOnApply={true}
        />
      )}

      <div className="timeline-header">
        <div className="timeline-sidebar-header">
          <div className="left-top-stack">
            <div
              className={"left-image-slot" + (isAdmin ? " left-image-editable" : "")}
              onClick={() => isAdmin && handleImageUpload(1)}
              title={isAdmin ? "Click to change image" : ""}
            >
              <img src={customImg1 || img1} alt="IMG 1" className="left-image" />
              {isAdmin && <div className="image-edit-overlay">📷</div>}
            </div>
            <div
              className={"left-image-slot" + (isAdmin ? " left-image-editable" : "")}
              onClick={() => isAdmin && handleImageUpload(2)}
              title={isAdmin ? "Click to change image" : ""}
            >
              <img src={customImg2 || img2} alt="IMG 2" className="left-image" />
              {isAdmin && <div className="image-edit-overlay">📷</div>}
            </div>
          </div>
          <div className="left-projects-label">Projects</div>
        </div>
        <div className="timeline-header-main">
          <div className="timeline-date-header">
            <span className="timeline-date-year">{yearLabel}</span>
            <span>{monthLabel}</span>
            <span>{weekLabel}</span>
            <span>{dayLabel}</span>

            <span className="timeline-date-spacer" />

            <div className="timeline-controls">
              {/* DROPDOWNS */}
              <div
                className="timeline-header-actions"
                style={{ marginRight: 15, display: "flex", gap: 10 }}
              >
                <div className="status-dropdown-container">
                  <button
                    className="status-dropdown-btn"
                    onClick={() => toggleDropdown("completed")}
                    style={{ borderColor: activeDropdown === "completed" ? "#27ae60" : "#ccc" }}
                  >
                    <span>✅ Completed</span>
                    <span className="status-dropdown-count">{completedTasks.length}</span>
                  </button>
                  {activeDropdown === "completed" && (
                    <div className="status-dropdown-menu">
                      {completedTasks.length === 0 ? (
                        <div
                          className="status-dropdown-item"
                          style={{ cursor: "default", color: "#999" }}
                        >
                          No completed tasks
                        </div>
                      ) : (
                        completedTasks.map((t) => (
                          <div
                            key={t.id}
                            className="status-dropdown-item"
                            onClick={() => handleJumpToTask(t)}
                          >
                            <div className="dropdown-item-title">{t.title}</div>
                            <div className="dropdown-item-time">
                              {t.absStart.format("MMM DD, HH:mm")} → {t.absEnd.format("HH:mm")}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                <div className="status-dropdown-container">
                  <button
                    className="status-dropdown-btn"
                    onClick={() => toggleDropdown("overdue")}
                    style={{ borderColor: activeDropdown === "overdue" ? "#e74c3c" : "#ccc" }}
                  >
                    <span>⚠️ Pending / Overdue</span>
                    <span className="status-dropdown-count">{overdueTasksMemo.length}</span>
                  </button>

                  {activeDropdown === "overdue" && (
                    <div className="status-dropdown-menu">
                      {overdueTasksMemo.length === 0 ? (
                        <div
                          className="status-dropdown-item"
                          style={{ cursor: "default", color: "#999" }}
                        >
                          No overdue tasks
                        </div>
                      ) : (
                        overdueTasksMemo.map((t) => (
                          <div
                            key={t.id}
                            className="status-dropdown-item timeline-item-overdue-list"
                            onClick={() => handleJumpToTask(t)}
                          >
                            <div className="dropdown-item-title">{t.title}</div>
                            <div className="dropdown-item-time" style={{ color: "#c0392b" }}>
                              {t.absStart.format("MMM DD, HH:mm")} → {t.absEnd.format("HH:mm")}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              {!isAdmin ? (
                <button
                  onClick={() => { setShowLoginModal(true); setLoginError(""); }}
                  style={{
                    marginRight: 10,
                    background: "#2c3e50",
                    color: "#fff",
                    border: "none",
                    padding: "4px 12px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontWeight: "bold",
                    fontSize: "0.85rem",
                  }}
                  title="Admin Login"
                >
                  🔒 Admin Login
                </button>
              ) : (
                <button
                  onClick={() => setIsAdmin(false)}
                  style={{
                    marginRight: 10,
                    background: "#e74c3c",
                    color: "#fff",
                    border: "none",
                    padding: "4px 12px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontWeight: "bold",
                    fontSize: "0.85rem",
                  }}
                  title="Switch to User"
                >
                  👤 User Login
                </button>
              )}

              {isAdmin && (
                <>
                  <button
                    onClick={openCreateTask}
                    style={{
                      marginRight: 4,
                      background: "#2ecc71",
                      color: "#fff",
                      border: "none",
                      padding: "4px 10px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontWeight: "bold",
                    }}
                    title="Add new task"
                  >
                    + Add Task
                  </button>

                  <button
                    onClick={openCreateEvent}
                    style={{
                      marginRight: 10,
                      background: "#3498db",
                      color: "#fff",
                      border: "none",
                      padding: "4px 10px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontWeight: "bold",
                    }}
                    title="Add new event"
                  >
                    📅 Add Event
                  </button>

                  <button
                    onClick={() => {
                      if (window.confirm("Tüm değişiklikler silinip varsayılan veriye dönülsün mü?")) {
                        resetToDefaults();
                      }
                    }}
                    style={{
                      marginRight: 4,
                      background: "#95a5a622",
                      color: "#7f8c8d",
                      border: "1px solid #bdc3c7",
                      padding: "4px 10px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "0.85em",
                    }}
                    title="Reset all changes"
                  >
                    ↺ Reset
                  </button>

                  <button
                    onClick={() => setShowLaneSettings((v) => !v)}
                    style={{
                      marginRight: 4,
                      background: showLaneSettings ? "#8e44ad" : "#8e44ad22",
                      color: showLaneSettings ? "#fff" : "#8e44ad",
                      border: "1px solid #8e44ad55",
                      padding: "4px 10px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "0.85em",
                    }}
                    title="Lane settings"
                  >
                    ⚙ Lanes
                  </button>

                  <button
                    onClick={() => setShowProjectEditor((v) => !v)}
                    style={{
                      marginRight: 4,
                      background: showProjectEditor ? "#2c3e50" : "#2c3e5022",
                      color: showProjectEditor ? "#fff" : "#2c3e50",
                      border: "1px solid #2c3e5055",
                      padding: "4px 10px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "0.85em",
                    }}
                    title="Projects & Sub-projects"
                  >
                    📂 Projects
                  </button>

                  <button
                    onClick={() => setShowMilestoneEditor((v) => !v)}
                    style={{
                      marginRight: 4,
                      background: showMilestoneEditor ? "#e67e22" : "#e67e2222",
                      color: showMilestoneEditor ? "#fff" : "#e67e22",
                      border: "1px solid #e67e2255",
                      padding: "4px 10px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "0.85em",
                    }}
                    title="Milestone markers"
                  >
                    ◆ Milestones
                  </button>

                  <button
                    onClick={() => setShowInstantEditor((v) => !v)}
                    style={{
                      marginRight: 4,
                      background: showInstantEditor ? "#555" : "#55555522",
                      color: showInstantEditor ? "#fff" : "#555",
                      border: "1px solid #55555555",
                      padding: "4px 10px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "0.85em",
                    }}
                    title="Instant events (point markers)"
                  >
                    ▲ Instants
                  </button>

                  <button
                    onClick={exportProject}
                    style={{
                      marginRight: 4,
                      background: "#16a08522",
                      color: "#16a085",
                      border: "1px solid #16a08555",
                      padding: "4px 10px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "0.85em",
                    }}
                    title="Export project as JSON"
                  >
                    📤 Export
                  </button>

                  <button
                    onClick={importProject}
                    style={{
                      marginRight: 4,
                      background: "#297fb822",
                      color: "#297fb8",
                      border: "1px solid #297fb855",
                      padding: "4px 10px",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "0.85em",
                    }}
                    title="Import project from JSON"
                  >
                    📥 Import
                  </button>
                </>
              )}

              <div className="timeline-live-status">
                <span className="timeline-live-clock">{clock} UTC+0</span>
              </div>
            </div>
          </div>

          <div className="timeline-day-strip">
            <button
              className="timeline-day-nav"
              onClick={() => {
                setIsLocked(false);
                setSelectedDate((d) => d.subtract(1, "day"));
              }}
            >
              ◀
            </button>

            <div className="timeline-day-strip-inner">
              {dayStrip.map((d) => {
                const isSel = d.isSame(selectedDate, "day");
                const isToday = d.isSame(dayjs.utc(), "day");

                const dayStyle = isToday
                  ? { border: "2px solid #e74c3c", fontWeight: "bold" }
                  : {};

                return (
                  <button
                    key={d.format("YYYY-MM-DD")}
                    className={"timeline-day" + (isSel ? " is-selected" : "")}
                    style={dayStyle}
                    onClick={() => {
                      setIsLocked(false);
                      setSelectedDate(d);
                    }}
                  >
                    <div className="timeline-day-dow">{d.format("ddd")}</div>
                    <div className="timeline-day-dom">{d.format("D")}</div>
                  </button>
                );
              })}
            </div>

            <button
              className="timeline-day-nav"
              onClick={() => {
                setIsLocked(false);
                setSelectedDate((d) => d.add(1, "day"));
              }}
            >
              ▶
            </button>

            <div className="timeline-date-picker-wrapper">
              <input
                type="date"
                className="timeline-date-picker-input"
                value={selectedDate.format("YYYY-MM-DD")}
                onChange={handleDatePickerChange}
              />
            </div>

            {/* L (Launch Time) Input */}
            {isAdmin && (
              <div className="elapsed-input-group">
                <span className="elapsed-input-label" style={{ color: showElapsedRow ? "#e74c3c" : "#999" }}>L</span>
                <input
                  type="datetime-local"
                  value={launchTime ? dayjs.utc(launchTime).format("YYYY-MM-DDTHH:mm") : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) updateLaunchTime(dayjs.utc(v).toISOString());
                    else updateLaunchTime(null);
                  }}
                  className="elapsed-input-dt"
                />
                {launchTime && (
                  <button
                    onClick={() => updateLaunchTime(null)}
                    className="elapsed-input-clear"
                    title="Remove launch time"
                  >✕</button>
                )}
              </div>
            )}

            <div style={{ flex: 1 }} />

            {/* ZOOM + RESUME LIVE (far right) */}
            <div className="timeline-zoom-controls">
              <button onClick={handleZoomOut} className="zoom-btn">-</button>
              <span className="zoom-label">{Math.round(zoomLevel * 100)}%</span>
              <button onClick={handleZoomIn} className="zoom-btn">+</button>
              {zoomLevel !== 1 && (
                <button className="reset-zoom-btn" onClick={handleResetZoom}>
                  Reset Zoom
                </button>
              )}
            </div>
            {!isLocked && (
              <button className="timeline-recenter-btn" onClick={handleResumeLive}>
                RESUME LIVE
              </button>
            )}
          </div>
          <div className="timeline-header-spacer" />

          {/* LANE SETTINGS PANEL */}
          {isAdmin && showLaneSettings && (
            <div className="admin-settings-panel">
              <div className="admin-panel-title">⚙ Lane Settings</div>
              <div className="admin-panel-row">
                <label>Lane Height (px):</label>
                <input
                  type="number" min={20} max={50} step={2} value={laneHeight}
                  onChange={(e) => updateLaneHeight(Number(e.target.value))}
                  className="admin-num-input"
                />
              </div>
              <div style={{ fontSize: "0.8em", color: "#7f8c8d", marginTop: 6, marginBottom: 6 }}>
                Per sub-project lane counts:
              </div>
              {projectTree.map((proj) => {
                const projGroups = proj.groupIds
                  .map((gId) => dynamicGroups.find((g) => g.id === gId))
                  .filter(Boolean);
                if (projGroups.length === 0) return null;
                return (
                  <div key={proj.id} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: "0.8em", fontWeight: 800, color: "#555", marginBottom: 3 }}>{proj.name}</div>
                    {projGroups.map((g) => (
                      <div key={g.id} className="admin-panel-row" style={{ marginBottom: 3 }}>
                        <label style={{ width: 120, fontSize: "0.78em" }}>{g.title}:</label>
                        <input
                          type="number" min={1} max={8} step={1}
                          value={getLaneCount(g.id)}
                          onChange={(e) => setGroupLaneCount(g.id, Number(e.target.value))}
                          className="admin-num-input"
                        />
                        <span style={{ fontSize: "0.78em", color: "#7f8c8d" }}>
                          = {getLaneCount(g.id) * laneHeight}px
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* PROJECT EDITOR PANEL */}
          {isAdmin && showProjectEditor && (
            <div className="admin-settings-panel" style={{ borderLeft: "3px solid #2c3e50" }}>
              <div className="admin-panel-title">📂 Project & Sub-project Manager</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
                <input
                  id="new-proj-name"
                  type="text"
                  placeholder="New project name"
                  style={{ flex: 1, padding: 4, borderRadius: 4, border: "1px solid #ccc", fontSize: "0.85em" }}
                />
                <button
                  className="btn-primary"
                  style={{ padding: "4px 10px", fontSize: "0.85em" }}
                  onClick={() => {
                    const el = document.getElementById("new-proj-name");
                    const name = el.value.trim();
                    if (name) { addProject(name); el.value = ""; }
                  }}
                >+ Add Project</button>
              </div>
              {projectTree.map((proj) => {
                const projGroups = proj.groupIds
                  .map((gId) => dynamicGroups.find((g) => g.id === gId))
                  .filter(Boolean);
                return (
                  <div key={proj.id} style={{ marginBottom: 10, padding: 6, background: "#f5f5f5", borderRadius: 6, border: "1px solid #e8e8e8" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                      <input
                        type="text" value={proj.name}
                        onChange={(e) => renameProject(proj.id, e.target.value)}
                        style={{ flex: 1, padding: 3, border: "1px solid #ccc", borderRadius: 3, fontWeight: 700, fontSize: "0.85em" }}
                      />
                      <button
                        onClick={() => { if (window.confirm(`Delete "${proj.name}"?`)) removeProject(proj.id); }}
                        style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontWeight: 800, fontSize: "1em" }}
                      >✕</button>
                    </div>
                    {projGroups.map((g) => (
                      <div key={g.id} style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: 12, marginBottom: 2 }}>
                        <span style={{ color: "#888", fontSize: "0.8em" }}>└</span>
                        <input
                          type="text" value={g.title}
                          onChange={(e) => renameSubproject(g.id, e.target.value)}
                          style={{ flex: 1, padding: 2, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.8em" }}
                        />
                        <button
                          onClick={() => removeSubproject(proj.id, g.id)}
                          style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: "0.85em", fontWeight: 800 }}
                        >✕</button>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 4, marginLeft: 12, marginTop: 4 }}>
                      <input
                        id={`add-sub-${proj.id}`} type="text" placeholder="New sub-project"
                        style={{ flex: 1, padding: 2, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.8em" }}
                      />
                      <button
                        onClick={() => {
                          const el = document.getElementById(`add-sub-${proj.id}`);
                          const t = el.value.trim();
                          if (t) { addSubproject(proj.id, t); el.value = ""; }
                        }}
                        style={{ padding: "2px 8px", fontSize: "0.78em", background: "#27ae60", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontWeight: 700 }}
                      >+ Sub</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* MILESTONE EDITOR PANEL */}
          {isAdmin && showMilestoneEditor && (
            <div className="admin-settings-panel" style={{ borderLeft: "3px solid #e67e22" }}>
              <div className="admin-panel-title">◆ Milestone Markers</div>
              <div style={{ fontSize: "0.8em", color: "#7f8c8d", marginBottom: 8 }}>
                Vertical timeline markers for key dates. Displayed independently from tasks/events.
              </div>

              {/* Add Milestone */}
              <div style={{ display: "flex", gap: 4, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  id="ms-new-title" type="text" placeholder="Milestone name"
                  style={{ flex: 2, minWidth: 100, padding: 4, borderRadius: 4, border: "1px solid #ccc", fontSize: "0.85em" }}
                />
                <input
                  id="ms-new-dt" type="datetime-local"
                  defaultValue={dayjs.utc().format("YYYY-MM-DDTHH:mm")}
                  style={{ flex: 2, minWidth: 140, padding: 4, borderRadius: 4, border: "1px solid #ccc", fontSize: "0.85em" }}
                />
                <input
                  id="ms-new-color" type="color" defaultValue="#e67e22"
                  style={{ width: 32, height: 28, padding: 0, border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" }}
                />
                <button
                  onClick={() => {
                    const title = document.getElementById("ms-new-title").value.trim();
                    const dt = document.getElementById("ms-new-dt").value;
                    const color = document.getElementById("ms-new-color").value;
                    if (title && dt) {
                      addMilestone(title, dayjs.utc(dt).toISOString(), color);
                      document.getElementById("ms-new-title").value = "";
                    }
                  }}
                  style={{ padding: "4px 10px", fontSize: "0.85em", background: "#e67e22", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 700 }}
                >+ Add</button>
              </div>

              {/* Milestone List */}
              {milestones.length === 0 && (
                <div style={{ fontSize: "0.8em", color: "#aaa", fontStyle: "italic" }}>No milestones defined.</div>
              )}
              {milestones.map((ms) => (
                <div key={ms.id} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4, padding: 4, background: "#f9f9f9", borderRadius: 4, border: "1px solid #eee" }}>
                  <input
                    type="color" value={ms.color || "#e67e22"}
                    onChange={(e) => updateMilestone(ms.id, { color: e.target.value })}
                    style={{ width: 24, height: 22, padding: 0, border: "none", cursor: "pointer", flexShrink: 0 }}
                  />
                  <input
                    type="text" value={ms.title}
                    onChange={(e) => updateMilestone(ms.id, { title: e.target.value })}
                    style={{ flex: 2, padding: 2, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.82em", fontWeight: 600 }}
                  />
                  <input
                    type="datetime-local"
                    value={dayjs.utc(ms.datetime).format("YYYY-MM-DDTHH:mm")}
                    onChange={(e) => updateMilestone(ms.id, { datetime: dayjs.utc(e.target.value).toISOString() })}
                    style={{ flex: 2, padding: 2, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.82em" }}
                  />
                  <button
                    onClick={() => removeMilestone(ms.id)}
                    style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontWeight: 800, fontSize: "1em", flexShrink: 0 }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          {/* INSTANT EVENTS EDITOR PANEL */}
          {isAdmin && showInstantEditor && (
            <div className="admin-settings-panel" style={{ borderLeft: "3px solid #555" }}>
              <div className="admin-panel-title">▲ Instant Events</div>
              <div style={{ fontSize: "0.8em", color: "#7f8c8d", marginBottom: 8 }}>
                Point markers on timeline rows — satellite passes, crossings, transitions.
              </div>

              {/* Add Instant Event */}
              <div style={{ display: "flex", gap: 4, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  id="ie-new-title" type="text" placeholder="Label (e.g. AN)"
                  style={{ flex: 1, minWidth: 60, padding: 4, borderRadius: 4, border: "1px solid #ccc", fontSize: "0.85em" }}
                />
                <input
                  id="ie-new-dt" type="datetime-local"
                  defaultValue={dayjs.utc().format("YYYY-MM-DDTHH:mm")}
                  style={{ flex: 2, minWidth: 130, padding: 4, borderRadius: 4, border: "1px solid #ccc", fontSize: "0.85em" }}
                />
                <select
                  id="ie-new-group"
                  style={{ flex: 1, minWidth: 80, padding: 4, borderRadius: 4, border: "1px solid #ccc", fontSize: "0.85em" }}
                >
                  {dynamicGroups.map((g) => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
                <select
                  id="ie-new-symbol"
                  style={{ width: 40, padding: 4, borderRadius: 4, border: "1px solid #ccc", fontSize: "1em", textAlign: "center" }}
                >
                  {INSTANT_SYMBOLS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <input
                  id="ie-new-color" type="color" defaultValue="#333333"
                  style={{ width: 28, height: 26, padding: 0, border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" }}
                />
                <button
                  onClick={() => {
                    const title = document.getElementById("ie-new-title").value.trim();
                    const dt = document.getElementById("ie-new-dt").value;
                    const gId = document.getElementById("ie-new-group").value;
                    const sym = document.getElementById("ie-new-symbol").value;
                    const color = document.getElementById("ie-new-color").value;
                    if (title && dt) {
                      addInstantEvent(title, dayjs.utc(dt).toISOString(), gId, sym, color);
                      document.getElementById("ie-new-title").value = "";
                    }
                  }}
                  style={{ padding: "4px 10px", fontSize: "0.85em", background: "#555", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 700 }}
                >+ Add</button>
              </div>

              {/* Instant Events List */}
              {instantEvents.length === 0 && (
                <div style={{ fontSize: "0.8em", color: "#aaa", fontStyle: "italic" }}>No instant events defined.</div>
              )}
              {instantEvents.map((ie) => (
                <div key={ie.id} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 3, padding: 4, background: "#f9f9f9", borderRadius: 4, border: "1px solid #eee" }}>
                  <select
                    value={ie.symbol || "▲"}
                    onChange={(e) => updateInstantEvent(ie.id, { symbol: e.target.value })}
                    style={{ width: 34, padding: 1, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.95em", textAlign: "center" }}
                  >
                    {INSTANT_SYMBOLS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <input
                    type="color" value={ie.color || "#333333"}
                    onChange={(e) => updateInstantEvent(ie.id, { color: e.target.value })}
                    style={{ width: 22, height: 20, padding: 0, border: "none", cursor: "pointer", flexShrink: 0 }}
                  />
                  <input
                    type="text" value={ie.title}
                    onChange={(e) => updateInstantEvent(ie.id, { title: e.target.value })}
                    style={{ flex: 1, padding: 2, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.82em", fontWeight: 600, minWidth: 40 }}
                  />
                  <select
                    value={ie.groupId}
                    onChange={(e) => updateInstantEvent(ie.id, { groupId: Number(e.target.value) })}
                    style={{ flex: 1, padding: 2, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.78em", minWidth: 70 }}
                  >
                    {dynamicGroups.map((g) => (
                      <option key={g.id} value={g.id}>{g.title}</option>
                    ))}
                  </select>
                  <input
                    type="datetime-local"
                    value={dayjs.utc(ie.datetime).format("YYYY-MM-DDTHH:mm")}
                    onChange={(e) => updateInstantEvent(ie.id, { datetime: dayjs.utc(e.target.value).toISOString() })}
                    style={{ flex: 2, padding: 2, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.78em", minWidth: 120 }}
                  />
                  <button
                    onClick={() => removeInstantEvent(ie.id)}
                    style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontWeight: 800, fontSize: "1em", flexShrink: 0 }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}

          <div className="timeline-scale-wrapper" ref={scaleWrapperRef} onScroll={handleScroll}>
            <div className="timeline-ruler" style={{ width: timelineWidth }}>
              {dateHeaders.map((dh, i) => (
                <div
                  key={i}
                  className="timeline-date-range-label"
                  style={{ left: dh.left, width: dh.width }}
                >
                  {dh.label}
                </div>
              ))}

              {ticks.map((t) => (
                <div
                  key={t.m}
                  className={"timeline-tick timeline-tick-" + t.kind}
                  style={{ left: t.left }}
                />
              ))}

              {hourLabels.map((h) => (
                <div
                  key={h.h}
                  className="timeline-hour-label"
                  style={{
                    left: h.left,
                    transform: "translateX(-50%)",
                    fontWeight: h.isMidnight ? "900" : "700",
                    color: "#111",
                  }}
                >
                  {h.label}
                </div>
              ))}

              {/* Milestone ticks on ruler */}
              {milestoneMarkers.map((ms) => {
                const isDragging = msDragState && msDragState.msId === ms.id;
                const displayLeft = isDragging && msDragState.dx !== undefined
                  ? msDragState.initialLeft + msDragState.dx
                  : ms.left;
                return (
                  <div
                    key={ms.id}
                    className="ruler-milestone-tick"
                    style={{ left: displayLeft, background: ms.color || "#e67e22" }}
                    title={`${ms.title} — ${ms.dt.format("MMM DD, HH:mm")}`}
                  >
                    ◆
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {!hasData && items.length === 0 ? (
        <div className="timeline-empty">
          No events found nearby {selectedDate.format("YYYY-MM-DD")}
        </div>
      ) : (
        <div className="timeline-body">
          <div
            className="timeline-sidebar"
            ref={sidebarBodyRef}
            onScroll={handleScroll}
          >
            {/* SPECIAL ROWS SIDEBAR LABELS */}
            {showElapsedRow && (
              <div className="sidebar-special-row" style={{ height: 36 }}>
                <span className="sidebar-special-label" style={{ color: "#e74c3c" }}>L Elapsed</span>
              </div>
            )}
            {instantEvents.length > 0 && (
              <div className="sidebar-special-row" style={{ height: 22 }}>
                <span className="sidebar-special-label" style={{ color: "#555" }}>▲ Instants</span>
              </div>
            )}

            {projectTree.map((proj) => {
              const isExpanded = !collapsedProjects.has(proj.id);
              const projGroups = proj.groupIds
                .map((gId) => dynamicGroups.find((g) => g.id === gId))
                .filter(Boolean);

              return (
                <div key={proj.id} className="sidebar-project-block">
                  <div
                    className="sidebar-project-header"
                    style={{ height: isExpanded ? projGroups.reduce((sum, g) => sum + getRowHeight(g.id), 0) : 28 }}
                    onClick={() => toggleProjectCollapse(proj.id)}
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    <span className="sidebar-collapse-icon">
                      {isExpanded ? "▼" : "▶"}
                    </span>
                    <span className="sidebar-project-name">{proj.name}</span>
                  </div>

                  {isExpanded && (
                    <div className="sidebar-subproject-col">
                      {projGroups.map((g) => (
                        <div
                          key={g.id}
                          className="sidebar-subproject-row"
                          style={{ height: getRowHeight(g.id) }}
                        >
                          {g.title}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="timeline-rows-wrapper" ref={rowsWrapperRef} onScroll={handleScroll}>
            <div className="timeline-rows" style={{ width: timelineWidth }}>
              <div className="timeline-gridlines">
                {majorGridlines.map((gl) => (
                  <div
                    key={gl.h}
                    className="timeline-gridline"
                    style={{
                      left: gl.left,
                      background: gl.isMidnight ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.06)",
                      width: gl.isMidnight ? "2px" : "1px",
                    }}
                  />
                ))}
              </div>

              {/* ELAPSED TIME ROW */}
              {showElapsedRow && (
                <div className="elapsed-time-row" style={{ width: timelineWidth, height: 36 }}>
                  {t0Left !== null && (
                    <div className="elapsed-t0-mark" style={{ left: t0Left }} />
                  )}
                  {elapsedLabels.map((el, i) => (
                    <div
                      key={i}
                      className={
                        "elapsed-label" +
                        (el.isZero ? " elapsed-t0" : el.value < 0 ? " elapsed-neg" : " elapsed-pos") +
                        (el.isDayBoundary && !el.isZero ? " elapsed-day-boundary" : "")
                      }
                      style={{ left: el.left }}
                    >
                      {el.isDayBoundary && (
                        <span className="elapsed-day-badge">
                          {el.dayNumber === 0 ? "D0" : el.dayNumber > 0 ? `D+${el.dayNumber}` : `D${el.dayNumber}`}
                        </span>
                      )}
                      <span className="elapsed-tick-line" />
                      <span className={"elapsed-text" + (el.isDayBoundary ? " elapsed-text-bold" : "")}>{el.label}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* INSTANT EVENTS ROW */}
              {instantEvents.length > 0 && (
                <div className="instant-events-row" style={{ width: timelineWidth, height: 22 }}>
                  {instantMarkers.map((ie) => {
                    const isDragging = ieDragState && ieDragState.ieId === ie.id;
                    let displayLeft = ie.left;
                    let dragLabel = null;
                    if (isDragging && ieDragState.dx !== undefined) {
                      displayLeft = ieDragState.initialLeft + ieDragState.dx;
                      const sMin = Math.round(displayLeft / minutePx / SNAP_MINUTES) * SNAP_MINUTES;
                      dragLabel = timelineStart.add(sMin, "minute").format("HH:mm");
                    }
                    return (
                      <div
                        key={ie.id}
                        className={"instant-event-marker" + (isAdmin ? " instant-draggable" : "")}
                        style={{
                          left: displayLeft,
                          color: ie.color || "#333",
                          cursor: isAdmin ? "ew-resize" : "default",
                        }}
                        title={`${ie.symbol || "▲"} ${ie.title} ${ie.dt.format("HH:mm")}`}
                        onMouseDown={(e) => handleIeMouseDown(e, ie)}
                      >
                        <span className="instant-symbol">{ie.symbol || "▲"}</span>
                        <span className="instant-label">{ie.title} {ie.dt.format("HH:mm")}</span>
                        {isDragging && dragLabel && (
                          <span className="instant-drag-time">{dragLabel}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {projectTree.map((proj) => {
                if (collapsedProjects.has(proj.id)) return null;
                const projGroups = proj.groupIds
                  .map((gId) => dynamicGroups.find((g) => g.id === gId))
                  .filter(Boolean);

                return projGroups.map((g) => (
                <div key={g.id} className="timeline-row" style={{ height: getRowHeight(g.id), "--lane-height": `${laneHeight}px` }}>
                  <div className="timeline-lane-lines">
                    {Array.from({ length: getLaneCount(g.id) - 1 }, (_, i) => (
                      <div key={i} className="timeline-lane-line" style={{ top: laneHeight * (i + 1) }} />
                    ))}
                  </div>

                  {materializedItems
                    .filter((it) => it.groupId === g.id && !it.invisible)
                    .map((it) => {
                      const start = dayjs.utc(it.start);
                      const end = dayjs.utc(it.end);

                      const baseLeft = it.startMin * minutePx;
                      const rawRight = it.endMin * minutePx;
                      const rawWidth = rawRight - baseLeft;

                      const lane = it.lane ?? 0;
                      const top = lane * laneHeight;

                      let effectiveLeft = baseLeft;
                      if (dragState && dragState.itemId === it.id) {
                        const previewLeft = dragState.initialLeft + dragState.dx;
                        const previewMin = Math.round(previewLeft / minutePx);
                        const snappedMin =
                          Math.round(previewMin / SNAP_MINUTES) * SNAP_MINUTES;
                        effectiveLeft = snappedMin * minutePx;
                      }

                      // --- MULTI-DAY CLIPPING ---
                      const clipLeft = effectiveLeft < 0;
                      const clipRight = (effectiveLeft + rawWidth) > timelineWidth;
                      const visLeft = clipLeft ? 0 : effectiveLeft;
                      const visRight = clipRight ? timelineWidth : (effectiveLeft + rawWidth);
                      const visWidth = Math.max(10, visRight - visLeft);

                      const isEventItem = it.kind === "event";

                      let bgColor;
                      if (!isEventItem && it.completed) bgColor = "#bdc3c7";
                      else if (it.urgent) bgColor = "#e74c3c";
                      else bgColor = it.color || (!it.movable ? "#777" : "#4f8df5");

                      const isConflict = conflictedIds.has(it.id);
                      const isMultiDayItem = it.isMultiDay || clipLeft || clipRight;

                      const itemStyle = {
                        width: "100%",
                        background: bgColor,
                        cursor: "pointer",
                        border: it.urgent ? "2px solid #c0392b" : "none",
                      };

                      // Clipped edge styling
                      if (clipLeft && clipRight) {
                        itemStyle.borderRadius = "0";
                      } else if (clipLeft) {
                        itemStyle.borderRadius = "0 4px 4px 0";
                      } else if (clipRight) {
                        itemStyle.borderRadius = "4px 0 0 4px";
                      }

                      // Event-specific visual overrides
                      if (isEventItem && !it.urgent) {
                        itemStyle.borderTop = `3px solid ${bgColor}`;
                        itemStyle.background = `repeating-linear-gradient(
                          -45deg,
                          ${bgColor},
                          ${bgColor} 4px,
                          ${bgColor}dd 4px,
                          ${bgColor}dd 8px
                        )`;
                        itemStyle.boxShadow = `inset 0 -1px 0 0 rgba(0,0,0,0.15)`;
                      }

                      // Multi-day time label
                      const timeLabel = isMultiDayItem
                        ? `${start.format("MMM DD HH:mm")} → ${end.format("MMM DD HH:mm")}`
                        : `${start.format("HH:mm")}–${end.format("HH:mm")}`;

                      return (
                        <div
                          key={it.id}
                          className={
                            "timeline-item-wrapper" +
                            (clipLeft ? " clip-left" : "") +
                            (clipRight ? " clip-right" : "")
                          }
                          style={{ left: visLeft, top, width: visWidth, height: laneHeight }}
                        >
                          <div
                            className={
                              "timeline-item" +
                              (isEventItem ? " timeline-item-event" : "") +
                              (!it.movable ? " timeline-item-locked" : "") +
                              (isConflict ? " timeline-item-conflict" : "") +
                              (isMultiDayItem ? " timeline-item-multiday" : "")
                            }
                            style={itemStyle}
                            title={`${isEventItem ? "[Event] " : "[Mission] "}${it.title}\n${timeLabel}`}
                            onClick={(e) => handleItemClick(e, it)}
                            onMouseDown={(e) => handleItemMouseDown(e, it, baseLeft, rawWidth)}
                          >
                            {/* Clip fade indicators */}
                            {clipLeft && <div className="clip-fade clip-fade-left" />}
                            {clipRight && <div className="clip-fade clip-fade-right" />}

                            {/* Kind Flag Badge */}
                            <span
                              className={
                                "timeline-item-flag" +
                                (isEventItem ? " flag-event" : " flag-mission")
                              }
                            >
                              {isEventItem ? "E" : "T"}
                            </span>

                            {/* Multi-day badge */}
                            {isMultiDayItem && (
                              <span className="timeline-item-multiday-badge">
                                📅
                              </span>
                            )}

                            <div className="timeline-item-title">
                              {it.urgent && "⚠️ "}
                              {it.title}
                            </div>
                            <div className="timeline-item-time">
                              {timeLabel}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              ));
              })}

              {/* MILESTONE MARKERS */}
              {milestoneMarkers.map((ms) => {
                const isDragging = msDragState && msDragState.msId === ms.id;
                let displayLeft = ms.left;
                let dragTimeLabel = null;

                if (isDragging && msDragState.dx !== undefined) {
                  displayLeft = msDragState.initialLeft + msDragState.dx;
                  const snappedMin = Math.round(displayLeft / minutePx / SNAP_MINUTES) * SNAP_MINUTES;
                  const previewDt = timelineStart.add(snappedMin, "minute");
                  dragTimeLabel = previewDt.format("MMM DD, HH:mm");
                }

                return (
                  <React.Fragment key={ms.id}>
                    <div
                      className="timeline-milestone-line"
                      style={{ left: displayLeft, borderColor: ms.color || "#e67e22", opacity: isDragging ? 0.5 : 0.85 }}
                    />
                    <div
                      className={"timeline-milestone-label" + (isAdmin ? " milestone-draggable" : "")}
                      style={{ left: displayLeft, background: ms.color || "#e67e22", cursor: isAdmin ? "ew-resize" : "default" }}
                      title={`${ms.title}\n${ms.dt.format("YYYY-MM-DD HH:mm")}`}
                      onMouseDown={(e) => handleMsMouseDown(e, ms)}
                    >
                      <span className="milestone-diamond">◆</span> {ms.title}
                    </div>
                    {isDragging && dragTimeLabel && (
                      <div
                        className="milestone-drag-preview"
                        style={{ left: displayLeft, background: ms.color || "#e67e22" }}
                      >
                        {dragTimeLabel}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}

              {/* T-0 LAUNCH LINE */}
              {showElapsedRow && t0Left !== null && (
                <>
                  <div className="timeline-t0-line" style={{ left: t0Left }} />
                  <div className="timeline-t0-bubble" style={{ left: t0Left }}>L</div>
                </>
              )}

              <div className="timeline-now-line" style={{ left: nowLeft }} />
              {nowLeft >= 0 && (
                <div className="timeline-now-bubble" style={{ left: nowLeft }}>
                  {clock}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectTimeline;