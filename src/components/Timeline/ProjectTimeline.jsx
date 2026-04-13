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
import customParseFormat from "dayjs/plugin/customParseFormat";

import groupsData from "../../data/groups";
import itemsByDate, { defaultCompletedIds, seedMilestones, seedInstantEvents, seedLaneCounts, seedLaneHeight } from "../../data/items";

import "./timeline.css";

import img1 from "../../assets/UZAY-Yatay.png";
import img2 from "../../assets/AYAP-1.png";
import favicon from "../../assets/AYAP-1.png";

dayjs.extend(weekOfYear);
dayjs.extend(utc);
dayjs.extend(customParseFormat);

// --- SETTINGS ---
const SIDEBAR_WIDTH = 240;
const SNAP_MINUTES = 5;

// --- APP BRANDING ---
const APP_TITLE = "TLM-1 Mission Timeline";
const APP_FAVICON = favicon;
const STORAGE_KEY_ITEMS = "TIMELINE_ITEMS_DB";
const STORAGE_KEY_LANE_COUNTS = "TIMELINE_LANE_COUNTS";
const STORAGE_KEY_LANE_HEIGHT = "TIMELINE_LANE_HEIGHT";
const STORAGE_KEY_PROJECTS = "TIMELINE_PROJECT_TREE";
const STORAGE_KEY_COLLAPSED = "TIMELINE_COLLAPSED_PROJECTS";
const STORAGE_KEY_GROUPS = "TIMELINE_DYNAMIC_GROUPS";
const STORAGE_KEY_MILESTONES = "TIMELINE_MILESTONES";
const STORAGE_KEY_INSTANTS = "TIMELINE_INSTANT_EVENTS";
const STORAGE_KEY_LAUNCH_TIME = "TIMELINE_LAUNCH_TIME";
const STORAGE_KEY_HIDDEN_PROJECTS = "TIMELINE_HIDDEN_PROJECTS";
const STORAGE_KEY_COUNTDOWN_IDS = "TIMELINE_COUNTDOWN_IDS";

const DEFAULT_LANE_COUNT = 1;
const DEFAULT_LANE_HEIGHT = 20;

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
    if (saved) { const p = JSON.parse(saved); if (p && typeof p === "object" && Object.keys(p).length > 0) return p; }
  } catch (e) { /* fallback */ }
  const seed = seedLaneCounts || {};
  if (Object.keys(seed).length > 0) {
    try { localStorage.setItem(STORAGE_KEY_LANE_COUNTS, JSON.stringify(seed)); } catch (e) {}
  }
  return seed;
}
function saveLaneCounts(obj) {
  try { localStorage.setItem(STORAGE_KEY_LANE_COUNTS, JSON.stringify(obj)); } catch (e) {}
}
function loadLaneHeight() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_LANE_HEIGHT);
    if (saved) { const v = Number(JSON.parse(saved)); if (v >= 20 && v <= 50) return v; }
  } catch (e) {}
  const seed = seedLaneHeight || DEFAULT_LANE_HEIGHT;
  try { localStorage.setItem(STORAGE_KEY_LANE_HEIGHT, JSON.stringify(seed)); } catch (e) {}
  return seed;
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

