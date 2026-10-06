import React, { useState, useRef, useEffect } from "react";
import { CATEGORY_ICONS, byPriorityThenOrder } from "../utils/taskOps";
import { getFocusWindows } from "../utils/focusWindows";
import { useLociDayStr } from "../hooks/useTodayStr";
import { horizonsFromConfig, WORK_OLDER_ID } from "../utils/horizons";
import { leftoverTags, pendingReviews, applySort, undoReviewOrSort } from "../utils/horizonReview";
import HorizonReview from "./HorizonReview";
import { dayLabel, doneTasks, horizonChoices, isOpenPlanTask, ladderRungs, listTasks, openingRung, runwayLayout, runwayTicks, workOlderCount } from "../utils/planLadder";
import useTaskActions from "../hooks/useTaskActions";
import {
  DndContext, closestCenter, MouseSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, DragOverlay
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import LinkifyText from "./LinkifyText";
import TaskDetail, { formatEstimate } from "./TaskDetail";
import UndoToast, { UndoAnnouncer } from "./ui/UndoToast";
import { IconChevronLeft, IconChevronRight, IconPin, IconPlus } from "./ui/icons";
import { commitmentKickerFront, frontForCommitment, frontsFromConfig, frontsOnOffer } from "../utils/fronts";
import { cssZoom, unzoomTransform } from "../utils/cssZoom";

// A horizon row (45h, 52h): the circle marks it done; the title; then a pin
// if it is pinned, GOAL, and priority · estimate · front, whatever is set
// (the front truncates first). The row opens the task. Drag: by the grip on
// a laptop (shown on hover and focus), by a long press on touch, or by the
// whole row in Drag anywhere mode.
function SortableRoadmapCard({ id, task, onTaskClick, onDone, isGoal = false, frontName = null, fromTag = null, interactionStyle = "classic", isOpen = false }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const isDragAnywhere = interactionStyle === "dragAnywhere";
  const estimate = Number(task.timeEstimateMinutes) > 0 ? formatEstimate(task.timeEstimateMinutes) : null;
  const figures = [task.priority || "P3", estimate].filter(Boolean).join(" · ");
  // Classic: the mouse and the keyboard drag by the grip; touch by holding
  // the row, since the grip only shows on hover.
  const { onTouchStart, ...gripListeners } = listeners || {};
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(unzoomTransform(transform)),
        transition,
        opacity: isDragging ? 0.35 : 1, // 57c: its place fades
        position: "relative",
      }}
    >
      <div
        ref={isDragAnywhere ? setActivatorNodeRef : undefined}
        className={`roadmap-task-card plan-row${isDragAnywhere ? " is-drag-anywhere" : ""}${isOpen ? " is-open" : ""}`}
        data-task-uuid={task.uuid}
        onClick={() => onTaskClick(task)}
        {...(isDragAnywhere ? {
          ...listeners,
          // As in Today's list: Enter opens the row; Space picks it up.
          onKeyDown: e => {
            if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); onTaskClick(task); return; }
            listeners?.onKeyDown?.(e);
          },
          tabIndex: attributes?.tabIndex,
          "aria-disabled": attributes?.["aria-disabled"],
          "aria-describedby": attributes?.["aria-describedby"],
        } : {
          onTouchStart,
          tabIndex: 0,
          role: "button",
          "aria-label": `Open: ${task.title}`,
          onKeyDown: e => {
            if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
            e.preventDefault();
            onTaskClick(task);
          },
        })}
      >
        {!isDragAnywhere && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...gripListeners}
            {...attributes}
            className="plan-row-grip"
            onClick={e => e.stopPropagation()}
            aria-label={`Drag to reorder: ${task.title}`}
          >
            ⠿
          </button>
        )}
        {onDone && (
          <button
            type="button"
            className="plan-row-circle"
            aria-label={`Mark done: ${task.title}`}
            onClick={e => { e.stopPropagation(); onDone(task); }}
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
          >
            <span aria-hidden="true" />
          </button>
        )}
        <span className="plan-row-body">
          <span className="roadmap-task-title plan-row-title">
            <LinkifyText text={task.title} />
          </span>
          <span className="plan-row-meta">
            {task.isHorizonPinned && <span className="plan-row-pin" role="img" aria-label="Pinned to top"><IconPin size={14} /></span>}
            {isGoal && <span className="task-tag is-goal">GOAL</span>}
            <span className="plan-row-figures">{figures}</span>
            {frontName && <span className="plan-row-figures plan-row-front">· {frontName}</span>}
            {/* 57b.21: a leftover waiting for its review wears its period. */}
            {fromTag && <span className="task-tag plan-row-from">{fromTag}</span>}
          </span>
        </span>
        {isDragAnywhere && (
          <button
            type="button"
            className="task-row-kebab-btn"
            onClick={e => { e.stopPropagation(); onTaskClick(task); }}
            onMouseDown={e => e.stopPropagation()}
            onTouchStart={e => e.stopPropagation()}
            aria-label="Task options"
            title="Task options"
          >⋮</button>
        )}
      </div>
    </div>
  );
}

