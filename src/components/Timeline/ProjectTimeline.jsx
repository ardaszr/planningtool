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

import groupsData from "../../data/groups";
import itemsByDate from "../../data/items";

import "./timeline.css";

dayjs.extend(weekOfYear);

const SIDEBAR_WIDTH = 120;
const SNAP_MINUTES = 5;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

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

/**
 * PUSH algoritması:
 * - Aynı groupId + aynı lane içinde çalışır.
 * - Sürüklenen item yeni [start,end] ile yerleştirilir.
 * - Sonrasında, sıradaki movable item'lar çakışıyorsa sağa itilir.
 * - Locked item'a çarparsa "blocked" döner -> drop iptal edilir.
 */
function pushWithinSameLane({ items, draggedId, newStartMin, snap = SNAP_MINUTES }) {
  const dragged = items.find((x) => x.id === draggedId);
  if (!dragged) return { ok: false, blocked: true, nextItems: items };

  const groupId = dragged.groupId;
  const lane = dragged.lane ?? 0;
  const duration = dragged.endMin - dragged.startMin;

  let startMin = newStartMin;
  startMin = Math.round(startMin / snap) * snap;
  let endMin = startMin + duration;

  // sınırlar
  if (startMin < 0) {
    startMin = 0;
    endMin = duration;
  }
  if (endMin > 1440) {
    endMin = 1440;
    startMin = 1440 - duration;
  }

  const bucket = items
    .filter((x) => x.groupId === groupId && (x.lane ?? 0) === lane)
    .sort((a, b) => a.startMin - b.startMin);

  const others = bucket.filter((x) => x.id !== draggedId);

  const updated = new Map(items.map((x) => [x.id, { ...x }]));
  updated.set(draggedId, { ...dragged, startMin, endMin });

  let cursorEnd = endMin;
  const after = others.filter((x) => x.startMin >= dragged.startMin);

  for (const it of after) {
    const current = updated.get(it.id);

    if (current.startMin < cursorEnd) {
      if (!current.movable) {
        return { ok: false, blocked: true, nextItems: items };
      }

      const dur = current.endMin - current.startMin;

      let ns = cursorEnd;
      ns = Math.round(ns / snap) * snap;
      let ne = ns + dur;

      if (ne > 1440) {
        return { ok: false, blocked: true, nextItems: items };
      }

      updated.set(it.id, { ...current, startMin: ns, endMin: ne });
      cursorEnd = ne;
    } else {
      cursorEnd = Math.max(cursorEnd, current.endMin);
    }
  }

  const nextItems = items.map((x) => updated.get(x.id) || x);
  return { ok: true, blocked: false, nextItems };
}