function loadHiddenProjects() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_HIDDEN_PROJECTS);
    if (saved) return new Set(JSON.parse(saved));
  } catch (e) {}
  return new Set();
}
function saveHiddenProjects(set) {
  try { localStorage.setItem(STORAGE_KEY_HIDDEN_PROJECTS, JSON.stringify([...set])); }
  catch (e) {}
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
  countdownIds = new Set(),
  onToggleCountdown,
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

    if (field === "priority") {
      if (value === "urgent") {
        const prev = task.priority === "urgent"
          ? task._prevColorBeforeUrgent
          : task.color || "#4f8df5";
        updates._prevColorBeforeUrgent = prev;
        updates.color = "#e74c3c";
        updates.urgent = true;
      } else {
        const restore = task._prevColorBeforeUrgent;
        if (restore) updates.color = restore;
        updates._prevColorBeforeUrgent = null;
        updates.urgent = false;
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
      if (task.priority === "urgent") {
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
                        .filter((t) => t.id !== task.id)
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
              color: (task.priority || "normal") === "urgent" ? "#c0392b" : (task.priority === "nice-to-have" ? "#27ae60" : "#7f8c8d"),
            }}
          >
            <strong>Priority:</strong> {(task.priority || "normal") === "urgent" ? "🔴 URGENT" : task.priority === "nice-to-have" ? "🟢 Nice to Have" : "🟡 Normal"}
          </div>

          {/* Category */}
          {task.category && (
            <div className="modal-row" style={{ fontSize: "0.85em", color: "#8e44ad" }}>
              <strong>Category:</strong> {task.category}
            </div>
          )}

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

              {/* Priority */}
              <div className="modal-row">
                <strong>Priority:</strong>
                <select
                  value={task.priority || "normal"}
                  onChange={(e) => handlePropChange("priority", e.target.value)}
                  style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc", fontSize: "0.85em", fontWeight: 700, color: (task.priority || "normal") === "urgent" ? "#c0392b" : task.priority === "nice-to-have" ? "#27ae60" : "#e67e22" }}
                >
                  <option value="urgent">🔴 Urgent</option>
                  <option value="normal">🟡 Normal</option>
                  <option value="nice-to-have">🟢 Nice to Have</option>
                </select>
              </div>

              {/* Category */}
              <div className="modal-row">
                <strong>Category:</strong>
                <input
                  type="text"
                  value={task.category || ""}
                  onChange={(e) => handlePropChange("category", e.target.value)}
                  placeholder="e.g. Pre-Launch, Comm, ADCS"
                  style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc", fontSize: "0.85em", flex: 1, maxWidth: 200 }}
                />
              </div>

              {/* Color Picker */}
              <div className="modal-row">
                <strong>{isEvent ? "Event" : "Task"} Color:</strong>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <input
                    type="color"
                    value={
                      (task.priority || "normal") === "urgent"
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
                    {(task.priority || "normal") === "urgent"
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

              {/* Countdown Toggle */}
              {onToggleCountdown && (
                <div className="modal-row" style={{ marginTop: 6 }}>
                  <strong>Countdown:</strong>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={countdownIds.has(task.id)}
                      onChange={() => onToggleCountdown(task.id)}
                      style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontSize: "0.85em", color: countdownIds.has(task.id) ? "#e74c3c" : "#888" }}>
                      {countdownIds.has(task.id) ? "⏱ Active — showing on screen" : "Show countdown timer"}
                    </span>
                  </label>
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
                    <span style={{ fontSize: "0.8em", color: "#e74c3c", fontWeight: 700 }}>Are you sure?</span>
                    <button
                      className="btn-secondary"
                      style={{ background: "#e74c3c", color: "#fff", fontSize: "0.8em", padding: "4px 10px" }}
                      onClick={() => { onDeleteItem(task.id); onClose(); }}
                    >
                      Yes, Delete
                    </button>
                    <button
                      className="btn-secondary"
                      style={{ fontSize: "0.8em", padding: "4px 10px" }}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn-secondary"
                    style={{ background: "#e74c3c22", color: "#e74c3c", border: "1px solid #e74c3c55" }}
                    onClick={() => setConfirmDelete(true)}
                    title="Permanently delete this item"
                  >
                    🗑 Delete
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

// ==========================================
// === INSTANT INFO MODAL ===================
// ==========================================
const InstantInfoModal = ({ instant, onClose, onUpdate, onDelete, isAdmin, countdownIds = new Set(), onToggleCountdown }) => {
  if (!instant) return null;
  const dt = dayjs.utc(instant.datetime);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ width: "min(480px, 92vw)", maxWidth: 480, maxHeight: "60vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ background: instant.kind === "task" ? "#27ae60" : "#e67e22", color: "#fff", padding: "10px 16px", borderRadius: "8px 8px 0 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "1.2em" }}>{instant.symbol || "▲"}</span>
            <div>
              <h3 style={{ margin: 0, fontSize: "1em" }}>{instant.title}</h3>
              <div style={{ fontSize: "0.75em", opacity: 0.85 }}>{instant.kind === "task" ? "Instant Task" : "Instant Event"} • {dt.format("DD MMM YYYY, HH:mm")} UTC</div>
            </div>
          </div>
          <button className="modal-close-btn" style={{ color: "#fff" }} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: "12px 16px" }}>
          {isAdmin ? (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 120px" }}>
                  <label className="create-field-label">Title</label>
                  <input type="text" value={instant.title} onChange={(e) => onUpdate(instant.id, { title: e.target.value })} className="create-field-input" />
                </div>
                <div style={{ flex: "0 0 160px" }}>
                  <label className="create-field-label">Date & Time (UTC)</label>
                  <input type="datetime-local" value={dt.format("YYYY-MM-DDTHH:mm")} onChange={(e) => { const v = e.target.value; if (v) onUpdate(instant.id, { datetime: dayjs.utc(v).toISOString() }); }} className="create-field-input" />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: "0 0 50px" }}>
                  <label className="create-field-label">Symbol</label>
                  <select value={instant.symbol || "▲"} onChange={(e) => onUpdate(instant.id, { symbol: e.target.value })} className="create-field-input" style={{ textAlign: "center" }}>
                    {["▲","▼","●","◆","■","★","△","▽","◇","○"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ flex: "0 0 40px" }}>
                  <label className="create-field-label">Color</label>
                  <input type="color" value={instant.color || "#333"} onChange={(e) => onUpdate(instant.id, { color: e.target.value })} style={{ width: 32, height: 26, border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" }} />
                </div>
                <div style={{ flex: "0 0 60px" }}>
                  <label className="create-field-label">Type</label>
                  <select value={instant.kind || "event"} onChange={(e) => onUpdate(instant.id, { kind: e.target.value })} className="create-field-input" style={{ fontSize: "0.82em" }}>
                    <option value="event">Event</option>
                    <option value="task">Task</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label className="create-field-label">Description</label>
                <textarea value={instant.description || ""} onChange={(e) => onUpdate(instant.id, { description: e.target.value })} placeholder="Add a description..." maxLength={500} className="create-field-input" style={{ minHeight: 60, resize: "vertical", fontFamily: "inherit", width: "100%", boxSizing: "border-box" }} />
              </div>
              {onToggleCountdown && (
                <div className="modal-row" style={{ marginTop: 2 }}>
                  <strong>Countdown:</strong>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input type="checkbox" checked={countdownIds.has(instant.id)} onChange={() => onToggleCountdown(instant.id)} style={{ width: 16, height: 16 }} />
                    <span style={{ fontSize: "0.85em", color: countdownIds.has(instant.id) ? "#e74c3c" : "#888" }}>
                      {countdownIds.has(instant.id) ? "⏱ Active — showing on screen" : "Show countdown timer"}
                    </span>
                  </label>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="modal-row" style={{ fontSize: "0.85em" }}>
                <strong>Time:</strong> {dt.format("DD MMM YYYY, HH:mm")} UTC
              </div>
              <div className="modal-row" style={{ fontSize: "0.85em" }}>
                <strong>Type:</strong> {instant.kind === "task" ? "Task" : "Event"}
              </div>
              {instant.description && (
                <div style={{ marginTop: 8, padding: 8, background: "#f9f9f9", borderRadius: 4, fontSize: "0.85em", color: "#444", whiteSpace: "pre-wrap" }}>{instant.description}</div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer" style={{ padding: "8px 16px", display: "flex", justifyContent: "space-between" }}>
          {isAdmin ? (
            <button onClick={() => { if (window.confirm(`Delete "${instant.title}"?`)) { onDelete(instant.id); onClose(); } }} style={{ background: "#e74c3c22", color: "#e74c3c", border: "1px solid #e74c3c55", padding: "4px 12px", borderRadius: 4, fontWeight: 700, cursor: "pointer", fontSize: "0.85em" }}>🗑 Delete</button>
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

  // --- APP BRANDING ---
  useEffect(() => {
    document.title = APP_TITLE;
    if (APP_FAVICON) {
      let link = document.querySelector("link[rel~='icon']");
      if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
      link.href = APP_FAVICON;
    }
  }, []);

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

  // --- TEST MODE: time offset (ms) from real system clock ---
  const [timeOffsetMs, setTimeOffsetMs] = useState(() => {
    try { const v = localStorage.getItem("TIMELINE_TIME_OFFSET"); return v ? Number(v) : 0; } catch(e) { return 0; }
  });
  const simNow = useCallback(() => dayjs.utc().add(timeOffsetMs, "millisecond"), [timeOffsetMs]);
  const isTestMode = timeOffsetMs !== 0;

  // --- DROPDOWN STATES ---
  const [statusModal, setStatusModal] = useState(false);
  const [statusTab, setStatusTab] = useState("all");
  const [statusCatFilter, setStatusCatFilter] = useState("all");
  const [statusPriFilter, setStatusPriFilter] = useState("all");

  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedInstant, setSelectedInstant] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calViewDate, setCalViewDate] = useState(() => dayjs.utc());

  useEffect(() => {
    if (!showCalendar) return;
    const close = (e) => {
      if (!e.target.closest(".cal-popup") && !e.target.closest(".cal-open-btn")) setShowCalendar(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showCalendar]);
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
  const [hiddenProjects, setHiddenProjects] = useState(() => loadHiddenProjects());

  // Unified panel system
  const [activePanel, setActivePanel] = useState(null); // null | "items" | "structure"
  const [activeTab, setActiveTab] = useState("tasks");

  const togglePanel = (panel, defaultTab) => {
    setActivePanel((prev) => {
      if (prev === panel) return null;
      setActiveTab(defaultTab);
      return panel;
    });
  };

  const toggleProjectVisibility = (projId) => {
    setHiddenProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projId)) next.delete(projId);
      else next.add(projId);
      saveHiddenProjects(next);
      return next;
    });
  };

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
      const next = prev.map((p) => {
        if (p.id !== projId) return p;
        const updated = { ...p, groupIds: p.groupIds.filter((gId) => gId !== groupId) };
        // Also remove from sections
        if (updated.sections) {
          updated.sections = updated.sections.map((s) => ({
            ...s, groupIds: s.groupIds.filter((gId) => gId !== groupId)
          })).filter((s) => s.groupIds.length > 0);
        }
        return updated;
      });
      saveProjectTree(next);
      return next;
    });
  };

  // --- SECTIONS (sub-sub-project grouping) ---
  const getOrderedGroups = (proj) => {
    if (!proj.sections || proj.sections.length === 0) return proj.groupIds;
    const sectionGids = proj.sections.flatMap((s) => s.groupIds);
    const ungrouped = proj.groupIds.filter((gId) => !sectionGids.includes(gId));
    return [...proj.sections.flatMap((s) => s.groupIds), ...ungrouped];
  };

  const addSection = (projId, name) => {
    setProjectTree((prev) => {
      const next = prev.map((p) => {
        if (p.id !== projId) return p;
        const sections = p.sections ? [...p.sections] : [];
        sections.push({ id: `sec-${Date.now()}`, name, groupIds: [] });
        return { ...p, sections };
      });
      saveProjectTree(next);
      return next;
    });
  };

  const removeSection = (projId, sectionId) => {
    setProjectTree((prev) => {
      const next = prev.map((p) => {
        if (p.id !== projId || !p.sections) return p;
        return { ...p, sections: p.sections.filter((s) => s.id !== sectionId) };
      });
      saveProjectTree(next);
      return next;
    });
  };

  const renameSection = (projId, sectionId, newName) => {
    setProjectTree((prev) => {
      const next = prev.map((p) => {
        if (p.id !== projId || !p.sections) return p;
        return { ...p, sections: p.sections.map((s) => s.id === sectionId ? { ...s, name: newName } : s) };
      });
      saveProjectTree(next);
      return next;
    });
  };

  const moveGroupToSection = (projId, groupId, sectionId) => {
    setProjectTree((prev) => {
      const next = prev.map((p) => {
        if (p.id !== projId) return p;
        let sections = p.sections ? p.sections.map((s) => ({
          ...s, groupIds: s.groupIds.filter((gId) => gId !== groupId)
        })) : [];
        if (sectionId) {
          sections = sections.map((s) => s.id === sectionId ? { ...s, groupIds: [...s.groupIds, groupId] } : s);
        }
        sections = sections.filter((s) => s.groupIds.length > 0 || s.name);
        return { ...p, sections };
      });
      saveProjectTree(next);
      return next;
    });
  };

  const addSubprojectToSection = (projId, sectionId, title) => {
    const newGid = Date.now();
    const newGroup = { id: newGid, title };
    setDynamicGroups((prev) => {
      const next = [...prev, newGroup];
      saveDynamicGroups(next);
      return next;
    });
    setProjectTree((prev) => {
      const next = prev.map((p) => {
        if (p.id !== projId) return p;
        const updated = { ...p, groupIds: [...p.groupIds, newGid] };
        if (sectionId && updated.sections) {
          updated.sections = updated.sections.map((s) =>
            s.id === sectionId ? { ...s, groupIds: [...s.groupIds, newGid] } : s
          );
        }
        return updated;
      });
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

  // --- MILESTONES ---
  const [milestones, setMilestones] = useState(() => loadMilestones());

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

  // --- LAUNCH TIME (T-0 for elapsed time row) ---
  const [launchTime, setLaunchTime] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_LAUNCH_TIME);
      if (saved) return saved;
    } catch (e) {}
    return null;
  });
  const [showElapsedRow, setShowElapsedRow] = useState(() => !!launchTime);
  const [launchElapsedStr, setLaunchElapsedStr] = useState(null);
  const [launchIsPast, setLaunchIsPast] = useState(false);

  // --- COUNTDOWN TIMERS ---
  const [countdownIds, setCountdownIds] = useState(() => {
    try { const s = localStorage.getItem(STORAGE_KEY_COUNTDOWN_IDS); return s ? new Set(JSON.parse(s)) : new Set(); } catch(e) { return new Set(); }
  });
  const [countdownDisplays, setCountdownDisplays] = useState([]);

  const toggleCountdown = (itemId) => {
    setCountdownIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      try { localStorage.setItem(STORAGE_KEY_COUNTDOWN_IDS, JSON.stringify([...next])); } catch(e) {}
      return next;
    });
  };

  const [fullscreenCountdownId, setFullscreenCountdownId] = useState(null);

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

  const addInstantEvent = (title, datetime, groupId, symbol, color, deps, kind, description) => {
    const newId = `ie-${Date.now()}`;
    setInstantEvents((prev) => {
      const next = [...prev, { id: newId, title, datetime, groupId: Number(groupId), symbol: symbol || "▲", color: color || "#333333", dependencies: deps || [], kind: kind || "event", description: description || "" }];
      saveInstantEvents(next);
      return next;
    });
    return newId;
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
      hiddenProjects: [...hiddenProjects],
      customImg1: customImg1 || null,
      customImg2: customImg2 || null,
      instantEvents,
      launchTime: launchTime || null,
      countdownIds: [...countdownIds],
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timeline-export-${dayjs().format("YYYY-MM-DD-HHmm")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [masterItems, completedIds, milestones, laneCounts, laneHeight, dynamicGroups, projectTree, collapsedProjects, hiddenProjects, customImg1, customImg2, instantEvents, launchTime, countdownIds]);

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
          if (data._format !== "TLM-1 Test") {
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
          // Restore hidden projects
          if (Array.isArray(data.hiddenProjects)) {
            const set = new Set(data.hiddenProjects);
            setHiddenProjects(set);
            saveHiddenProjects(set);
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
          // Restore countdown IDs
          if (Array.isArray(data.countdownIds)) {
            const set = new Set(data.countdownIds);
            setCountdownIds(set);
            try { localStorage.setItem(STORAGE_KEY_COUNTDOWN_IDS, JSON.stringify(data.countdownIds)); } catch(e) {}
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
          urgent: (it.priority || (it.urgent ? "urgent" : "normal")) === "urgent",
          priority: it.priority || (it.urgent ? "urgent" : "normal"),
          category: it.category || "",
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
  const allItemsStatus = useMemo(() => {
    const now = simNow();
    const tasks = masterItems
      .filter((i) => !i.invisible && (i.kind || "task") !== "event")
      .map((i) => {
        const group = dynamicGroups.find((g) => g.id === i.groupId);
        const absStart = dayjs.utc(i.absStart);
        const absEnd = dayjs.utc(i.absEnd);
        const isComp = completedIds.includes(i.id);
        const isOverdue = !isComp && absEnd.isBefore(now);
        const isActive = !isComp && absStart.isBefore(now) && absEnd.isAfter(now);
        const status = isComp ? "completed" : isOverdue ? "overdue" : isActive ? "active" : "upcoming";
        return {
          ...i,
          kind: "task",
          itemType: "task",
          completed: isComp,
          groupName: group ? group.title : i.groupId,
          absStart,
          absEnd,
          status,
        };
      });
    const instants = instantEvents
      .filter((ie) => ie.kind === "task")
      .map((ie) => {
        const dt = dayjs.utc(ie.datetime);
        const isPast = dt.isBefore(now);
        return {
          ...ie,
          kind: "task",
          itemType: "instant",
          completed: false,
          groupName: "",
          absStart: dt,
          absEnd: dt,
          status: isPast ? "overdue" : "upcoming",
          title: ie.title,
          priority: ie.priority || "normal",
          category: ie.category || "",
          symbol: ie.symbol || "▲",
        };
      });
    return [...tasks, ...instants].sort((a, b) => a.absStart.valueOf() - b.absStart.valueOf());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterItems, completedIds, dynamicGroups, simNow, clock, instantEvents]);

  const statusCounts = useMemo(() => {
    const c = { all: 0, completed: 0, overdue: 0, active: 0, upcoming: 0 };
    allItemsStatus.forEach((t) => { c[t.status]++; c.all++; });
    return c;
  }, [allItemsStatus]);


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
      const now = simNow();
      setClock(now.format("HH:mm:ss"));

      // Update L+ elapsed timer
      if (launchTime) {
        const t0 = dayjs.utc(launchTime);
        if (t0.isValid()) {
          const totalSec = Math.abs(now.diff(t0, "second"));
          const isPast = now.isAfter(t0);
          const d = Math.floor(totalSec / 86400);
          const h = Math.floor((totalSec % 86400) / 3600);
          const m = Math.floor((totalSec % 3600) / 60);
          const s = totalSec % 60;
          const prefix = isPast ? "L +" : "L -";
          const parts = [];
          if (d > 0) parts.push(`${d}d`);
          parts.push(`${String(h).padStart(2, "0")}h`);
          parts.push(`${String(m).padStart(2, "0")}m`);
          parts.push(`${String(s).padStart(2, "0")}s`);
          setLaunchElapsedStr(`${prefix} ${parts.join(" ")}`);
          setLaunchIsPast(isPast);
        } else { setLaunchElapsedStr(null); }
      } else { setLaunchElapsedStr(null); }

      // Update countdown timers
      if (countdownIds.size > 0) {
        const displays = [];
        masterItems.forEach((it) => {
          if (!countdownIds.has(it.id)) return;
          const target = dayjs.utc(it.absStart);
          if (!target.isValid()) return;
          const totalSec = Math.abs(now.diff(target, "second"));
          const isPast = now.isAfter(target);
          const d = Math.floor(totalSec / 86400);
          const h = Math.floor((totalSec % 86400) / 3600);
          const m = Math.floor((totalSec % 3600) / 60);
          const s = totalSec % 60;
          const parts = [];
          if (d > 0) parts.push(`${d} day`);
          parts.push(`${String(h).padStart(2, "0")} hour`);
          parts.push(`${String(m).padStart(2, "0")} minute`);
          parts.push(`${String(s).padStart(2, "0")} second`);
          displays.push({ id: it.id, title: it.title, timeStr: parts.join(" "), isPast });
        });
        instantEvents.forEach((ie) => {
          if (!countdownIds.has(ie.id)) return;
          const target = dayjs.utc(ie.datetime);
          if (!target.isValid()) return;
          const totalSec = Math.abs(now.diff(target, "second"));
          const isPast = now.isAfter(target);
          const d = Math.floor(totalSec / 86400);
          const h = Math.floor((totalSec % 86400) / 3600);
          const m = Math.floor((totalSec % 3600) / 60);
          const s = totalSec % 60;
          const parts = [];
          if (d > 0) parts.push(`${d} day`);
          parts.push(`${String(h).padStart(2, "0")} hour`);
          parts.push(`${String(m).padStart(2, "0")} minute`);
          parts.push(`${String(s).padStart(2, "0")} second`);
          displays.push({ id: ie.id, title: ie.title, timeStr: parts.join(" "), isPast });
        });
        setCountdownDisplays(displays);
      } else { setCountdownDisplays([]); }

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
  }, [timelineStart, timelineEnd, minutePx, viewportWidth, isLocked, launchTime, countdownIds, masterItems, instantEvents, simNow]);

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

    let capturedShift = 0;

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
      capturedShift = shiftAmount;

      let finalItems;
      // Build map of shifts already applied by pushWithinSameLane
      const pushShifts = new Map();
      pushed.nextItems.forEach((item) => {
        const orig = prev.find((p) => p.id === item.id);
        if (orig && item.id !== dragState.itemId && orig.startMin !== item.startMin) {
          pushShifts.set(item.id, item.startMin - orig.startMin);
        }
      });
      finalItems = moveDependentItems(pushed.nextItems, dragState.itemId, shiftAmount, totalMinutes, pushShifts);

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

    // Shift dependent instant events
    if (capturedShift !== 0) {
      const shiftMins = capturedShift;
      setInstantEvents((prev) => {
        let changed = false;
        const next = prev.map((ie) => {
          if (ie.dependencies && ie.dependencies.includes(dragState.itemId)) {
            changed = true;
            const dt = dayjs.utc(ie.datetime).add(shiftMins, "minute");
            return { ...ie, datetime: dt.toISOString() };
          }
          return ie;
        });
        if (changed) saveInstantEvents(next);
        return changed ? next : prev;
      });
    }

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
    if (ie.kind === "event" || !ie.kind) return; // Only instant tasks are draggable
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

  const hasData = items.length > 0;

  const handleResumeLive = () => {
    setIsLocked(true);
    setSelectedDate(simNow());
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
          countdownIds={countdownIds}
          onToggleCountdown={toggleCountdown}
        />
      )}

      {selectedInstant && (
        <InstantInfoModal
          instant={selectedInstant}
          onClose={() => setSelectedInstant(null)}
          onUpdate={(id, updates) => { updateInstantEvent(id, updates); setSelectedInstant((prev) => prev ? { ...prev, ...updates } : null); }}
          onDelete={(id) => { removeInstantEvent(id); setSelectedInstant(null); }}
          isAdmin={isAdmin}
          countdownIds={countdownIds}
          onToggleCountdown={toggleCountdown}
        />
      )}

      {/* Create panels are now inline tabs in Items panel */}

      {/* STATUS DETAIL MODAL */}
      {statusModal && (() => {
        const tabMeta = {
          all: { label: "All", icon: "📊", color: "#2c3e50" },
          completed: { label: "Completed", icon: "✅", color: "#27ae60" },
          overdue: { label: "Overdue", icon: "🔴", color: "#e74c3c" },
          active: { label: "Active", icon: "🔵", color: "#2980b9" },
          upcoming: { label: "Upcoming", icon: "⚪", color: "#7f8c8d" },
        };
        const filtered = allItemsStatus.filter((t) => {
          if (statusTab !== "all" && t.status !== statusTab) return false;
          if (statusCatFilter !== "all" && (t.category || "") !== statusCatFilter) return false;
          if (statusPriFilter !== "all") { const p = t.priority || (t.urgent ? "urgent" : "normal"); if (p !== statusPriFilter) return false; }
          return true;
        });
        const categories = [...new Set(allItemsStatus.map((t) => t.category || "").filter(Boolean))];
        const filteredCounts = { all: 0, completed: 0, overdue: 0, active: 0, upcoming: 0 };
        allItemsStatus.forEach((t) => {
          const p = t.priority || (t.urgent ? "urgent" : "normal");
          if (statusPriFilter !== "all" && p !== statusPriFilter) return;
          if (statusCatFilter !== "all" && (t.category || "") !== statusCatFilter) return;
          filteredCounts[t.status]++;
          filteredCounts.all++;
        });
        const cur = tabMeta[statusTab];
        return (
          <div className="modal-overlay" onClick={() => setStatusModal(false)}>
            <div className="modal-content" style={{ width: "min(650px, 94vw)", maxWidth: 650 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ background: cur.color, color: "#fff", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: "8px 8px 0 0" }}>
                <h3 style={{ margin: 0, fontSize: "1.1em" }}>{cur.icon} Mission Status ({filteredCounts.all})</h3>
                <button className="modal-close-btn" style={{ color: "#fff" }} onClick={() => setStatusModal(false)}>✕</button>
              </div>
              <div style={{ display: "flex", gap: 0, borderBottom: "2px solid #e0e0e0", background: "#f5f5f5" }}>
                {["all", "completed", "overdue", "active", "upcoming"].map((tab) => {
                  const m = tabMeta[tab];
                  const isActive = statusTab === tab;
                  return (
                    <button key={tab} onClick={() => setStatusTab(tab)} style={{
                      flex: 1, padding: "8px 4px", border: "none", borderBottom: isActive ? `3px solid ${m.color}` : "3px solid transparent",
                      background: isActive ? "#fff" : "transparent", cursor: "pointer",
                      fontSize: "0.78em", fontWeight: 700, color: isActive ? m.color : "#888",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
                    }}>
                      <span>{m.icon} {m.label}</span>
                      <span style={{ fontSize: "0.85em", opacity: 0.7 }}>{filteredCounts[tab]}</span>
                    </button>
                  );
                })}
              </div>
              {(categories.length > 0 || true) && (
                <div style={{ display: "flex", gap: 8, padding: "8px 16px", background: "#fafafa", borderBottom: "1px solid #eee", alignItems: "center", flexWrap: "wrap" }}>
                  <select value={statusPriFilter} onChange={(e) => setStatusPriFilter(e.target.value)} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid #ccc", fontSize: "0.8em" }}>
                    <option value="all">All Priorities</option>
                    <option value="urgent">🔴 Urgent</option>
                    <option value="normal">🟡 Normal</option>
                    <option value="nice-to-have">🟢 Nice to Have</option>
                  </select>
                  {categories.length > 0 && (
                    <select value={statusCatFilter} onChange={(e) => setStatusCatFilter(e.target.value)} style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid #ccc", fontSize: "0.8em" }}>
                      <option value="all">All Categories</option>
                      {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                  <span style={{ fontSize: "0.75em", color: "#999", marginLeft: "auto" }}>{filtered.length} items</span>
                </div>
              )}
              <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: 20, textAlign: "center", color: "#999" }}>No items</div>
                ) : (
                  filtered.map((t) => {
                    const sm = tabMeta[t.status];
                    const pri = t.priority || (t.urgent ? "urgent" : "normal");
                    const priIcon = pri === "urgent" ? "🔴" : pri === "nice-to-have" ? "🟢" : "🟡";
                    return (
                      <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", borderBottom: "1px solid #f0f0f0", cursor: "pointer" }}
                        onClick={() => {
                          if (t.itemType === "instant") {
                            const orig = instantEvents.find((x) => x.id === t.id);
                            if (orig) setSelectedInstant(orig);
                            setStatusModal(false);
                          } else {
                            handleJumpToTask(t); setStatusModal(false);
                          }
                        }}>
                        <span style={{ fontSize: "0.85em" }}>{t.itemType === "instant" ? <span style={{ color: t.color || "#333" }}>{t.symbol || "▲"}</span> : priIcon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontWeight: 700, fontSize: "0.85em", color: sm.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
                            <span style={{ fontSize: "0.6em", fontWeight: 800, padding: "1px 5px", borderRadius: 3, background: sm.color + "18", color: sm.color, flexShrink: 0 }}>{sm.label.toUpperCase()}</span>
                            <span style={{ fontSize: "0.65em", color: "#aaa", flexShrink: 0 }}>{t.itemType === "instant" ? "Instant Task" : "Task"}</span>
                          </div>
                          <div style={{ fontSize: "0.75em", color: "#888" }}>
                            {t.itemType === "instant" ? t.absStart.format("MMM DD, HH:mm") : `${t.absStart.format("MMM DD, HH:mm")} → ${t.absEnd.format("HH:mm")}`}
                            {t.category && <span style={{ marginLeft: 8, color: "#8e44ad", fontWeight: 600 }}>#{t.category}</span>}
                            {t.groupName && <span style={{ marginLeft: 8, color: "#666" }}>• {typeof t.groupName === "string" ? t.groupName : ""}</span>}
                          </div>
                        </div>
                        <span style={{ fontSize: "0.7em", color: "#bbb", flexShrink: 0 }}>#{t.id}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
        </div>
        <div className="timeline-header-main">
          <div className="timeline-date-header">
            {/* LOGIN - far left */}
            {!isAdmin ? (
              <button
                onClick={() => { setShowLoginModal(true); setLoginError(""); }}
                style={{
                  background: "transparent",
                  color: "#888",
                  border: "1px solid #ccc",
                  padding: "3px 8px",
                  borderRadius: "50%",
                  cursor: "pointer",
                  fontSize: "1rem",
                  lineHeight: 1,
                  width: 28, height: 28,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}
                title="Admin Login"
              >👤</button>
            ) : (
              <button
                onClick={() => setIsAdmin(false)}
                style={{
                  background: "#e74c3c",
                  color: "#fff",
                  border: "none",
                  padding: "3px 8px",
                  borderRadius: "50%",
                  cursor: "pointer",
                  fontSize: "1rem",
                  lineHeight: 1,
                  width: 28, height: 28,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}
                title="Logout (switch to User)"
              >👤</button>
            )}

            <span className="timeline-date-spacer" />

            <div className="timeline-controls">

              {/* STATUS BUTTON */}
              <div
                className="timeline-header-actions"
                style={{ marginRight: 15, display: "flex", gap: 10 }}
              >
                <button
                  className="status-dropdown-btn"
                  onClick={() => { setStatusModal(true); setStatusTab("all"); setStatusCatFilter("all"); setStatusPriFilter("all"); }}
                  style={{
                    background: "#2c3e5022",
                    color: "#2c3e50",
                    border: "1px solid #2c3e5055", padding: "6px 16px", borderRadius: "6px",
                    cursor: "pointer", fontWeight: "bold", fontSize: "1em",
                  }}
                >
                  <span>📊 Mission Status</span>
                  <span className="status-dropdown-count" style={{ background: "#2c3e5033", color: "#2c3e50" }}>{statusCounts.all}</span>
                </button>
              </div>

              {isAdmin && (
                <>
                  <button
                    onClick={() => togglePanel("items", "tasks")}
                    style={{
                      marginRight: 4,
                      background: activePanel === "items" ? "#27ae60" : "#27ae6022",
                      color: activePanel === "items" ? "#fff" : "#27ae60",
                      border: "1px solid #27ae6055", padding: "6px 16px", borderRadius: "6px",
                      cursor: "pointer", fontWeight: "bold", fontSize: "1em",
                    }}
                    title="Tasks, Events, Instants, Milestones"
                  >+ Items</button>

                  <button
                    onClick={() => togglePanel("settings", "projects")}
                    style={{
                      marginRight: 4,
                      background: activePanel === "settings" ? "#7f8c8d" : "#7f8c8d22",
                      color: activePanel === "settings" ? "#fff" : "#7f8c8d",
                      border: "1px solid #7f8c8d55", padding: "6px 16px", borderRadius: "6px",
                      cursor: "pointer", fontWeight: "bold", fontSize: "1em",
                    }}
                    title="Settings, Structure, Import/Export"
                  >⚙ Settings</button>
                </>
              )}

              <div className="timeline-live-status">
                <span className="timeline-live-clock">{clock} UTC+0</span>
                {launchElapsedStr && (
                  <span className={"timeline-launch-elapsed" + (launchIsPast ? " launch-past" : " launch-future")}>{launchElapsedStr}</span>
                )}
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
                const isToday = d.isSame(simNow(), "day");

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

            <div className="timeline-date-picker-wrapper" style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                <button
                  className="cal-open-btn"
                  onClick={() => { setShowCalendar((v) => !v); setCalViewDate(selectedDate); }}
                  style={{ background: "none", border: "1px solid #ccc", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontSize: "12px", fontWeight: 700, lineHeight: 1.4, color: "#333", whiteSpace: "nowrap" }}
                  title="Open calendar"
                >
                  {selectedDate.format("DD.MM.YYYY")} 📅
                </button>
              </div>
              {showCalendar && (
                <div className="cal-popup" onClick={(e) => e.stopPropagation()}>
                  <div className="cal-header">
                    <button className="cal-nav" onClick={() => setCalViewDate((d) => d.subtract(1, "year"))}>«</button>
                    <button className="cal-nav" onClick={() => setCalViewDate((d) => d.subtract(1, "month"))}>‹</button>
                    <div className="cal-title">
                      <select value={calViewDate.month()} onChange={(e) => setCalViewDate((d) => d.month(Number(e.target.value)))} className="cal-select">
                        {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
                          <option key={i} value={i}>{m}</option>
                        ))}
                      </select>
                      <input type="number" value={calViewDate.year()} min={2020} max={2099}
                        onChange={(e) => { const y = Number(e.target.value); if (y >= 2020 && y <= 2099) setCalViewDate((d) => d.year(y)); }}
                        className="cal-year-input"
                      />
                    </div>
                    <button className="cal-nav" onClick={() => setCalViewDate((d) => d.add(1, "month"))}>›</button>
                    <button className="cal-nav" onClick={() => setCalViewDate((d) => d.add(1, "year"))}>»</button>
                  </div>
                  <div className="cal-grid">
                    {["Mo","Tu","We","Th","Fr","Sa","Su"].map((d) => (
                      <div key={d} className="cal-day-header">{d}</div>
                    ))}
                    {(() => {
                      const first = calViewDate.startOf("month");
                      const startDay = (first.day() + 6) % 7;
                      const daysInMonth = calViewDate.daysInMonth();
                      const cells = [];
                      for (let i = 0; i < startDay; i++) cells.push(<div key={`e${i}`} className="cal-cell cal-empty" />);
                      for (let d = 1; d <= daysInMonth; d++) {
                        const cellDate = calViewDate.date(d);
                        const isSel = cellDate.isSame(selectedDate, "day");
                        const isNow = cellDate.isSame(simNow(), "day");
                        cells.push(
                          <div key={d}
                            className={"cal-cell" + (isSel ? " cal-selected" : "") + (isNow ? " cal-today" : "")}
                            onClick={() => { setIsLocked(false); setSelectedDate(cellDate); setShowCalendar(false); }}
                          >{d}</div>
                        );
                      }
                      return cells;
                    })()}
                  </div>
                  <div className="cal-footer">
                    <button className="cal-today-btn" onClick={() => { const t = simNow(); setCalViewDate(t); setIsLocked(false); setSelectedDate(t); setShowCalendar(false); }}>Today</button>
                  </div>
                </div>
              )}
            </div>

            {!isLocked && (
              <button className="timeline-recenter-btn" onClick={handleResumeLive}>
                RESUME LIVE
              </button>
            )}

            <div style={{ flex: 1 }} />

            {/* ZOOM (far right) */}
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
          </div>
          <div className="timeline-header-spacer" />

          {/* ========== SETTINGS PANEL (Projects + Lanes + Launch + Data) ========== */}
          {isAdmin && activePanel === "settings" && (
            <div className="admin-settings-panel admin-tabbed-panel">
              <div className="admin-tab-bar">
                <button className={"admin-tab" + (activeTab === "projects" ? " admin-tab-active" : "")} onClick={() => setActiveTab("projects")}>📂 Projects</button>
                <button className={"admin-tab" + (activeTab === "lanes" ? " admin-tab-active" : "")} onClick={() => setActiveTab("lanes")}>⚙ Lanes</button>
                <button className={"admin-tab" + (activeTab === "launch" ? " admin-tab-active" : "")} style={{ "--tab-color": "#e74c3c" }} onClick={() => setActiveTab("launch")}>🚀 Launch</button>
                <button className={"admin-tab" + (activeTab === "data" ? " admin-tab-active" : "")} style={{ "--tab-color": "#16a085" }} onClick={() => setActiveTab("data")}>💾 Data</button>
                <button className={"admin-tab" + (activeTab === "test" ? " admin-tab-active" : "")} style={{ "--tab-color": isTestMode ? "#e74c3c" : "#8e44ad" }} onClick={() => setActiveTab("test")}>{isTestMode ? "🧪 TEST ON" : "🧪 Test"}</button>
              </div>
              <div className="admin-tab-content">
                {activeTab === "projects" && (<>
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
                const sections = proj.sections || [];
                const sectionGids = sections.flatMap((s) => s.groupIds);
                const ungroupedGroups = projGroups.filter((g) => !sectionGids.includes(g.id));

                return (
                  <div key={proj.id} style={{ marginBottom: 10, padding: 6, background: "#f5f5f5", borderRadius: 6, border: "1px solid #e8e8e8" }}>
                    {/* Project header */}
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                      <button
                        onClick={() => toggleProjectVisibility(proj.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1em", padding: 0, opacity: hiddenProjects.has(proj.id) ? 0.4 : 1 }}
                        title={hiddenProjects.has(proj.id) ? "Show project" : "Hide project"}
                      >{hiddenProjects.has(proj.id) ? "👁‍🗨" : "👁"}</button>
                      <input
                        type="text" value={proj.name}
                        onChange={(e) => renameProject(proj.id, e.target.value)}
                        style={{ flex: 1, padding: 3, border: "1px solid #ccc", borderRadius: 3, fontWeight: 700, fontSize: "0.85em", opacity: hiddenProjects.has(proj.id) ? 0.5 : 1 }}
                      />
                      <button
                        onClick={() => { if (window.confirm(`Delete "${proj.name}"?`)) removeProject(proj.id); }}
                        style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontWeight: 800, fontSize: "1em" }}
                      >✕</button>
                    </div>

                    {/* Sections */}
                    {sections.map((sec) => {
                      const secGroups = sec.groupIds.map((gId) => dynamicGroups.find((g) => g.id === gId)).filter(Boolean);
                      return (
                        <div key={sec.id} style={{ marginLeft: 8, marginBottom: 4, padding: 4, background: "#eef2f5", borderRadius: 4, border: "1px solid #dce3e8" }}>
                          <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 2 }}>
                            <span style={{ color: "#2c3e50", fontSize: "0.75em", fontWeight: 800 }}>▸</span>
                            <input
                              type="text" value={sec.name}
                              onChange={(e) => renameSection(proj.id, sec.id, e.target.value)}
                              style={{ flex: 1, padding: 2, border: "1px solid #c8d0d8", borderRadius: 3, fontSize: "0.8em", fontWeight: 700, background: "#fff" }}
                            />
                            <button
                              onClick={() => { if (window.confirm(`Delete section "${sec.name}"? Sub-projects will become ungrouped.`)) removeSection(proj.id, sec.id); }}
                              style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: "0.8em", fontWeight: 800 }}
                            >✕</button>
                          </div>
                          {secGroups.map((g) => (
                            <div key={g.id} style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: 16, marginBottom: 2 }}>
                              <span style={{ color: "#aaa", fontSize: "0.75em" }}>└</span>
                              <input type="text" value={g.title} onChange={(e) => renameSubproject(g.id, e.target.value)}
                                style={{ flex: 1, padding: 2, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.78em" }} />
                              <select value={sec.id} onChange={(e) => moveGroupToSection(proj.id, g.id, e.target.value || null)}
                                style={{ width: 60, padding: 1, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.7em", color: "#888" }}
                                title="Move to section">
                                <option value="">— None</option>
                                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                              </select>
                              <button onClick={() => removeSubproject(proj.id, g.id)}
                                style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: "0.8em", fontWeight: 800 }}>✕</button>
                            </div>
                          ))}
                          <div style={{ display: "flex", gap: 4, marginLeft: 16, marginTop: 2 }}>
                            <input id={`add-secsub-${sec.id}`} type="text" placeholder="New sub-project"
                              style={{ flex: 1, padding: 2, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.78em" }} />
                            <button onClick={() => { const el = document.getElementById(`add-secsub-${sec.id}`); const t = el.value.trim(); if (t) { addSubprojectToSection(proj.id, sec.id, t); el.value = ""; } }}
                              style={{ padding: "2px 6px", fontSize: "0.72em", background: "#27ae60", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontWeight: 700 }}>+ Sub</button>
                          </div>
                        </div>
                      );
                    })}

                    {/* Ungrouped sub-projects */}
                    {ungroupedGroups.map((g) => (
                      <div key={g.id} style={{ display: "flex", gap: 4, alignItems: "center", marginLeft: 12, marginBottom: 2 }}>
                        <span style={{ color: "#888", fontSize: "0.8em" }}>└</span>
                        <input type="text" value={g.title} onChange={(e) => renameSubproject(g.id, e.target.value)}
                          style={{ flex: 1, padding: 2, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.8em" }} />
                        {sections.length > 0 && (
                          <select value="" onChange={(e) => { if (e.target.value) moveGroupToSection(proj.id, g.id, e.target.value); }}
                            style={{ width: 60, padding: 1, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.7em", color: "#888" }}
                            title="Move to section">
                            <option value="">— Move</option>
                            {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        )}
                        <button onClick={() => removeSubproject(proj.id, g.id)}
                          style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: "0.85em", fontWeight: 800 }}>✕</button>
                      </div>
                    ))}

                    {/* Add sub-project */}
                    <div style={{ display: "flex", gap: 4, marginLeft: 12, marginTop: 4 }}>
                      <input id={`add-sub-${proj.id}`} type="text" placeholder="New sub-project"
                        style={{ flex: 1, padding: 2, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.8em" }} />
                      <button onClick={() => { const el = document.getElementById(`add-sub-${proj.id}`); const t = el.value.trim(); if (t) { addSubproject(proj.id, t); el.value = ""; } }}
                        style={{ padding: "2px 8px", fontSize: "0.78em", background: "#27ae60", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontWeight: 700 }}>+ Sub</button>
                    </div>
                    {/* Add section */}
                    <div style={{ display: "flex", gap: 4, marginLeft: 12, marginTop: 2 }}>
                      <input id={`add-sec-${proj.id}`} type="text" placeholder="New section"
                        style={{ flex: 1, padding: 2, border: "1px solid #c8d0d8", borderRadius: 3, fontSize: "0.8em" }} />
                      <button onClick={() => { const el = document.getElementById(`add-sec-${proj.id}`); const name = el.value.trim(); if (name) { addSection(proj.id, name); el.value = ""; } }}
                        style={{ padding: "2px 8px", fontSize: "0.78em", background: "#2c3e50", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontWeight: 700 }}>+ Section</button>
                    </div>
                  </div>
                );
              })}
                </>)}
                {activeTab === "lanes" && (<>
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
                </>)}
                {activeTab === "launch" && (<>
                  <div style={{ fontSize: "0.8em", color: "#7f8c8d", marginBottom: 8 }}>
                    Set the launch (L-0) date/time for elapsed time calculations.
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 200px" }}>
                      <label className="create-field-label">Launch Date & Time (UTC)</label>
                      <input
                        type="datetime-local"
                        value={launchTime ? dayjs.utc(launchTime).format("YYYY-MM-DDTHH:mm") : ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v) updateLaunchTime(dayjs.utc(v).toISOString());
                          else updateLaunchTime(null);
                        }}
                        className="create-field-input"
                      />
                    </div>
                    {launchTime && (
                      <button
                        onClick={() => updateLaunchTime(null)}
                        style={{ padding: "6px 12px", background: "#e74c3c", color: "#fff", border: "none", borderRadius: 4, fontWeight: 700, cursor: "pointer", height: 32 }}
                      >Clear Launch Time</button>
                    )}
                  </div>
                  {launchTime && (
                    <div style={{ marginTop: 8, padding: 6, background: "#fef5f5", borderRadius: 4, fontSize: "0.82em", color: "#555" }}>
                      <span style={{ fontWeight: 700 }}>L-0: </span>{dayjs.utc(launchTime).format("YYYY-MM-DD HH:mm:ss")} UTC
                    </div>
                  )}
                </>)}
                {activeTab === "data" && (<>
                  <div style={{ fontSize: "0.8em", color: "#7f8c8d", marginBottom: 10 }}>
                    Export or import your entire project (items, milestones, instants, settings).
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                    <button onClick={exportProject}
                      style={{ padding: "8px 20px", background: "#16a085", color: "#fff", border: "none", borderRadius: 4, fontWeight: 800, cursor: "pointer", fontSize: "0.9em" }}
                    >📤 Export Project</button>
                    <button onClick={importProject}
                      style={{ padding: "8px 20px", background: "#297fb8", color: "#fff", border: "none", borderRadius: 4, fontWeight: 800, cursor: "pointer", fontSize: "0.9em" }}
                    >📥 Import Project</button>
                  </div>
                </>)}
                {activeTab === "test" && (<>
                  <div style={{ fontSize: "0.8em", color: "#7f8c8d", marginBottom: 8 }}>
                    Simulate a different date/time. The offset is applied to the now-line, clock, L± timer, and overdue checks.
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 200px" }}>
                      <label className="create-field-label">Simulated Date & Time (UTC)</label>
                      <input
                        id="test-sim-datetime"
                        type="datetime-local"
                        step="1"
                        defaultValue={simNow().format("YYYY-MM-DDTHH:mm:ss")}
                        className="create-field-input"
                      />
                    </div>
                    <button
                      onClick={() => {
                        const val = document.getElementById("test-sim-datetime")?.value;
                        if (!val) return;
                        const target = dayjs.utc(val);
                        if (!target.isValid()) { alert("Invalid datetime"); return; }
                        const offset = target.diff(dayjs.utc(), "millisecond");
                        setTimeOffsetMs(offset);
                        try { localStorage.setItem("TIMELINE_TIME_OFFSET", String(offset)); } catch(e) {}
                        setSelectedDate(target);
                        setIsLocked(true);
                      }}
                      style={{ padding: "6px 16px", background: "#8e44ad", color: "#fff", border: "none", borderRadius: 4, fontWeight: 800, cursor: "pointer", height: 32 }}
                    >Apply Offset</button>
                    <button
                      onClick={() => {
                        setTimeOffsetMs(0);
                        try { localStorage.setItem("TIMELINE_TIME_OFFSET", "0"); } catch(e) {}
                        setSelectedDate(dayjs.utc());
                        setIsLocked(true);
                      }}
                      style={{ padding: "6px 16px", background: isTestMode ? "#e74c3c" : "#ccc", color: "#fff", border: "none", borderRadius: 4, fontWeight: 800, cursor: "pointer", height: 32 }}
                    >Reset to Real Time</button>
                  </div>
                  {isTestMode && (
                    <div style={{ marginTop: 8, padding: 6, background: "rgba(142,68,173,0.08)", borderRadius: 4, fontSize: "0.8em" }}>
                      <span style={{ fontWeight: 800, color: "#8e44ad" }}>Active offset: </span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>
                        {(() => {
                          const abs = Math.abs(timeOffsetMs);
                          const sign = timeOffsetMs >= 0 ? "+" : "-";
                          const d = Math.floor(abs / 86400000);
                          const h = Math.floor((abs % 86400000) / 3600000);
                          const m = Math.floor((abs % 3600000) / 60000);
                          const s = Math.floor((abs % 60000) / 1000);
                          return `${sign}${d}d ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;
                        })()}
                      </span>
                      <span style={{ color: "#888", marginLeft: 8 }}>Simulated now: {simNow().format("YYYY-MM-DD HH:mm:ss")} UTC</span>
                    </div>
                  )}
                </>)}
              </div>
            </div>
          )}

          {/* ========== ITEMS PANEL (Tasks + Events + Instants + Milestones) ========== */}
          {isAdmin && activePanel === "items" && (
            <div className="admin-settings-panel admin-tabbed-panel">
              <div className="admin-tab-bar">
                <button className={"admin-tab" + (activeTab === "tasks" ? " admin-tab-active" : "")} style={{ "--tab-color": "#2ecc71" }} onClick={() => setActiveTab("tasks")}>+ Tasks</button>
                <button className={"admin-tab" + (activeTab === "events" ? " admin-tab-active" : "")} style={{ "--tab-color": "#3498db" }} onClick={() => setActiveTab("events")}>📅 Events</button>
                <button className={"admin-tab" + (activeTab === "instants" ? " admin-tab-active" : "")} style={{ "--tab-color": "#555" }} onClick={() => setActiveTab("instants")}>▲ Instants</button>
                <button className={"admin-tab" + (activeTab === "milestones" ? " admin-tab-active" : "")} style={{ "--tab-color": "#e67e22" }} onClick={() => setActiveTab("milestones")}>◆ Milestones</button>
              </div>
              <div className="admin-tab-content">
                {activeTab === "tasks" && (<div>
                  <div style={{ fontSize: "0.8em", color: "#7f8c8d", marginBottom: 8 }}>Create new tasks (missions).</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 6 }}>
                    <div style={{ flex: "2 1 160px" }}><label className="create-field-label">Task Name</label><input id="ct-title" type="text" defaultValue={`Mission ${getNextId(items)}`} className="create-field-input" /></div>
                    <div style={{ flex: "1 1 100px" }}><label className="create-field-label">Project</label><select id="ct-project" className="create-field-input" defaultValue={projectTree[0]?.id || ""} onChange={(e) => { const proj = projectTree.find((p) => p.id === e.target.value); const sel = document.getElementById("ct-subproject"); if (sel && proj) { sel.innerHTML = ""; proj.groupIds.forEach((gId) => { const g = dynamicGroups.find((gg) => gg.id === gId); if (g) { const o = document.createElement("option"); o.value = gId; o.text = g.title; sel.add(o); } }); } }}>{projectTree.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                    <div style={{ flex: "1 1 100px" }}><label className="create-field-label">Sub-project</label><select id="ct-subproject" className="create-field-input">{(projectTree[0]?.groupIds || []).map((gId) => { const g = dynamicGroups.find((gg) => gg.id === gId); return g ? <option key={gId} value={gId}>{g.title}</option> : null; })}</select></div>
                    <div style={{ flex: "0 0 55px" }}><label className="create-field-label">Lane</label><select id="ct-lane" className="create-field-input">{Array.from({ length: 8 }, (_, i) => <option key={i} value={i}>Lane {i}</option>)}</select></div>
                    <div style={{ flex: "1 1 80px" }}><label className="create-field-label">Dependency</label><select id="ct-dep" className="create-field-input"><option value="">None</option>{items.map((t) => <option key={t.id} value={t.id}>{t.title || `#${t.id}`}</option>)}</select></div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 6 }}>
                    <div style={{ flex: "1 1 150px" }}><label className="create-field-label">Start (UTC)</label><input id="ct-start" type="datetime-local" defaultValue={dayjs.utc().format("YYYY-MM-DDTHH:mm")} className="create-field-input" /></div>
                    <div style={{ flex: "1 1 150px" }}><label className="create-field-label">End (UTC)</label><input id="ct-end" type="datetime-local" defaultValue={dayjs.utc().add(2, "hour").format("YYYY-MM-DDTHH:mm")} className="create-field-input" /></div>
                    <div style={{ flex: "0 0 36px" }}><label className="create-field-label">Color</label><input id="ct-color" type="color" defaultValue="#4f8df5" style={{ width: 32, height: 26, border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" }} /></div>
                    <div style={{ flex: "0 0 90px" }}><label className="create-field-label">Status</label><select id="ct-status" className="create-field-input"><option value="movable">Planned</option><option value="locked">Locked</option></select></div>
                    <div style={{ flex: "0 0 100px" }}><label className="create-field-label">Priority</label><select id="ct-priority" className="create-field-input"><option value="normal">🟡 Normal</option><option value="urgent">🔴 Urgent</option><option value="nice-to-have">🟢 Nice to Have</option></select></div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 6 }}>
                    <div style={{ flex: "1 1 150px" }}><label className="create-field-label">Category</label><input id="ct-category" type="text" placeholder="e.g. Pre-Launch, Comm" className="create-field-input" /></div>
                    <div style={{ flex: "0 0 80px", display: "flex", flexDirection: "column", alignItems: "center" }}><label className="create-field-label">Countdown</label><input id="ct-countdown" type="checkbox" style={{ width: 16, height: 16, marginTop: 4 }} /></div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                    <div style={{ flex: 1 }}><label className="create-field-label">Description</label><textarea id="ct-desc" placeholder="Description (max 500 chars)" maxLength={500} className="create-field-input" style={{ minHeight: 48, resize: "vertical", fontFamily: "inherit" }} /></div>
                    <button onClick={() => { const title = document.getElementById("ct-title")?.value?.trim() || "New Task"; const groupId = Number(document.getElementById("ct-subproject")?.value || dynamicGroups[0]?.id || 1); const lane = Number(document.getElementById("ct-lane")?.value || 0); const start = dayjs.utc(document.getElementById("ct-start")?.value); const end = dayjs.utc(document.getElementById("ct-end")?.value); const color = document.getElementById("ct-color")?.value || "#4f8df5"; const status = document.getElementById("ct-status")?.value || "movable"; const priority = document.getElementById("ct-priority")?.value || "normal"; const category = document.getElementById("ct-category")?.value?.trim() || ""; const wantCountdown = document.getElementById("ct-countdown")?.checked || false; const depVal = document.getElementById("ct-dep")?.value; const desc = document.getElementById("ct-desc")?.value || ""; if (!start.isValid() || !end.isValid() || end.isBefore(start)) { alert("Invalid time range"); return; } const sMin = start.diff(timelineStart, "minute"); const eMin = end.diff(timelineStart, "minute"); const newId = getNextId(items); handleCreateItem({ id: newId, kind: "task", title, groupId, lane, startMin: sMin, endMin: eMin, color: priority === "urgent" ? "#e74c3c" : color, movable: status === "movable", urgent: priority === "urgent", priority, category, description: desc, dependencies: depVal ? [Number(depVal)] : [], depLags: {}, absStart: start.toISOString(), absEnd: end.toISOString() }); if (wantCountdown) toggleCountdown(newId); document.getElementById("ct-title").value = `Mission ${getNextId(items) + 1}`; document.getElementById("ct-desc").value = ""; document.getElementById("ct-category").value = ""; document.getElementById("ct-countdown").checked = false; }} style={{ padding: "8px 20px", background: "#2ecc71", color: "#fff", border: "none", borderRadius: 4, fontWeight: 800, cursor: "pointer", flexShrink: 0, height: 48 }}>Create Task</button>
                  </div>
                </div>)}
                {activeTab === "events" && (<div>
                  <div style={{ fontSize: "0.8em", color: "#7f8c8d", marginBottom: 8 }}>Create new events (meetings, deadlines, maintenance).</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 6 }}>
                    <div style={{ flex: "2 1 160px" }}><label className="create-field-label">Event Name</label><input id="ce-title" type="text" defaultValue={`Event ${getNextId(items)}`} className="create-field-input" /></div>
                    <div style={{ flex: "1 1 90px" }}><label className="create-field-label">Type</label><select id="ce-type" className="create-field-input"><option value="meeting">Meeting</option><option value="deadline">Deadline</option><option value="milestone">Milestone</option><option value="maintenance">Maintenance</option></select></div>
                    <div style={{ flex: "1 1 100px" }}><label className="create-field-label">Project</label><select id="ce-project" className="create-field-input" defaultValue={projectTree[0]?.id || ""} onChange={(e) => { const proj = projectTree.find((p) => p.id === e.target.value); const sel = document.getElementById("ce-subproject"); if (sel && proj) { sel.innerHTML = ""; proj.groupIds.forEach((gId) => { const g = dynamicGroups.find((gg) => gg.id === gId); if (g) { const o = document.createElement("option"); o.value = gId; o.text = g.title; sel.add(o); } }); } }}>{projectTree.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                    <div style={{ flex: "1 1 100px" }}><label className="create-field-label">Sub-project</label><select id="ce-subproject" className="create-field-input">{(projectTree[0]?.groupIds || []).map((gId) => { const g = dynamicGroups.find((gg) => gg.id === gId); return g ? <option key={gId} value={gId}>{g.title}</option> : null; })}</select></div>
                    <div style={{ flex: "0 0 55px" }}><label className="create-field-label">Lane</label><select id="ce-lane" className="create-field-input">{Array.from({ length: 8 }, (_, i) => <option key={i} value={i}>Lane {i}</option>)}</select></div>
                    <div style={{ flex: "1 1 80px" }}><label className="create-field-label">Dependency</label><select id="ce-dep" className="create-field-input"><option value="">None</option>{items.map((t) => <option key={t.id} value={t.id}>{t.title || `#${t.id}`}</option>)}</select></div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 6 }}>
                    <div style={{ flex: "1 1 150px" }}><label className="create-field-label">Start (UTC)</label><input id="ce-start" type="datetime-local" defaultValue={dayjs.utc().format("YYYY-MM-DDTHH:mm")} className="create-field-input" /></div>
                    <div style={{ flex: "1 1 150px" }}><label className="create-field-label">End (UTC)</label><input id="ce-end" type="datetime-local" defaultValue={dayjs.utc().add(1, "hour").format("YYYY-MM-DDTHH:mm")} className="create-field-input" /></div>
                    <div style={{ flex: "0 0 36px" }}><label className="create-field-label">Color</label><input id="ce-color" type="color" defaultValue="#3498db" style={{ width: 32, height: 26, border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" }} /></div>
                    <div style={{ flex: "1 1 140px" }}><label className="create-field-label">Participants</label><input id="ce-participants" type="text" placeholder="e.g. Dev Team, PO" className="create-field-input" /></div>
                    <div style={{ flex: "1 1 140px" }}><label className="create-field-label">Category</label><input id="ce-category" type="text" placeholder="e.g. Comm, ADCS" className="create-field-input" /></div>
                    <div style={{ flex: "0 0 80px", display: "flex", flexDirection: "column", alignItems: "center" }}><label className="create-field-label">Countdown</label><input id="ce-countdown" type="checkbox" style={{ width: 16, height: 16, marginTop: 4 }} /></div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                    <div style={{ flex: 1 }}><label className="create-field-label">Description</label><textarea id="ce-desc" placeholder="Description (max 500 chars)" maxLength={500} className="create-field-input" style={{ minHeight: 48, resize: "vertical", fontFamily: "inherit" }} /></div>
                    <button onClick={() => { const title = document.getElementById("ce-title")?.value?.trim() || "New Event"; const eventType = document.getElementById("ce-type")?.value || "meeting"; const groupId = Number(document.getElementById("ce-subproject")?.value || dynamicGroups[0]?.id || 1); const lane = Number(document.getElementById("ce-lane")?.value || 0); const start = dayjs.utc(document.getElementById("ce-start")?.value); const end = dayjs.utc(document.getElementById("ce-end")?.value); const color = document.getElementById("ce-color")?.value || "#3498db"; const participants = document.getElementById("ce-participants")?.value || ""; const category = document.getElementById("ce-category")?.value?.trim() || ""; const wantCountdown = document.getElementById("ce-countdown")?.checked || false; const depVal = document.getElementById("ce-dep")?.value; const desc = document.getElementById("ce-desc")?.value || ""; if (!start.isValid() || !end.isValid() || end.isBefore(start)) { alert("Invalid time range"); return; } const sMin = start.diff(timelineStart, "minute"); const eMin = end.diff(timelineStart, "minute"); const newId = getNextId(items); handleCreateItem({ id: newId, kind: "event", title, groupId, lane, startMin: sMin, endMin: eMin, color, movable: false, eventType, participants, category, description: desc, dependencies: depVal ? [Number(depVal)] : [], depLags: {}, absStart: start.toISOString(), absEnd: end.toISOString() }); if (wantCountdown) toggleCountdown(newId); document.getElementById("ce-title").value = `Event ${getNextId(items) + 1}`; document.getElementById("ce-desc").value = ""; document.getElementById("ce-participants").value = ""; document.getElementById("ce-category").value = ""; document.getElementById("ce-countdown").checked = false; }} style={{ padding: "8px 20px", background: "#3498db", color: "#fff", border: "none", borderRadius: 4, fontWeight: 800, cursor: "pointer", flexShrink: 0, height: 48 }}>Create Event</button>
                  </div>
                </div>)}
                {activeTab === "instants" && (<>
              <div style={{ fontSize: "0.8em", color: "#7f8c8d", marginBottom: 8 }}>
                Point markers: <b style={{ color: "#e67e22" }}>E</b> = Event (fixed), <b style={{ color: "#27ae60" }}>T</b> = Task (draggable).
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
                <select
                  id="ie-new-kind"
                  style={{ width: 50, padding: 4, borderRadius: 4, border: "1px solid #ccc", fontSize: "0.78em" }}
                >
                  <option value="event">E</option>
                  <option value="task">T</option>
                </select>
                <button
                  onClick={() => {
                    const title = document.getElementById("ie-new-title").value.trim();
                    const dt = document.getElementById("ie-new-dt").value;
                    const gId = document.getElementById("ie-new-group").value;
                    const sym = document.getElementById("ie-new-symbol").value;
                    const color = document.getElementById("ie-new-color").value;
                    const kind = document.getElementById("ie-new-kind").value;
                    if (title && dt) {
                      const desc = document.getElementById("ie-new-desc")?.value?.trim() || "";
                      const wantCountdown = document.getElementById("ie-new-countdown")?.checked || false;
                      const createdId = addInstantEvent(title, dayjs.utc(dt).toISOString(), gId, sym, color, [], kind, desc);
                      if (wantCountdown) toggleCountdown(createdId);
                      document.getElementById("ie-new-title").value = "";
                      document.getElementById("ie-new-desc").value = "";
                      document.getElementById("ie-new-countdown").checked = false;
                    }
                  }}
                  style={{ padding: "4px 10px", fontSize: "0.85em", background: "#555", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 700 }}
                >+ Add</button>
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
                <input id="ie-new-desc" type="text" placeholder="Description (optional)" style={{ flex: 1, padding: 4, borderRadius: 4, border: "1px solid #ccc", fontSize: "0.82em", boxSizing: "border-box" }} />
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.78em", color: "#666", whiteSpace: "nowrap", cursor: "pointer" }}><input id="ie-new-countdown" type="checkbox" style={{ width: 14, height: 14 }} /> Countdown</label>
              </div>

              {/* Instant Events List */}
              {instantEvents.length === 0 && (
                <div style={{ fontSize: "0.8em", color: "#aaa", fontStyle: "italic" }}>No instant events defined.</div>
              )}
              {instantEvents.map((ie) => (
                <div key={ie.id} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 3, padding: 4, background: ie.kind === "task" ? "#eef7ee" : "#f9f9f9", borderRadius: 4, border: `1px solid ${ie.kind === "task" ? "#c8e6c9" : "#eee"}` }}>
                  <select
                    value={ie.kind || "event"}
                    onChange={(e) => updateInstantEvent(ie.id, { kind: e.target.value })}
                    style={{ width: 32, padding: 1, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.72em", fontWeight: 800, textAlign: "center", color: ie.kind === "task" ? "#27ae60" : "#e67e22" }}
                  >
                    <option value="event">E</option>
                    <option value="task">T</option>
                  </select>
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
                  <select
                    value={(ie.dependencies && ie.dependencies[0]) || ""}
                    onChange={(e) => updateInstantEvent(ie.id, { dependencies: e.target.value ? [Number(e.target.value)] : [] })}
                    style={{ width: 70, padding: 2, border: "1px solid #ddd", borderRadius: 3, fontSize: "0.72em", color: ie.dependencies?.length ? "#e74c3c" : "#999" }}
                    title="Link to task/event"
                  >
                    <option value="">No dep</option>
                    {items.map((t) => (
                      <option key={t.id} value={t.id}>{t.title || `#${t.id}`}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => removeInstantEvent(ie.id)}
                    style={{ background: "none", border: "none", color: "#e74c3c", cursor: "pointer", fontWeight: 800, fontSize: "1em", flexShrink: 0 }}
                  >✕</button>
                </div>
              ))}
                </>)}
                {activeTab === "milestones" && (<>
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
                </>)}
              </div>
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
            {/* Spacer for elapsed time row */}
            {showElapsedRow && (
              <div className="sidebar-special-row sidebar-elapsed-spacer" style={{ height: 36 }} />
            )}
            {instantEvents.length > 0 && (
              <div className="sidebar-special-row" style={{ height: 22 }}>
                <span className="sidebar-special-label" style={{ color: "#555" }}>▲ Instants</span>
              </div>
            )}

            {projectTree.map((proj) => {
              if (hiddenProjects.has(proj.id)) return null;
              const isExpanded = !collapsedProjects.has(proj.id);
              const orderedGids = getOrderedGroups(proj);
              const projGroups = orderedGids
                .map((gId) => dynamicGroups.find((g) => g.id === gId))
                .filter(Boolean);
              const sections = proj.sections || [];
              const sectionGids = sections.flatMap((s) => s.groupIds);
              const ungroupedGroups = projGroups.filter((g) => !sectionGids.includes(g.id));

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
                      {sections.map((sec) => {
                        const secGroups = sec.groupIds
                          .map((gId) => dynamicGroups.find((g) => g.id === gId))
                          .filter(Boolean);
                        if (secGroups.length === 0) return null;
                        return (
                          <div key={sec.id} className="sidebar-section-block">
                            <div className="sidebar-section-header" style={{ height: secGroups.reduce((sum, g) => sum + getRowHeight(g.id), 0) }}>
                              <span className="sidebar-section-name">{sec.name}</span>
                            </div>
                            <div className="sidebar-section-groups">
                              {secGroups.map((g) => (
                                <div key={g.id} className="sidebar-subproject-row" style={{ height: getRowHeight(g.id) }}>
                                  {g.title}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                      {ungroupedGroups.map((g) => (
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
                          {el.dayNumber > 0 ? `D+${el.dayNumber}` : `D${el.dayNumber}`}
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
                        className={"instant-event-marker" + (isAdmin && ie.kind === "task" ? " instant-draggable" : "")}
                        style={{
                          left: displayLeft,
                          color: ie.color || "#333",
                          cursor: isAdmin && ie.kind === "task" ? "ew-resize" : "pointer",
                        }}
                        title={`${ie.kind === "task" ? "T" : "E"} ${ie.symbol || "▲"} ${ie.title} ${ie.dt.format("HH:mm")}`}
                        onMouseDown={(e) => handleIeMouseDown(e, ie)}
                        onClick={(e) => {
                          if (!e.defaultPrevented && !(isAdmin && ie.kind === "task")) {
                            const orig = instantEvents.find((x) => x.id === ie.id);
                            if (orig) setSelectedInstant(orig);
                          }
                        }}
                        onMouseUp={(e) => {
                          if (isAdmin && ie.kind === "task" && ieDragState && Math.abs(ieDragState.dx || 0) < 3) {
                            const orig = instantEvents.find((x) => x.id === ie.id);
                            if (orig) setSelectedInstant(orig);
                          }
                        }}
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
                if (hiddenProjects.has(proj.id)) return null;
                if (collapsedProjects.has(proj.id)) return null;
                const orderedGids = getOrderedGroups(proj);
                const projGroups = orderedGids
                  .map((gId) => dynamicGroups.find((g) => g.id === gId))
                  .filter(Boolean);

                return (
                <div key={proj.id} className="timeline-project-separator">
                {projGroups.map((g) => (
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
                            title={(() => {
                              const durMin = it.endMin - it.startMin;
                              const durH = Math.floor(durMin / 60);
                              const durM = durMin % 60;
                              const durStr = durH > 0 ? `${durH}h ${durM > 0 ? durM + "m" : ""}` : `${durM}m`;
                              const group = dynamicGroups.find((gg) => gg.id === it.groupId);
                              const depNames = (it.dependencies || []).map((dId) => {
                                const dep = items.find((x) => x.id === dId);
                                return dep ? dep.title : `#${dId}`;
                              });
                              let tip = `${it.title}\n${timeLabel} (${durStr.trim()})`;
                              if (group) tip += `\n${group.title}`;
                              if (depNames.length > 0) tip += `\nDep: ${depNames.join(", ")}`;
                              if (!it.movable) tip += `\n🔒 Locked`;
                              return tip;
                            })()}
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
              ))}
                </div>
                );
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

      {/* COUNTDOWN BAR */}
      {countdownDisplays.length > 0 && !fullscreenCountdownId && (
        <div className="countdown-bar">
          {countdownDisplays.map((cd) => (
            <div key={cd.id} className={"countdown-item" + (cd.isPast ? " countdown-past" : " countdown-future")}>
              <span className="countdown-title">{cd.title}</span>
              <span className="countdown-label">{cd.isPast ? "elapsed" : "remaining"}</span>
              <span className="countdown-time">{cd.timeStr}</span>
              <div className="countdown-actions">
                <button className="countdown-fullscreen" onClick={() => setFullscreenCountdownId(cd.id)} title="Show fullscreen">⛶</button>
                <button className="countdown-close" onClick={() => toggleCountdown(cd.id)} title="Remove countdown">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FULLSCREEN COUNTDOWN OVERLAY */}
      {fullscreenCountdownId && (() => {
        const cd = countdownDisplays.find((c) => c.id === fullscreenCountdownId);
        if (!cd) return null;
        return (
          <div className="countdown-fullscreen-overlay" onClick={() => setFullscreenCountdownId(null)}>
            <div className="countdown-fullscreen-content" onClick={(e) => e.stopPropagation()}>
              <div className={"countdown-fullscreen-label" + (cd.isPast ? " cfs-past" : " cfs-future")}>
                {cd.isPast ? "ELAPSED" : "REMAINING"}
              </div>
              <div className="countdown-fullscreen-title">{cd.title}</div>
              <div className={"countdown-fullscreen-time" + (cd.isPast ? " cfs-past" : " cfs-future")}>{cd.timeStr}</div>
              {countdownDisplays.length > 1 && (
                <div className="countdown-fullscreen-switcher">
                  {countdownDisplays.map((other) => (
                    <button
                      key={other.id}
                      className={"cfs-switch-btn" + (other.id === fullscreenCountdownId ? " cfs-switch-active" : "")}
                      onClick={() => setFullscreenCountdownId(other.id)}
                    >{other.title}</button>
                  ))}
                </div>
              )}
              <button className="countdown-fullscreen-close" onClick={() => setFullscreenCountdownId(null)}>✕ Close</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default ProjectTimeline;