// fullColTasks: the whole horizon when colTasks is a front's share of it.
// 57c: a row dropped on a rung moves there. The rungs sit outside this
// list's drag context, so the rung under the pointer is looked up where the
// drag is (mouse or touch; the keyboard moves with the sheet's picker).
// 76: the pointer is read where it is, not rebuilt from the drag's start and
// delta: dnd-kit's delta counts the scroll of the list's own column (which
// scrolls on its own on a laptop), and would land beside the rung.
let lastPointer = null;
const trackPointer = (e) => {
  const p = e.touches?.[0] || e;
  if (typeof p?.clientX === "number") lastPointer = { x: p.clientX, y: p.clientY };
};
function rungUnderPointer({ activatorEvent, delta }) {
  const start = activatorEvent?.touches?.[0] || activatorEvent?.changedTouches?.[0] || activatorEvent;
  const at = lastPointer || (start && typeof start.clientX === "number" ? { x: start.clientX + delta.x, y: start.clientY + delta.y } : null);
  if (!at || typeof document.elementsFromPoint !== "function") return null;
  const hit = document.elementsFromPoint(at.x, at.y).find(el => el.closest?.(".plan-rung[data-drop]"));
  return hit ? hit.closest(".plan-rung").dataset.horizon : null;
}

function SortableRoadmapList({ colKey, colTasks, fullColTasks = colTasks, tasks, payload, savePayload, onTaskClick, onDone, isGoal = () => false, frontNameOf = () => null, leftTags = null, openUuid = null, onRungHover, onDropOnRung }) {
  const interactionStyle = payload?.config?.taskRowInteractionStyle === "dragAnywhere" ? "dragAnywhere" : "classic";
  const [activeId, setActiveId] = useState(null);
  const getKey = (t) => t.uuid || String(t.id);
  const ids = colTasks.map(getKey);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const stopTracking = () => {
    window.removeEventListener("pointermove", trackPointer, true);
    window.removeEventListener("touchmove", trackPointer, true);
    lastPointer = null;
  };
  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveId(null);
    const rung = onDropOnRung ? rungUnderPointer(event) : null;
    stopTracking();
    if (rung) {
      onRungHover?.(null);
      const task = colTasks.find(t => getKey(t) === active.id);
      if (task) onDropOnRung(task, rung);
      return;
    }
    onRungHover?.(null);
    if (!over || active.id === over.id) return;
    const oldIdx = colTasks.findIndex(t => getKey(t) === active.id);
    const newIdx = colTasks.findIndex(t => getKey(t) === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    // colTasks is already pin-sorted-first; reordering across the whole column
    // would overwrite the *other* pin tier's orderIndex on every drag (its tasks
    // didn't move but would still get renumbered). Scope the reorder to tasks
    // sharing the dragged task's pin status, and no-op a drag across the
    // pin/unpinned boundary — pin status alone decides that ordering, not orderIndex.
    const draggedPinned = !!colTasks[oldIdx].isHorizonPinned;
    if (!!colTasks[newIdx].isHorizonPinned !== draggedPinned) return;
    // Renumber the whole horizon's tier, not only the rows on screen: on a
    // front's page the horizon's other tasks keep their places around it.
    const tier = fullColTasks.filter(t => !!t.isHorizonPinned === draggedPinned);
    const tierOldIdx = tier.findIndex(t => getKey(t) === active.id);
    const tierNewIdx = tier.findIndex(t => getKey(t) === over.id);
    const reordered = arrayMove([...tier], tierOldIdx, tierNewIdx);
    const orderMap = new Map(reordered.map((t, i) => [getKey(t), i]));
    savePayload({ ...payload, tasks: tasks.map(t =>
      orderMap.has(getKey(t)) ? { ...t, orderIndex: orderMap.get(getKey(t)), lastUpdated: Date.now() } : t
    )});
  };

  if (colTasks.length === 0) {
    return <div className="roadmap-empty-state plan-empty">Nothing here yet.</div>;
  }

  const activeTask = activeId ? colTasks.find(t => getKey(t) === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active, activatorEvent }) => {
        setActiveId(active.id);
        if (onDropOnRung) {
          lastPointer = null;
          trackPointer(activatorEvent || {});
          window.addEventListener("pointermove", trackPointer, true);
          window.addEventListener("touchmove", trackPointer, { capture: true, passive: true });
        }
      }}
      onDragMove={onDropOnRung ? (e) => onRungHover?.(rungUnderPointer(e)) : undefined}
      onDragEnd={handleDragEnd}
      onDragCancel={() => { setActiveId(null); onRungHover?.(null); stopTracking(); }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {colTasks.map(task => (
          <SortableRoadmapCard
            key={getKey(task)}
            id={getKey(task)}
            task={task}
            onTaskClick={onTaskClick}
            onDone={onDone}
            isGoal={isGoal(task)}
            frontName={frontNameOf(task)}
            fromTag={leftTags?.get(task.uuid) || null}
            interactionStyle={interactionStyle}
            isOpen={task.uuid === openUuid}
          />
        ))}
      </SortableContext>
      <DragOverlay dropAnimation={null} style={{ zoom: 1 / cssZoom() }}>
        {activeTask ? (
          <div style={{
            zoom: cssZoom(),
            background: "var(--bg-card)",
            border: "1.5px solid var(--accent)",
            borderRadius: "10px",
            padding: "10px 12px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
            transform: "rotate(-1.2deg) scale(1.02)",
            opacity: 0.95,
            fontSize: "13px",
            fontWeight: "700",
            color: "var(--text-primary)"
          }}>
            {activeTask.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// frontId: a front's page (52f–g) — only that front's open tasks, in the
// horizons that hold any, with no per-horizon + and no Inbox.
// Plan 57, 76: the runway — a 4px line from today to the furthest horizon's
// end on a square-root scale, the open horizon's stretch in green, a dot at
// today, a tick per end date with its name above and date below. Labels are
// measured and merge or drop where they'd collide (planLadder's
// runwayLayout); an unlabelled tick tells its name on hover or focus.
// Clicking a tick or a name opens that horizon.
const NAME_FONT = "800 14px Manrope, system-ui, sans-serif";
const DATE_FONT = "700 12.5px 'Space Mono', ui-monospace, monospace";
let measureCtx = null;
const textWidth = (font, spacingEm = 0, size = 0) => (text) => {
  measureCtx = measureCtx || (typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null);
  if (!measureCtx) return text.length * 8;
  measureCtx.font = font;
  return measureCtx.measureText(text).width + spacingEm * size * text.length;
};
const nameWidth = textWidth(NAME_FONT);
const dateWidth = textWidth(DATE_FONT, 0.08, 12.5);

function Runway({ rungs, day, phone, openId, onPick }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  const [, setFontsReady] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.getBoundingClientRect().width / cssZoom());
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    // The labels are measured in the page's fonts: once they've loaded.
    document.fonts?.ready?.then(() => setFontsReady(true));
    return () => ro?.disconnect();
  }, []);
  const ticks = runwayTicks(rungs, day);
  const { labels, unlabelled } = runwayLayout(ticks, { width, nameWidth, dateWidth, todayDate: dayLabel(day, day), openId, phone });
  const openTick = !phone && ticks.find(t => t.ids.includes(openId));
  const nameOf = (id) => rungs.find(r => r.id === id)?.name || id;
  return (
    <div className="plan-runway" ref={ref} role="group" aria-label="Runway">
      <span className="plan-runway-line" />
      {openTick && <span className="plan-runway-stretch" style={{ width: `${openTick.at * 100}%` }} />}
      <span className="plan-runway-dot" />
      {ticks.map(t => {
        const open = !phone && t.ids.includes(openId);
        const tip = `${t.names.join(" · ")} · ${t.date}`;
        const bare = unlabelled.has(t.end);
        return (
          <button
            key={t.end}
            type="button"
            className={`plan-runway-tick${open ? " is-open" : ""}${t.furthest ? " is-far" : ""}`}
            style={{ left: `${t.at * 100}%` }}
            aria-label={`Open ${t.names.join(" and ")}, ends ${t.date}`}
            data-tip={bare ? tip : undefined}
            tabIndex={bare ? 0 : -1}
            onClick={() => onPick(t.ids.includes(openId) ? openId : t.ids[0])}
          />
        );
      })}
      {labels.map(l => (
        <span
          key={l.key}
          className={`plan-runway-label${l.key === "today" ? " is-today" : ""}${l.open ? " is-open" : ""}`}
          style={{ left: `${l.left}px`, width: `${l.right - l.left}px` }}
          data-align={l.align}
        >
          <span className="plan-runway-name">
            {l.key === "today" ? "Today" : l.ids.map((id, i) => (
              <React.Fragment key={id}>
                {i > 0 && " · "}
                <button type="button" className="plan-runway-pick" onClick={() => onPick(id)}>{nameOf(id)}</button>
              </React.Fragment>
            ))}
          </span>
          <span className="plan-runway-date">{l.date}</span>
        </span>
      ))}
    </div>
  );
}

// 42.1: the rung Plan opens on is remembered on this device.
const RUNG_KEY = "loci_plan_rung";
const readRung = () => { try { return localStorage.getItem(RUNG_KEY); } catch { return null; } };
const writeRung = (id) => { try { localStorage.setItem(RUNG_KEY, id); } catch { /* private mode */ } };

export default function RoadmapTab({ payload, savePayload, savePayloadAsync, onOpenAddTask, uid, writeActivityEvents, focusTimer = {}, frontId = null, frontsColumn = null, frontOpen = false, onCloseFront, onOpenReview }) {
  const { tasks = [], config = {} } = payload;
  const windows = getFocusWindows(config);

  // Plan 57 (7b): the ladder — a rung per horizon, the open one's list beside
  // it. A front's page (frontId) keeps its horizon sections.
  const lociDay = useLociDayStr(windows);
  const rungs = ladderRungs(tasks, horizonsFromConfig(config, lociDay), lociDay);
  const olderCount = workOlderCount(tasks);
  // 57f: leftovers waiting for review — a note on their rung, a tag on
  // their rows (57b.21).
  const reviews = frontId ? [] : pendingReviews(config, tasks, lociDay);
  const leftTags = leftoverTags(reviews);
  const [sorting, setSorting] = useState(false);
  const [sortUndo, setSortUndo] = useState(null);
  const [rung, setRung] = useState(() => readRung());
  const selected = rung === WORK_OLDER_ID && olderCount > 0 ? WORK_OLDER_ID : openingRung(rungs, rung === WORK_OLDER_ID ? null : rung);
  const selectedRung = rungs.find(r => r.id === selected) || null;
  // A phone (57d–e): the ladder is the page; a rung pushes its list.
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 600);
  useEffect(() => {
    const update = () => setNarrow(window.innerWidth < 600);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const [phoneList, setPhoneList] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  // 57c: the rung a dragged row is over. Not on a phone, where the list
  // hides the ladder: there the sheet's picker moves a task (43.1).
  const [dropRung, setDropRung] = useState(null);
  // ≥1600 a rung closes a front's page shown in the list's place (57b.25).
  const pickRung = (id) => { setRung(id); writeRung(id); setPhoneList(true); setDoneOpen(false); onCloseFront?.(); };

  // 45h: the four horizons, always shown. Work (the older horizon) is shown
  // only while it holds tasks, so none of them is lost from view.
  // A front's page: every visible horizon, yours too (Codex review of #443),
  // then Work · older while it holds tasks (52), with no +.
  const columns = [
    ...rungs.map(r => ({ key: r.id, label: r.name })),
    { key: "office",   label: "Work · older", onlyWithTasks: true, noAdd: true },
  ];

  // A task, opened (52h): the same sheet as Today's, with Plan's footer.
  const [detailUuid, setDetailUuid] = useState(null);
  // The one Undo toast (done, delete, park, today, step), as on Today.
  const {
    undo, setUndo, undoText, handleUndo,
    patchTask, handleMoveToToday, handleChangeHorizon, handleTogglePin, handlePark,
    handleSetSteps, handleMarkDone, handleDelete,
  } = useTaskActions({ payload, savePayload, savePayloadAsync, uid, writeActivityEvents, focusTimer });
  const [drawerViewport, setDrawerViewport] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1024);
  useEffect(() => {
    const update = () => setDrawerViewport(window.innerWidth >= 1024);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  // Undo and a review's sort read the latest payload, not this render's.
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const openTask = (task) => setDetailUuid(task.uuid);

  const isVisibleRoadmapTask = (t) => !t.isDeleted && !t.isCompleted && !t.isParked;

  // GOAL: the same rule as Today's rows — the front the wall's kicker names.
  const fronts = frontsFromConfig(config);
  const goalFront = commitmentKickerFront(frontForCommitment(tasks.find(t => t.isNowFocus && !t.isDeleted && !t.isCompleted), fronts), config);
  const isGoal = (task) => !!goalFront && task.frontId === goalFront.id;
  // A front's page names the front once, in its title, not on every row.
  const frontNameOf = (task) => (frontId ? null : fronts.find(f => f.id === task.frontId)?.name || null);

  const shownColumns = frontId
    ? columns
      .map(col => {
        const all = tasks.filter(t => t.horizonLevel === col.key && isVisibleRoadmapTask(t)).sort(byPriorityThenOrder);
        return { ...col, allTasks: all, tasks: all.filter(t => t.frontId === frontId) };
      })
      .filter(col => col.tasks.length > 0)
    // The ladder shows one list: the open rung's, pinned first then your
    // order (42.4).
    : [{
      key: selected,
      label: selected === WORK_OLDER_ID ? "Work · older" : selectedRung?.name || "",
      noAdd: selected === WORK_OLDER_ID,
      allTasks: listTasks(tasks, selected),
      tasks: listTasks(tasks, selected),
    }];
  const detailCol = detailUuid ? shownColumns.find(col => col.tasks.some(t => t.uuid === detailUuid)) : null;
  const detailTask = detailCol ? detailCol.tasks.find(t => t.uuid === detailUuid) : null;
  const detailIndex = detailTask ? detailCol.tasks.indexOf(detailTask) : -1;
  // Moved to another horizon: the ladder opens that rung, so the sheet
  // follows it. Done, moved to Today, parked or deleted: it left Plan, so
  // the sheet closes.
  const movedTo = !frontId && detailUuid && !detailTask
    ? tasks.find(t => t.uuid === detailUuid && isOpenPlanTask(t) && (t.horizonLevel === WORK_OLDER_ID || rungs.some(r => r.id === t.horizonLevel)))?.horizonLevel
    : null;
  useEffect(() => {
    if (movedTo) { setRung(movedTo); writeRung(movedTo); return; }
    if (detailUuid && !detailTask) setDetailUuid(null);
  }, [detailUuid, detailTask, movedTo]);
  const focusRow = (uuid) => requestAnimationFrame(() => document.querySelector(`.roadmap-container [data-task-uuid="${uuid}"]`)?.focus());
  const closeDetail = () => { const back = detailUuid; setDetailUuid(null); if (back) focusRow(back); };
  // An action that takes the task out of Plan: focus goes to its neighbour
  // in the horizon, as on Today.
  const leaving = (task, act) => {
    const col = detailCol?.tasks || [];
    const i = col.findIndex(t => t.uuid === task.uuid);
    const next = col[i + 1] || col[i - 1];
    act(task);
    if (next) focusRow(next.uuid);
  };
  // The drawer's keys (50b): ↑/↓ move through the horizon, Esc closes and
  // hands focus back to the row.
  const onDetailKeyDown = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !detailTask) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeDetail(); return; }
    const el = e.target;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    const next = dir && detailCol.tasks[detailIndex + dir];
    if (!next) return;
    e.preventDefault();
    setDetailUuid(next.uuid);
  };

  return (
    <div className={`roadmap-container ${frontId ? "plan-front-tasks" : "plan-horizons-view"}`}>
      {frontId && shownColumns.length === 0 && <p className="plan-empty">Nothing open on this front.</p>}
      {frontId ? (
      <div className="plan-horizons">
        {shownColumns.map(col => {
          const colTasks = col.tasks;
          return (
            <section key={col.key} className="plan-horizon" aria-labelledby={`plan-h-${col.key}`}>
              <div className="plan-horizon-head">
                <h3 className="plan-horizon-name" id={`plan-h-${col.key}`}>
                  {col.label} <span className="plan-horizon-count">{colTasks.length}</span>
                </h3>
                {!col.noAdd && !frontId && (
                  <button type="button" className="plan-horizon-add" onClick={() => onOpenAddTask(col.key)} aria-label={`Add a task to ${col.label}`}>
                    <IconPlus size={20} />
                  </button>
                )}
              </div>
              <SortableRoadmapList
                colKey={col.key}
                colTasks={colTasks}
                fullColTasks={col.allTasks}
                tasks={tasks}
                payload={payload}
                savePayload={savePayload}
                onTaskClick={openTask}
                onDone={handleMarkDone}
                isGoal={isGoal}
                frontNameOf={frontNameOf}
                openUuid={detailUuid}
              />
            </section>
          );
        })}
      </div>
      ) : (
        <>
          <Runway rungs={rungs} day={lociDay} phone={narrow} openId={frontOpen || narrow ? null : selected} onPick={pickRung} />
          <div className={`plan-ladder-grid${narrow ? " is-phone" : ""}${narrow && phoneList ? " is-list" : ""}${frontsColumn ? " has-fronts" : ""}`}>
            {/* 57a–e: a rung per horizon — name and open count, its end and
                days left, the bar of the period gone (red at ≤3 days left). */}
            <nav className="plan-ladder" aria-label="Horizons">
              {rungs.map(r => (
                <button
                  key={r.id}
                  type="button"
                  data-horizon={r.id}
                  data-drop={!narrow && r.id !== selected ? "" : undefined}
                  className={`plan-rung${r.id === selected && !frontOpen && !narrow ? " is-open" : ""}${r.red ? " is-red" : ""}${r.dotted ? " is-dotted" : ""}${dropRung === r.id ? " is-drop" : ""}`}
                  aria-current={r.id === selected && !frontOpen ? "true" : undefined}
                  onClick={() => pickRung(r.id)}
                >
                  <span className="plan-rung-top">
                    <span className="plan-rung-name">{r.name}</span>
                    <span className="plan-rung-count">{r.count}</span>
                  </span>
                  {/* 76: the end on the left, what's left on the right; 6 months
                      slides, so it has no end and no bar. */}
                  <span className="plan-rung-date">
                    <span className="plan-rung-ends">{r.dotted ? `TO ${dayLabel(r.period.end, lociDay).replace(/^[A-Z]{3} /, "")}` : `ENDS ${dayLabel(r.period.end, lociDay)}`}</span>
                    <span className="plan-rung-left">{r.dotted ? "SLIDES MONTHLY" : `${r.daysLeft} ${r.daysLeft === 1 ? "DAY" : "DAYS"} LEFT`}</span>
                  </span>
                  {!r.dotted && <span className="plan-rung-bar"><span style={{ width: `${Math.round(r.elapsed * 100)}%` }} /></span>}
                  {(() => {
                    const rv = reviews.find(x => x.id === r.id);
                    return rv && <span className="plan-rung-review">{rv.tasks.length} FROM {rv.from} · REVIEW</span>;
                  })()}
                  <span className="plan-rung-chevron" aria-hidden="true"><IconChevronRight size={18} /></span>
                  {dropRung === r.id && <span className="plan-rung-drop">Drop to move here</span>}
                </button>
              ))}
              {/* 57: the old Work horizon, until each task has a horizon. */}
              {olderCount > 0 && (
                <button
                  type="button"
                  data-horizon={WORK_OLDER_ID}
                  className={`plan-rung plan-rung-older${selected === WORK_OLDER_ID ? " is-open" : ""}`}
                  aria-current={selected === WORK_OLDER_ID ? "true" : undefined}
                  onClick={() => pickRung(WORK_OLDER_ID)}
                >
                  <span className="plan-rung-top">
                    <span className="plan-rung-name">Work · older</span>
                    <span className="plan-rung-count">{olderCount}</span>
                  </span>
                  <span className="plan-rung-date">Give each a horizon, once.</span>
                  <span className="plan-rung-chevron" aria-hidden="true"><IconChevronRight size={18} /></span>
                </button>
              )}
            </nav>

            {/* The open rung's list (57): name, its range, days and tasks;
                rows; a "Done · N" fold (42.2); "+ Add to …" at the foot. */}
            {!frontOpen && (
            <section className="plan-open" aria-labelledby={`plan-h-${selected}`}>
              {narrow && (
                <button type="button" className="plan-open-back" onClick={() => setPhoneList(false)}>
                  <IconChevronLeft size={18} aria-hidden="true" /> Plan
                </button>
              )}
              <h2 className="plan-open-title" id={`plan-h-${selected}`}>{shownColumns[0].label}</h2>
              {selectedRung && selected !== WORK_OLDER_ID && (
                <p className="plan-open-meta">
                  {dayLabel(selectedRung.period.start, lociDay).replace(/^[A-Z]{3} /, "")} – {dayLabel(selectedRung.period.end, lociDay).replace(/^[A-Z]{3} /, "")}
                  {!selectedRung.dotted && ` · ${selectedRung.daysLeft} ${selectedRung.daysLeft === 1 ? "DAY" : "DAYS"} LEFT`}
                  {` · ${shownColumns[0].tasks.length} ${shownColumns[0].tasks.length === 1 ? "TASK" : "TASKS"}`}
                </p>
              )}
              {(() => {
                const rv = reviews.find(x => x.id === selected);
                return rv && onOpenReview && (
                  <button type="button" className="plan-open-review" onClick={onOpenReview}>
                    {rv.tasks.length} from {rv.from.charAt(0) + rv.from.slice(1).toLowerCase()} · Review
                  </button>
                );
              })()}
              {/* 57: Work · older — Sort gives each a horizon, once (57b.27). */}
              {selected === WORK_OLDER_ID && shownColumns[0].tasks.length > 0 && (
                <button type="button" className="plan-open-review" onClick={() => setSorting(true)}>Sort</button>
              )}
              <SortableRoadmapList
                colKey={shownColumns[0].key}
                colTasks={shownColumns[0].tasks}
                fullColTasks={shownColumns[0].allTasks}
                tasks={tasks}
                payload={payload}
                savePayload={savePayload}
                onTaskClick={openTask}
                onDone={handleMarkDone}
                isGoal={isGoal}
                frontNameOf={frontNameOf}
                leftTags={leftTags}
                openUuid={detailUuid}
                onRungHover={setDropRung}
                onDropOnRung={(task, id) => {
                  const to = rungs.find(x => x.id === id);
                  if (to && task.horizonLevel !== id) handleChangeHorizon(task, id, to.name);
                }}
              />
              {(() => {
                const done = selectedRung ? doneTasks(tasks, selected, selectedRung.period) : [];
                if (!done.length) return null;
                return (
                  <div className="plan-done">
                    <button type="button" className="plan-done-toggle" aria-expanded={doneOpen} onClick={() => setDoneOpen(o => !o)}>
                      Done · {done.length}
                    </button>
                    {doneOpen && (
                      <ul className="plan-done-list">
                        {done.map(t => <li key={t.uuid} className="plan-done-row">{t.title}</li>)}
                      </ul>
                    )}
                  </div>
                );
              })()}
              {!shownColumns[0].noAdd && (
                <button type="button" className="plan-open-add" onClick={() => onOpenAddTask(selected)}>
                  <IconPlus size={18} aria-hidden="true" /> Add to {shownColumns[0].label}
                </button>
              )}
            </section>
            )}
            {/* ≥1600 (57a): the Fronts column; a front's page takes the
                list's place (57b.25). */}
            {frontsColumn}
          </div>
        </>
      )}
      {/* Mind Box's notes wait below the horizons (45h has none on top). */}

      {/* A task, opened (52h): the sheet on phones and tablets, the drawer
          from 1024px. */}
      {detailTask && !drawerViewport && <div className="task-detail-scrim" onClick={closeDetail} aria-hidden="true" />}
      {detailTask && (
        <div onKeyDown={onDetailKeyDown}>
          <TaskDetail
            key={detailTask.uuid}
            task={detailTask}
            variant={drawerViewport ? "drawer" : "sheet"}
            kicker={`${detailCol.label.toUpperCase()} · ${detailIndex + 1} OF ${detailCol.tasks.length}`}
            horizonChoices={horizonChoices(config, lociDay)}
            isGoal={isGoal(detailTask)}
            fronts={frontsOnOffer(fronts, detailTask.frontId)}
            onClose={closeDetail}
            onPatch={patch => (patch.horizonLevel && patch.horizonLevel !== detailTask.horizonLevel
              ? handleChangeHorizon(detailTask, patch.horizonLevel)
              : patchTask(detailTask.uuid, patch))}
            onSetSteps={(steps, meta) => handleSetSteps(detailTask, steps, meta)}
            onDone={() => leaving(detailTask, handleMarkDone)}
            onMoveToToday={() => leaving(detailTask, handleMoveToToday)}
            onTogglePin={() => handleTogglePin(detailTask)}
            onPark={() => leaving(detailTask, handlePark)}
            onDelete={() => leaving(detailTask, handleDelete)}
          />
        </div>
      )}

      {sorting && (
        <HorizonReview
          sort={{ tasks: listTasks(tasks, WORK_OLDER_ID), horizons: rungs.map(x => ({ id: x.id, name: x.name })) }}
          onClose={() => setSorting(false)}
          onDone={choices => {
            const before = payloadRef.current;
            // Drops named for the sync's drop guard (three at once would write nothing).
            const drops = Object.keys(choices).filter(uuid => choices[uuid] === "drop");
            setSorting(false);
            savePayloadAsync(applySort(before, choices), { expectedRemovals: drops })
              .then(() => setSortUndo({ before, uuids: Object.keys(choices), at: Date.now() }))
              .catch(() => {});
          }}
        />
      )}
      <UndoAnnouncer message={sortUndo ? "Sorted Work · older" : ""} />
      {sortUndo && (
        <UndoToast key={sortUndo.at} ms={10000} message="Sorted Work · older"
          onUndo={() => { savePayload(undoReviewOrSort(payloadRef.current, sortUndo.before, sortUndo.uuids)); setSortUndo(null); }}
          onClose={() => setSortUndo(null)} />
      )}
      <UndoAnnouncer message={undoText} />
      {undo && <UndoToast key={undo.at} message={undoText} onUndo={handleUndo} onClose={() => setUndo(null)} />}
    </div>
  );
}
