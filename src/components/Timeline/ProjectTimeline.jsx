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
import itemsByDate from "../../data/items";

import "./timeline.css";

import img1 from "../../assets/UZAY-Yatay.png";
import img2 from "../../assets/AYAP-1.png";

dayjs.extend(weekOfYear);
dayjs.extend(utc);

// --- AYARLAR ---
const SIDEBAR_WIDTH = 150;
const SNAP_MINUTES = 5;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

// --- YARDIMCI FONKSİYONLAR ---
function moveDependentItems(items, parentId, shiftAmount, totalMinutes) {
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
      let newStart = currentItem.startMin + shiftAmount;
      let newEnd = currentItem.endMin + shiftAmount;

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
      nextItems = moveDependentItems(nextItems, dep.id, shiftAmount, totalMinutes);
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
  isAdmin,
  groupsData,
  timelineStart,
  totalMinutes,
  snapMinutes = SNAP_MINUTES,
  allTasks = [],
  closeOnApply = false,
}) => {

  const [applyColorToLaneGroup, setApplyColorToLaneGroup] = useState(false);

  // Admin edit state'leri
  const [editTitle, setEditTitle] = useState("");
  const [editId, setEditId] = useState("");
  const [editLane, setEditLane] = useState("0");
  const [editDesc, setEditDesc] = useState("");
  const [editGroupId, setEditGroupId] = useState("");
  const [editStartTime, setEditStartTime] = useState("00:00");
  const [editEndTime, setEditEndTime] = useState("00:00");
  const [depToAdd, setDepToAdd] = useState("");
  const [editDepsIds, setEditDepsIds] = useState([]);

  const clampInt = (v, min, max, fallback) => {
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  };
  const MINUTES_IN_DAY = 1440;

  const pad2 = (n) => String(n).padStart(2, "0");

  const minutesToHHmm = useCallback((mins) => {
    const m = Math.max(0, Math.min(1439, Math.round(mins)));
    return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  }, []);


  const parseHHmmToMinutes = (hhmm) => {
    const [hh, mm] = String(hhmm || "00:00").split(":");
    const h = Number(hh);
    const m = Number(mm);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    return Math.max(0, Math.min(MINUTES_IN_DAY, h * 60 + m));
  };

  const snapMin = (mins) => {
    const s = Math.round(mins / snapMinutes) * snapMinutes;
    return Math.max(0, Math.min(1440, s));
  };

  const [editDurationMin, setEditDurationMin] = useState(0);

  const handleStartTimeChange = (newHHmm) => {
  setEditStartTime(newHHmm);

  const startM = snapMin(parseHHmmToMinutes(newHHmm));
  const safeDurRaw = Number(editDurationMin);
  const safeDur = Number.isFinite(safeDurRaw) ? safeDurRaw : snapMinutes;
  const dur = Math.max(snapMinutes, snapMin(clamp(safeDur, snapMinutes, MINUTES_IN_DAY)));

  let endM = startM + dur;
  if (endM > MINUTES_IN_DAY) {
    endM = MINUTES_IN_DAY;
    const backStart = endM - dur;
    setEditStartTime(minutesToHHmm(Math.max(0, backStart)));
  }

  setEditEndTime(minutesToHHmm(endM));
  setEditDurationMin(dur);

  // end == start olmasın
  if (endM <= startM) endM = Math.min(1439, startM + snapMinutes);

  setEditEndTime(minutesToHHmm(endM));
  setEditDurationMin(Math.max(snapMinutes, endM - startM));
  };

  const handleEndTimeChange = (newHHmm) => {
  setEditEndTime(newHHmm);

  const startM = snapMin(parseHHmmToMinutes(editStartTime));
  let endM = snapMin(parseHHmmToMinutes(newHHmm));

  endM = clamp(endM, snapMinutes, MINUTES_IN_DAY);

  if (endM <= startM) {
    endM = clamp(startM + snapMinutes, snapMinutes, MINUTES_IN_DAY);
    setEditEndTime(minutesToHHmm(endM));
  }

  const dur = Math.max(snapMinutes, snapMin(endM - startM));
  setEditDurationMin(dur);
};


  useEffect(() => {
    // Modal farklı task ile açılınca checkbox reset
    setApplyColorToLaneGroup(false);

    if (!task) return;

    setEditTitle(String(task.title ?? ""));
    setEditId(String(task.id ?? ""));
    setEditLane(String(task.lane ?? 0));
    setEditGroupId(String(task.groupId ?? ""));

    setEditDepsIds(Array.isArray(task.dependencies) ? task.dependencies.map(Number) : []);
    setDepToAdd("");

    setEditDesc(String(task.description ?? "").slice(0, 500));

    /**
     * ✅ KRİTİK:
     * Timeline 48h (prev day 12:00 -> next day 12:00). Bu yüzden task.startMin/task.endMin
     * 1440'ı aşabilir. minutesToHHmm(1280) => 21:20 gibi "yanlış" görünür.
     * Modal input'ları HER ZAMAN task'ın mutlak zamanından (absStart/absEnd) beslenmeli.
     */
    const safeStartRel = Number.isFinite(Number(task.startMin))
      ? Number(task.startMin)
      : task.absStart && timelineStart
        ? Math.round(dayjs.utc(task.absStart).diff(timelineStart, "minute"))
        : 0;

    const safeEndRelRaw = Number.isFinite(Number(task.endMin))
      ? Number(task.endMin)
      : task.absEnd && timelineStart
        ? Math.round(dayjs.utc(task.absEnd).diff(timelineStart, "minute"))
        : safeStartRel + snapMinutes;

    const safeEndRel =
      safeEndRelRaw > safeStartRel ? safeEndRelRaw : safeStartRel + snapMinutes;

    const stAbs = timelineStart.add(safeStartRel, "minute");
    const enAbs = timelineStart.add(safeEndRel, "minute");

    setEditStartTime(stAbs.format("HH:mm"));
    setEditEndTime(enAbs.format("HH:mm"));
    setEditDurationMin(Math.max(snapMinutes, safeEndRel - safeStartRel));


  }, [task, groupsData, snapMinutes, timelineStart]);

  if (!task) return null;

  // Status
  const getStatusLabel = () => {
    if (task.completed) return "Completed";
    if (!task.movable) return "Locked";
    return "Planned";
  };

  const getStatusColor = () => {
    if (task.completed) return "#bdc3c7";
    if (task.urgent) return "#c0392b";
    if (task.invisible) return "#95a5a6";
    return task.color || "#4f8df5";
  };

  // Handler for Admin Property Changes (mevcut özellikleri bozmadan)
  const handlePropChange = (field, value) => {
    if (!onUpdateTask) return;

    let updates = { [field]: value };

    // CRITICAL/URGENT: kırmızıya çek + geri dönüşte eski rengi geri getir
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

    // Status dropdown mantığı
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

    // Renk seçimi: urgent ise ekranda kırmızı kalsın ama normale dönünce seçilen renge dönsün
    if (field === "color") {
      if (task.urgent) {
        updates._prevColorBeforeUrgent = value; // normal renk olarak sakla
        updates.color = "#e74c3c"; // ekranda kırmızı kalsın
      } else {
        updates.color = value;
      }
      // aynı group + layer'a uygula bayrağı
      updates._applyToSameGroupLane = applyColorToLaneGroup;
    }

    onUpdateTask(task.id, updates);
  };

  // Admin: formdaki editleri uygula
  // Admin: formdaki editleri uygula
const applyAdminEdits = () => {
  if (!onUpdateTask) return;

  const nextTitle = String(editTitle || "").trim();
  const nextId = clampInt(editId, 1, 100, task.id);
  const nextLane = clampInt(editLane, 0, 2, task.lane ?? 0);
  const nextGroupId = clampInt(editGroupId, 1, 9999, task.groupId);
  const desc = String(editDesc || "").slice(0, 500);

  // ✅ ZAMAN HESABI (48h timeline için doğru offset)
  // HH:mm input'u her zaman "gün içi dakika"dır.
  // Bunu task'in bulunduğu günün timelineStart'a göre offset'i ile toplarız.
  const startOfDay = parseHHmmToMinutes(editStartTime); // 0..1439
  const endOfDay = parseHHmmToMinutes(editEndTime);     // 0..1439

  const snapOfDay = (m) => {
    const s = Math.round(m / snapMinutes) * snapMinutes;
    return clamp(s, 0, 1440);
  };

  const startDaySnapped = snapOfDay(startOfDay);
  let endDaySnapped = snapOfDay(endOfDay);

  // Task'in "hangi gün"de olduğunu absStart'tan bul.
  // absStart yoksa: timelineStart + startMin üzerinden üret.
  const absStartSafe = task.absStart
    ? dayjs.utc(task.absStart)
    : dayjs.utc(timelineStart).add(Number.isFinite(task.startMin) ? task.startMin : 0, "minute");

  const baseDayAbs = absStartSafe.startOf("day");
  const dayOffset = baseDayAbs.diff(timelineStart, "minute"); // ör: 720

  // end <= start ise kullanıcı ertesi günü kastetmiş olabilir (23:00 -> 01:00 gibi)
  if (endDaySnapped <= startDaySnapped) {
    endDaySnapped += 1440;
  }

  let relStartMin = dayOffset + startDaySnapped;
  let relEndMin = dayOffset + endDaySnapped;

  // timeline sınırlarına clamp
  relStartMin = clamp(relStartMin, 0, Math.max(0, totalMinutes - snapMinutes));
  relEndMin = clamp(relEndMin, relStartMin + snapMinutes, totalMinutes);

  onUpdateTask(task.id, {
    title: nextTitle || task.title,
    id: nextId,
    groupId: nextGroupId,
    lane: nextLane,
    description: desc,
    startMin: relStartMin,
    endMin: relEndMin,
    dependencies: (editDepsIds || []).map(Number),
    depLags: task.depLags || {},
  });

  // duration UI'si güncel kalsın
  setEditDurationMin(Math.max(snapMinutes, relEndMin - relStartMin));
};

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {task.title}
            <span style={{ marginLeft: 8, fontSize: "0.8em" }}>
              {task.urgent && <span title="Urgent">⚠️</span>}
              {!task.movable && (
                <span title="Locked" style={{ marginLeft: 4 }}>
                  🔒
                </span>
              )}
              {task.completed && (
                <span style={{ color: "green", marginLeft: 4 }}>✅</span>
              )}
            </span>
          </h3>
          <button className="modal-close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          {/* Title */}
          <div className="modal-row">
            <strong>Task Name:</strong>
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

          {/* Group */}
          <div className="modal-row">
            <strong>Group:</strong>
            {isAdmin ? (
              <select
                value={String(editGroupId)}
                onChange={(e) => setEditGroupId(e.target.value)}
                style={{ padding: 4, borderRadius: 4, minWidth: 160 }}
              >
                {groupsData.map((g) => (
                  <option key={g.id} value={String(g.id)}>
                    {g.title}
                  </option>
                ))}
              </select>
            ) : (
              <span>{task.groupName || task.groupId}</span>
            )}
          </div>

          {/* Layer */}
          <div className="modal-row">
            <strong>Layer:</strong>
            {isAdmin ? (
              <select
                value={String(editLane)}
                onChange={(e) => setEditLane(e.target.value)}
                style={{ padding: 4, borderRadius: 4, minWidth: 120 }}
              >
                <option value="0">0</option>
                <option value="1">1</option>
                <option value="2">2</option>
              </select>
            ) : (
              <span>{task.lane !== undefined ? task.lane : "None"}</span>
            )}
          </div>

          {/* Dependency */}
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
              {/* Dropdown + Add */}
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

                    // duplicate engelle
                    const next = Array.from(new Set([...(editDepsIds || []), idNum]));

                    setEditDepsIds(next);
                    setDepToAdd("");

                    const depTask = allTasks.find((t) => Number(t.id) === Number(idNum));

                    const baseStart = Number.isFinite(task.startMin) ? task.startMin : 0;
                    const baseEnd = Number.isFinite(task.endMin) ? task.endMin : baseStart + snapMinutes;
                    const dur = Math.max(snapMinutes, baseEnd - baseStart);

                    const parentEnd =
                      depTask && Number.isFinite(depTask.endMin) ? depTask.endMin : 0;

                    // lag: mevcutta parent'tan sonra ise koru, değilse 0
                    const lag = Math.max(0, baseStart - parentEnd);

                    const nextDepLags = { ...(task.depLags || {}), [Number(idNum)]: lag };

                    // ✅ Dependency eklenince: child en az parentEnd+lag noktasında olmalı
                    let newStartMin = Math.max(baseStart, parentEnd + lag);
                    newStartMin = Math.round(newStartMin / snapMinutes) * snapMinutes;

                    let newEndMin = newStartMin + dur;
                    if (newEndMin > 1440) {
                      newEndMin = 1440;
                      newStartMin = Math.max(0, 1440 - dur);
                    }

                    onUpdateTask?.(task.id, {
                      dependencies: next.map((d) => Number(d)), // ✅ string -> number
                      depLags: nextDepLags,
                      startMin: newStartMin, // ✅ duration küçülmesin diye zorunlu
                      endMin: newEndMin,
                    });
                  }}
                >
                  Add
                </button>
              </div>

              {/* Selected deps list */}
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


          {/* Time Range */}
          <div className="modal-row">
            <strong>Time (UTC):</strong>
            {isAdmin ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="time"
                  value={editStartTime}
                  onChange={(e) => handleStartTimeChange(e.target.value)}
                  step={60}
                />
                <span>–</span>
                <input
                  type="time"
                  value={editEndTime}
                  onChange={(e) => handleEndTimeChange(e.target.value)}
                  step={60}
                />
              </div>
            ) : (
              <span>
                {timelineStart.add(Number.isFinite(Number(task.startMin)) ? Number(task.startMin) : 0, "minute").format("HH:mm")} -{" "}
                {timelineStart.add(Number.isFinite(Number(task.endMin)) ? Number(task.endMin) : ((Number.isFinite(Number(task.startMin)) ? Number(task.startMin) : 0) + snapMinutes), "minute").format("HH:mm")}
              </span>
            )}
          </div>

          <div className="modal-row">
            <strong>Duration:</strong>
            <span>{isAdmin ? `${editDurationMin} mins` : `${task.endMin - task.startMin} mins`}</span>
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
                  <option value="planned">Planned (Movable)</option>
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
                <strong>Task Color:</strong>
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

              {/* ✅ Yeni: aynı group + layer'a uygula */}
              <div className="modal-row" style={{ marginTop: 2 }}>
                <strong />
                <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={applyColorToLaneGroup}
                    onChange={(e) => setApplyColorToLaneGroup(e.target.checked)}
                    style={{ marginRight: 6 }}
                  />
                  Apply to all tasks in same group &amp; layer
                </label>
              </div>

              {/* ✅ Apply (Admin edit alanları) */}
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
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: "space-between" }}>
          {isAdmin ? (
            <button
              className="btn-primary"
              onClick={applyAdminEdits}
            >
              Apply Changes
            </button>
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
  const [completedIds, setCompletedIds] = useState(() => {
    try {
      const saved = localStorage.getItem("SERVER_COMPLETED_DB");
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.error("LocalStorage load error:", error);
      return [];
    }
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

  const scaleWrapperRef = useRef(null);
  const rowsWrapperRef = useRef(null);
  const sidebarBodyRef = useRef(null);
  const lastNowMinRef = useRef(null);
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

  // --- ITEM MERGING & FETCHING ---
  const itemsForRange = useMemo(() => {
    const daysToCheck = [-1, 0, 1];
    let combinedItems = [];

    daysToCheck.forEach((offset) => {
      const d = selectedDate.add(offset, "day");
      const key = d.format("YYYY-MM-DD");
      const dayItems = itemsByDate[key];

      if (Array.isArray(dayItems)) {
        const dayStart = d.startOf("day");

        const mapped = dayItems.map((it) => {
          const itemAbsStart = dayStart.add(it.startMin, "minute");
          const itemAbsEnd = dayStart.add(it.endMin, "minute");
          const relativeStart = itemAbsStart.diff(timelineStart, "minute");
          const relativeEnd = itemAbsEnd.diff(timelineStart, "minute");
          const group = groupsData.find((g) => g.id === it.groupId);

          const isCompletedFromServer = completedIds.includes(it.id);

          return {
            ...it,
            startMin: relativeStart,
            endMin: relativeEnd,
            groupName: group ? group.title : it.groupId,
            description: it.description,
            completed: isCompletedFromServer,
            absEnd: itemAbsEnd,
            // Varsayılanlar
            urgent: it.urgent || false,
            color: it.color,
            movable: it.movable !== false,
            invisible: it.invisible || false,
            // ✅ critical renk geri dönüş için (varsa)
            _prevColorBeforeUrgent: it._prevColorBeforeUrgent || null,
          };
        });

        const filtered = mapped.filter((it) => it.endMin > 0 && it.startMin < totalMinutes);
        combinedItems = combinedItems.concat(filtered);
      }
    });
    return combinedItems;
  }, [selectedDate, timelineStart, totalMinutes, completedIds]);

  // Local State for Items (Editable)
  const [items, setItems] = useState(itemsForRange);


// ✅ Keep selectedTask in sync with the latest `items`
// This prevents stale modal fields after drag/resize updates.
useEffect(() => {
  if (!selectedTask) return;

  const selId = Number(selectedTask.id);
  const fresh = items.find((t) => Number(t.id) === selId);

  // Only update if we found a newer object (prevents loops)
  if (fresh && fresh !== selectedTask) {
    setSelectedTask(fresh);
  }
}, [items, selectedTask]);

  useEffect(() => {
    setItems(itemsForRange);
    setDragState(null);
  }, [itemsForRange]);


  // --- CREATE NEW TASK (ADMIN) ---
  const openCreateTask = () => {
    // default start: "now" within current timeline
    const now = dayjs.utc();
    const nowRel = now.diff(timelineStart, "minute", true);
    const snapFn = (m) => Math.round(m / SNAP_MINUTES) * SNAP_MINUTES;

    const startMin = clamp(snapFn(nowRel), 0, Math.max(0, totalMinutes - SNAP_MINUTES));
    const defaultDur = Math.max(SNAP_MINUTES, 120); // 2h default
    const endMin = clamp(startMin + defaultDur, startMin + SNAP_MINUTES, totalMinutes);

    const usedIds = new Set(items.map((t) => Number(t.id)));
    let newId = 1;
    while (usedIds.has(newId) && newId <= 100) newId += 1;

    const defaultGroupId = groupsData?.[0]?.id ?? 1;
    const g = groupsData.find((gg) => gg.id === defaultGroupId);

    const draft = {
      id: newId,
      title: `Mission ${newId}`,
      groupId: defaultGroupId,
      groupName: g ? g.title : String(defaultGroupId),
      lane: 0,
      startMin,
      endMin,
      // extras used in UI
      urgent: false,
      color: "#4f8df5",
      movable: true,
      invisible: false,
      completed: false,
      description: "",
      dependencies: [],
      depLags: {},
      absEnd: timelineStart.add(endMin, "minute"),
    };

    setCreateDraft(draft);
    setIsCreateOpen(true);
  };

  const handleCreateTask = (newTask) => {
    setItems((prev) => {
      const used = new Set(prev.map((t) => Number(t.id)));
      let idNum = clamp(Number(newTask.id), 1, 100);
      while (used.has(idNum) && idNum <= 100) idNum += 1;

      const next = {
        ...newTask,
        id: idNum,
        startMin: clamp(Number(newTask.startMin ?? 0), 0, totalMinutes),
        endMin: clamp(Number(newTask.endMin ?? 0), 0, totalMinutes),
      };

      next.absEnd = timelineStart.add(next.endMin, "minute");

      // groupName
      const gg = groupsData.find((x) => x.id === next.groupId);
      next.groupName = gg ? gg.title : next.groupName;

      return [...prev, next];
    });
  };

  // --- UPDATING ITEM ATTRIBUTES (ADMIN) ---
  const handleUpdateTask = (taskId, updates) => {
    setItems((prevItems) => {
        const propagateDeps = (itemsArr, movedId, snapFn, visited = new Set()) => {
        if (visited.has(movedId)) return itemsArr;
        visited.add(movedId);

        const moved = itemsArr.find((x) => x.id === movedId);
        if (!moved) return itemsArr;

        // moved'ın yeni endMin'i referans
        const movedEnd = moved.endMin;

        // movedId'ye bağlı olan "child" task'ları bul
        const children = itemsArr.filter(
          (t) => Array.isArray(t.dependencies) && t.dependencies.includes(movedId)
        );

        let next = itemsArr;

        for (const child of children) {
          // locked task'ı otomatik itmeyelim (istersen kaldırırsın)
          if (child.movable === false) continue;

          const lag = (child.depLags && child.depLags[movedId]) ?? 0;
          const dur = (child.endMin ?? 0) - (child.startMin ?? 0);

          let newStart = snapFn(movedEnd + lag);
          let newEnd = newStart + dur;

          // gün sınırı
          if (newStart < 0) {
            newStart = 0;
            newEnd = dur;
          }
          if (newEnd > 1440) {
            newEnd = 1440;
            newStart = 1440 - dur;
          }

          // child update
          next = next.map((x) =>
            x.id === child.id ? { ...x, startMin: newStart, endMin: newEnd } : x
          );

          // zincir: child da başkasına parent olabilir
          next = propagateDeps(next, child.id, snapFn, visited);
        }

        return next;
      };

      const applyToSameGroupLane = !!updates?._applyToSameGroupLane;

      // internal meta alanı item üzerinde tutmayalım
      const { _applyToSameGroupLane, ...rawUpdates } = updates || {};

      if (Object.prototype.hasOwnProperty.call(rawUpdates, "dependencies")) {
        const arr = Array.isArray(rawUpdates.dependencies) ? rawUpdates.dependencies : [];
        rawUpdates.dependencies = arr
          .map((d) => Number(d))
          .filter((n) => Number.isFinite(n));
      }

      const baseTask = prevItems.find((x) => x.id === taskId);
      if (!baseTask) return prevItems;

      // ✅ Normalize (tip karmaşasını bitirir)
      const normGroup = (v) => String(v);
      const normLane = (v) => Number(v ?? 0);

      const baseGroupId = normGroup(baseTask.groupId);
      const baseLane = normLane(baseTask.lane);

      // checkbox aktifse hedef: aynı group + lane
      const shouldBroadcast = applyToSameGroupLane === true;

      // sadece renk ile ilgili alanları broadcast edelim
      const hasColorField = Object.prototype.hasOwnProperty.call(rawUpdates, "color");
      const hasPrevField = Object.prototype.hasOwnProperty.call(
        rawUpdates,
        "_prevColorBeforeUrgent"
      );

      // --- ID değişimi için minimal güvenlik ---
      const oldId = baseTask.id;
      let requestedNewId = oldId;
      if (Object.prototype.hasOwnProperty.call(rawUpdates, "id")) {
        const n = Number(rawUpdates.id);
        if (Number.isFinite(n)) requestedNewId = clamp(n, 1, 100);
      }

      // başka item'ta varsa iptal
      let finalNewId = oldId;
      if (requestedNewId !== oldId) {
        const exists = prevItems.some((x) => x.id === requestedNewId);
        if (!exists) finalNewId = requestedNewId;
        else {
          // çakışma -> id update'i ignore
          delete rawUpdates.id;
        }
      }

      const idChanged = finalNewId !== oldId;

      const next = prevItems.map((item) => {
        const sameBucket =
          normGroup(item.groupId) === baseGroupId && normLane(item.lane) === baseLane;

        const isTarget = item.id === taskId || (shouldBroadcast && sameBucket);
        if (!isTarget) return item;

        // seçilen item: rawUpdates'in tamamı
        if (item.id === taskId) {
          let merged = { ...item, ...rawUpdates };

          // id değişimi uygulanacaksa burada set et
          if (idChanged) merged.id = finalNewId;

          // groupName güncelle
          if (Object.prototype.hasOwnProperty.call(rawUpdates, "groupId")) {
            const g = groupsData.find((gg) => gg.id === merged.groupId);
            merged.groupName = g ? g.title : merged.groupName;
          }

          return merged;
        }

        // broadcast edilen diğer item’lar: sadece renk alanları
        let merged = { ...item };

        if (hasColorField) merged.color = rawUpdates.color;
        if (hasPrevField) merged._prevColorBeforeUrgent = rawUpdates._prevColorBeforeUrgent;

        // ✅ urgent item: görünürde kırmızı kalmalı
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

      // ✅ ID değiştiyse: dependencies & completedIds referanslarını taşı (minimum gerekli)
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

            // ✅ Eğer zaman değiştiyse, ona bağlı task'ları da güncelle
      const timeChanged =
        Object.prototype.hasOwnProperty.call(rawUpdates, "startMin") ||
        Object.prototype.hasOwnProperty.call(rawUpdates, "endMin");

      // ID değiştiyse artık movedId yeni id olmalı
      const movedId = idChanged ? finalNewId : taskId;

      let finalNext = next2;

      if (timeChanged) {
        const snapFn = (m) => Math.round(m / SNAP_MINUTES) * SNAP_MINUTES;
        finalNext = propagateDeps(finalNext, movedId, snapFn);
      }

      // modal açıkken seçilen task’i de anlık güncelle (final listeye göre)
      const selectedLookupId = movedId;
      const updatedSelected = finalNext.find((x) => x.id === selectedLookupId);
      if (selectedTask && selectedTask.id === taskId && updatedSelected) {
        setSelectedTask(updatedSelected);
      }

      return finalNext;

    });
  };

  const [nowLeft, setNowLeft] = useState(-9999);
  const [nowMin, setNowMin] = useState(null);

  // --- DROPDOWN LISTS CALCULATION ---
  const completedTasks = useMemo(() => {
    return items.filter((i) => i.completed && !i.invisible);
  }, [items]);

  const overdueTasksMemo = useMemo(() => {
  if (nowMin === null) return [];

  return items
    .filter((i) => !i.completed && !i.invisible && Number(i.endMin) <= Number(nowMin))
    .map((i) => ({
      ...i,
      absEnd: timelineStart.add(i.endMin, "minute"),
    }));
  }, [items, nowMin, timelineStart]);

  const toggleDropdown = (name) => {
    setActiveDropdown((prev) => (prev === name ? null : name));
  };

  const handleJumpToTask = (task) => {
    const taskDate = task.absEnd.startOf("day");
    if (!taskDate.isSame(selectedDate, "day")) {
      setSelectedDate(taskDate);
    }
    setIsLocked(false);
    setSelectedTask(task);
    setActiveDropdown(null);
  };

  // --- ACTIONS ---
  const toggleTaskCompletion = (taskId) => {
    if (!isAdmin) return;
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

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev * 1.25, 5));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev / 1.25, 0.5));
  const handleResetZoom = () => setZoomLevel(1);

  // --- SCROLL & LIVE ---
  const handleScroll = useCallback((e) => {
    const target = e.currentTarget;

    // --- Horizontal sync: scale <-> rows
    const x = target.scrollLeft;
    if (target === rowsWrapperRef.current && scaleWrapperRef.current) {
      scaleWrapperRef.current.scrollLeft = x;
    }
    if (target === scaleWrapperRef.current && rowsWrapperRef.current) {
      rowsWrapperRef.current.scrollLeft = x;
    }

    // --- Vertical sync: sidebar labels <-> rows
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

          if (lastNowMinRef.current !== null) {
            lastNowMinRef.current = null;
            setNowMin(null);
          }
        } else {
          const diffMins = now.diff(timelineStart, "minute", true);
          const left = diffMins * minutePx;
          setNowLeft(left);

          const m = Math.floor(diffMins);
          if (lastNowMinRef.current !== m) {
            lastNowMinRef.current = m;
            setNowMin(m);
        }

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

    // click treat
    if (Math.abs(dragState.dx) < 3) {
      const clickedItem = items.find((i) => i.id === dragState.itemId);
      if (clickedItem) {
        const absStart = timelineStart.add(clickedItem.startMin, "minute");
        const absEnd = timelineStart.add(clickedItem.endMin, "minute");
        const group = groupsData.find((g) => g.id === clickedItem.groupId);
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
      return moveDependentItems(pushed.nextItems, dragState.itemId, shiftAmount, totalMinutes);
    });

    setDragState(null);
  }, [dragState, minutePx, totalMinutes, items, timelineStart]);

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

  // drag sonrası click'i yut, popup açma
  if (suppressNextClickRef.current) {
    return;
  }

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

  const yearLabel = selectedDate.format("YYYY");
  const monthLabel = selectedDate.format("MMMM");
  const weekLabel = `Week ${selectedDate.week()}`;
  const dayLabel = selectedDate.format("DD MMM ddd");
  const hasData = items.length > 0;
  const laneHeight = 32;

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
      {selectedTask && (
        <TaskInfoModal
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onToggleComplete={toggleTaskCompletion}
          onUpdateTask={handleUpdateTask}
          isAdmin={isAdmin}
          groupsData={groupsData}
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
            handleCreateTask(merged);
          }}
          isAdmin={true}
          groupsData={groupsData}
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
            <div className="left-image-slot">
              <img
                src={img1}
                alt="IMG 1"
                className="left-image"
              />
            </div>
            <div className="left-image-slot">
              <img
                src={img2}
                alt="IMG 2"
                className="left-image"
              />
            </div>
            <div className="left-projects-label">Projects</div>
          </div>
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
                              {t.absEnd.format("MMM DD, HH:mm")}
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
                            Ended: {t.absEnd.format("MMM DD, HH:mm")}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              </div>

              <button
                onClick={() => setIsAdmin(!isAdmin)}
                style={{
                  marginRight: 10,
                  background: isAdmin ? "#e74c3c" : "#95a5a6",
                  color: "#fff",
                  border: "none",
                  padding: "4px 8px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: "bold",
                  fontSize: "0.85rem",
                }}
                title="Toggle Admin Mode"
              >
                {isAdmin ? "Admin: ON" : "Admin: OFF"}
              </button>

              {isAdmin && (
                <button
                  onClick={openCreateTask}
                  style={{
                    marginRight: 10,
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
              )}

              <div className="timeline-zoom-controls">
                <button onClick={handleZoomOut} className="zoom-btn">
                  -
                </button>
                <span className="zoom-label">{Math.round(zoomLevel * 100)}%</span>
                <button onClick={handleZoomIn} className="zoom-btn">
                  +
                </button>
                {zoomLevel !== 1 && (
                  <button className="reset-zoom-btn" onClick={handleResetZoom}>
                    Reset Zoom
                  </button>
                )}
              </div>

              <div className="timeline-live-status">
                {!isLocked && (
                  <button className="timeline-recenter-btn" onClick={handleResumeLive}>
                    Resume Live
                  </button>
                )}
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
          </div>
          <div className="timeline-header-spacer" />

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
            {groupsData.map((g) => (
              <div key={g.id} className="timeline-sidebar-row">
                {g.title}
              </div>
            ))}
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

              {groupsData.map((g) => (
                <div key={g.id} className="timeline-row">
                  <div className="timeline-lane-lines">
                    <div className="timeline-lane-line" style={{ top: laneHeight * 1 }} />
                    <div className="timeline-lane-line" style={{ top: laneHeight * 2 }} />
                    <div className="timeline-lane-line" style={{ top: laneHeight * 3 }} />
                  </div>

                  {materializedItems
                    .filter((it) => it.groupId === g.id && !it.invisible)
                    .map((it) => {
                      const start = dayjs.utc(it.start);
                      const end = dayjs.utc(it.end);

                      const baseLeft = it.startMin * minutePx;
                      const rawWidth = (it.endMin - it.startMin) * minutePx;
                      const width = Math.max(10, rawWidth);

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

                      let bgColor;
                      if (it.completed) bgColor = "#bdc3c7";
                      else if (it.urgent) bgColor = "#e74c3c";
                      else bgColor = it.color || (!it.movable ? "#777" : "#4f8df5");

                      const isConflict = conflictedIds.has(it.id);

                      const itemStyle = {
                        width: "100%",
                        background: bgColor,
                        cursor: "pointer",
                        border: it.urgent ? "2px solid #c0392b" : "none",
                      };

                      return (
                        <div
                          key={it.id}
                          className="timeline-item-wrapper"
                          style={{ left: effectiveLeft, top, width }}
                        >
                          <div
                            className={
                              "timeline-item" +
                              (!it.movable ? " timeline-item-locked" : "") +
                              (isConflict ? " timeline-item-conflict" : "")
                            }
                            style={itemStyle}
                            title={it.title}
                            onClick={(e) => handleItemClick(e, it)} 
                            onMouseDown={(e) => handleItemMouseDown(e, it, baseLeft, width)}
                          >
                            <div className="timeline-item-title">
                              {it.urgent && "⚠️ "}
                              {it.title}
                            </div>
                            <div className="timeline-item-time">
                              {start.format("HH:mm")}–{end.format("HH:mm")}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              ))}

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