const ProjectTimeline = () => {
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [clock, setClock] = useState(dayjs().format("HH:mm:ss"));
  const [dragState, setDragState] = useState(null);

  const scaleWrapperRef = useRef(null);
  const rowsWrapperRef = useRef(null);

  const timelineStart = useMemo(() => selectedDate.startOf("day"), [selectedDate]);
  const timelineEnd = useMemo(() => timelineStart.add(1, "day"), [timelineStart]);

  const selectedKey = useMemo(() => timelineStart.format("YYYY-MM-DD"), [timelineStart]);

  const itemsForDay = useMemo(() => {
    const arr = itemsByDate[selectedKey];
    return Array.isArray(arr) ? arr : [];
  }, [selectedKey]);

  const [items, setItems] = useState(itemsForDay);

  useEffect(() => {
    setItems(itemsForDay);
    setDragState(null);
    if (rowsWrapperRef.current) rowsWrapperRef.current.scrollLeft = 0;
    if (scaleWrapperRef.current) scaleWrapperRef.current.scrollLeft = 0;
  }, [itemsForDay]);

  // fit 24h
  const [minutePx, setMinutePx] = useState(1);

  useLayoutEffect(() => {
    const update = () => {
      const viewport = Math.max(320, window.innerWidth - SIDEBAR_WIDTH - 2);
      setMinutePx(viewport / (24 * 60));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const totalMinutes = timelineEnd.diff(timelineStart, "minute"); // 1440
  const timelineWidth = totalMinutes * minutePx;

  // now line + bubble
  const [nowLeft, setNowLeft] = useState(-9999);
  const [nowLabel, setNowLabel] = useState("");

  useEffect(() => {
    const updateNow = () => {
      const now = dayjs();
      const isToday = now.isSame(timelineStart, "day");
      if (!isToday) {
        setNowLeft(-9999);
        setNowLabel("");
        return;
      }

      const left = clamp(now.diff(timelineStart, "minute") * minutePx, 0, timelineWidth);
      setNowLeft(left);
      setNowLabel(now.format("HH:mm"));
    };

    updateNow();
    const id = setInterval(updateNow, 1000);
    return () => clearInterval(id);
  }, [timelineStart, minutePx, timelineWidth]);

  // live clock
  useEffect(() => {
    const id = setInterval(() => setClock(dayjs().format("HH:mm:ss")), 1000);
    return () => clearInterval(id);
  }, []);

  // scroll sync
  const handleRowsScroll = (e) => {
    if (scaleWrapperRef.current) {
      scaleWrapperRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  // day strip
  const dayStrip = useMemo(() => {
    const center = selectedDate.startOf("day");
    const arr = [];
    for (let i = -2; i <= 6; i++) arr.push(center.add(i, "day"));
    return arr;
  }, [selectedDate]);

  /**
   * Crisp alignment:
   * - thin (1px): x rounded + 0.5 --  buçuklar için
   * - bold (2px): x rounded -- tam saatler için
   */
  const crispLeft = useCallback((x, isBold) => {
    const r = Math.round(x);
    return isBold ? r : r + 0.5;
  }, []);

  /**
   * Cetvel
   */
  const ticks = useMemo(() => {
    const arr = [];
    for (let m = 0; m < 24 * 60; m += 5) {
      const x = m * minutePx;

      let kind = "minor";
      if (m % 60 === 0) kind = "major";       
      else if (m % 60 === 30) kind = "half";  
      else if (m % 15 === 0) kind = "quarter";

      const isBold = kind === "major" || kind === "half";
      arr.push({ m, left: crispLeft(x, isBold), kind });
    }
    return arr;
  }, [minutePx, crispLeft]);

  /**
   * Saat label’ları:
   * - 00:00 ... 23:00 
   */
  const hourLabels = useMemo(() => {
    const arr = [];
    for (let h = 0; h <= 23; h++) {
      const m = h * 60;
      const x = m * minutePx;
      const left = crispLeft(x, true);
      const label = dayjs().startOf("day").add(m, "minute").format("HH:mm");
      arr.push({ h, left, label });
    }
    return arr;
  }, [minutePx, crispLeft]);

  const majorGridlines = useMemo(() => {
    const arr = [];
    for (let h = 0; h <= 23; h++) {
      const x = h * 60 * minutePx;
      arr.push({ h, left: crispLeft(x, false) });
    }
    return arr;
  }, [minutePx, crispLeft]);

  // Lane düzeni
  const laneHeight = 32;

  // ISO for display
  const materializedItems = useMemo(() => {
    return items.map((it) => ({
      ...it,
      start: timelineStart.add(it.startMin, "minute").toISOString(),
      end: timelineStart.add(it.endMin, "minute").toISOString(),
    }));
  }, [items, timelineStart]);

  // preview items (drag esnası)
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
    if (newEndMin > 1440) {
      newEndMin = 1440;
      newStartMin = 1440 - duration;
    }

    return items.map((x) =>
      x.id === dragged.id ? { ...x, startMin: newStartMin, endMin: newEndMin } : x
    );
  }, [dragState, items, minutePx]);

  const conflictedIds = useMemo(() => computeConflicts(previewItems), [previewItems]);

  // ---- DRAG ----
  const handleMouseMove = useCallback(
    (e) => {
      if (!dragState) return;

      const dx = e.clientX - dragState.startMouseX;
      let newLeft = dragState.initialLeft + dx;

      const maxLeft = timelineWidth - dragState.width;
      newLeft = clamp(newLeft, 0, maxLeft);

      setDragState((prev) => (prev ? { ...prev, dx: newLeft - dragState.initialLeft } : prev));
    },
    [dragState, timelineWidth]
  );

  const handleMouseUp = useCallback(() => {
    if (!dragState) return;

    const finalLeft = dragState.initialLeft + dragState.dx;
    let newStartMin = Math.round(finalLeft / minutePx);
    newStartMin = Math.round(newStartMin / SNAP_MINUTES) * SNAP_MINUTES;

    setItems((prev) => {
      const item = prev.find((i) => i.id === dragState.itemId);
      if (!item || !item.movable) return prev;

      // push uygula
      const pushed = pushWithinSameLane({
        items: prev,
        draggedId: dragState.itemId,
        newStartMin,
        snap: SNAP_MINUTES,
      });

      // locked'a çarptıysa iptal
      if (!pushed.ok || pushed.blocked) return prev;

      // conflict varsa iptal
      const conflictsAfterDrop = computeConflicts(pushed.nextItems);
      if (conflictsAfterDrop.size > 0) return prev;

      // bugünse geçmişe atma + now çizgisini kesme kontrolü (dragged için)
      const now = dayjs();
      const isToday = now.isSame(timelineStart, "day");
      if (isToday) {
        const nowMin = now.diff(timelineStart, "minute");

        const draggedAfter = pushed.nextItems.find((x) => x.id === dragState.itemId);
        if (!draggedAfter) return prev;

        if (draggedAfter.endMin < nowMin) return prev;

        if (draggedAfter.startMin < nowMin && draggedAfter.endMin > nowMin) {
          const repush = pushWithinSameLane({
            items: prev,
            draggedId: dragState.itemId,
            newStartMin: Math.round(nowMin / SNAP_MINUTES) * SNAP_MINUTES,
            snap: SNAP_MINUTES,
          });

          if (!repush.ok || repush.blocked) return prev;
          const c2 = computeConflicts(repush.nextItems);
          if (c2.size > 0) return prev;

          return repush.nextItems;
        }
      }

      return pushed.nextItems;
    });

    setDragState(null);
  }, [dragState, minutePx, timelineStart]);

  const handleItemMouseDown = (e, it, baseLeft, width) => {
    if (!it.movable) return;

    e.preventDefault();
    e.stopPropagation();

    setDragState({
      itemId: it.id,
      startMouseX: e.clientX,
      initialLeft: baseLeft,
      dx: 0,
      width,
    });
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

  const yearLabel = timelineStart.format("YYYY");
  const monthLabel = timelineStart.format("MMMM");
  const weekLabel = `Week ${timelineStart.week()}`;
  const dayLabel = timelineStart.format("DD MMM ddd");

  const hasData = items.length > 0;

  return (
    <div className="timeline-root">
      <div className="timeline-header">
        <div className="timeline-sidebar-header">Projects</div>

        <div className="timeline-header-main">
          <div className="timeline-date-header">
            <span className="timeline-date-year">{yearLabel}</span>
            <span>{monthLabel}</span>
            <span>{weekLabel}</span>
            <span>{dayLabel}</span>

            <span className="timeline-date-spacer" />
            <span className="timeline-live-clock">{clock}</span>
          </div>

          <div className="timeline-day-strip">
            <button
              className="timeline-day-nav"
              onClick={() => setSelectedDate((d) => d.subtract(7, "day"))}
              title="Previous"
            >
              ◀
            </button>

            <div className="timeline-day-strip-inner">
              {dayStrip.map((d) => {
                const isSel = d.isSame(selectedDate, "day");
                return (
                  <button
                    key={d.format("YYYY-MM-DD")}
                    className={"timeline-day" + (isSel ? " is-selected" : "")}
                    onClick={() => setSelectedDate(d)}
                    title={d.format("DD MMM YYYY")}
                  >
                    <div className="timeline-day-dow">{d.format("ddd")}</div>
                    <div className="timeline-day-dom">{d.format("D")}</div>
                  </button>
                );
              })}
            </div>

            <button
              className="timeline-day-nav"
              onClick={() => setSelectedDate((d) => d.add(7, "day"))}
              title="Next"
            >
              ▶
            </button>
          </div>

          <div className="timeline-scale-wrapper" ref={scaleWrapperRef}>
            <div className="timeline-ruler" style={{ width: timelineWidth }}>
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
                    transform: h.h === 0 ? "translateX(0%)" : "translateX(-50%)",
                  }}
                >
                  {h.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className="timeline-empty">No events for {selectedKey}</div>
      ) : (
        <div className="timeline-body">
          <div className="timeline-sidebar">
            {groupsData.map((g) => (
              <div key={g.id} className="timeline-sidebar-row">
                {g.title}
              </div>
            ))}
          </div>

          <div
            className="timeline-rows-wrapper"
            ref={rowsWrapperRef}
            onScroll={handleRowsScroll}
          >
            <div className="timeline-rows" style={{ width: timelineWidth }}>
              <div className="timeline-gridlines">
                {majorGridlines.map((gl) => (
                  <div
                    key={gl.h}
                    className="timeline-gridline"
                    style={{ left: gl.left }}
                  />
                ))}
              </div>

              {groupsData.map((g) => (
                <div key={g.id} className="timeline-row">
                  {/* lane separator çizgileri */}
                  <div className="timeline-lane-lines">
                    <div className="timeline-lane-line" style={{ top: laneHeight * 1 }} />
                    <div className="timeline-lane-line" style={{ top: laneHeight * 2 }} />
                    <div className="timeline-lane-line" style={{ top: laneHeight * 3 }} />
                  </div>

                  {materializedItems
                    .filter((it) => it.groupId === g.id)
                    .map((it) => {
                      const start = dayjs(it.start);
                      const end = dayjs(it.end);

                      const baseLeft = start.diff(timelineStart, "minute") * minutePx;

                      // min width -> sürükleme/klik alanı kaybolmasın
                      const rawWidth = end.diff(start, "minute") * minutePx;
                      const width = Math.max(10, rawWidth);

                      const lane = it.lane ?? 0;
                      const top = lane * laneHeight; // boşluksuz oturur

                      let effectiveLeft = baseLeft;
                      if (dragState && dragState.itemId === it.id) {
                        const previewLeft = dragState.initialLeft + dragState.dx;
                        const previewMin = Math.round(previewLeft / minutePx);
                        const snappedMin =
                          Math.round(previewMin / SNAP_MINUTES) * SNAP_MINUTES;
                        effectiveLeft = snappedMin * minutePx;
                      }

                      const bgColor = it.color || (!it.movable ? "#777" : "#4f8df5");
                      const isConflict = conflictedIds.has(it.id);

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
                            style={{ width: "100%", background: bgColor }}
                            title={it.title}
                            onMouseDown={(e) => handleItemMouseDown(e, it, baseLeft, width)}
                          >
                            <div className="timeline-item-title">{it.title}</div>
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
              {nowLeft >= 0 && nowLabel ? (
                <div className="timeline-now-bubble" style={{ left: nowLeft }}>
                  {nowLabel}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProjectTimeline;
