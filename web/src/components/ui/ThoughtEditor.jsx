import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { IconBold, IconSmile, IconUnderline } from "./icons";
import { parseThought, plainThought, serializeRuns } from "../../utils/thoughtFormat";
import { THOUGHT_MAX_CHARS } from "../../utils/thoughts";
import { highlightFromPaint, highlightNotebookSelection, highlightPaint, notebookDraft, notebookNewline, notebookRuns, notebookText, normalizeHighlights, THOUGHT_HIGHLIGHTS, toggleNotebookList } from "../../utils/thoughtNotebook";
import "../../styles/thoughtEditor.css";

// 78 §5: the Brain dump editor, shared by Mind Box and Today's Add › Thought.
// Ruled lines; quick capture uses Enter to save, notebook mode uses Ctrl/⌘+Enter;
// Enter continues notebook lists and Shift+Enter makes a plain new line. B and U (and
// Ctrl/⌘ B, U) toggle the selection or what you type next; an emoji picker
// opens below the footer. The text is stored with **bold** / __underline__
// markers and shown without them.

export const THOUGHT_EMOJI = "😀 😂 🤔 😤 😩 😴 🤯 💡 🔥 ✅ ❗ ❓ ❤️ 👍 👎 🙏 🎉 😬 😌 🧠 ⏰ 💰 📌 🚀".split(" ");
const EMOJI_COLS = 8;

const exec = (cmd, arg) => {
  try { return document.execCommand?.(cmd, false, arg) ?? false; } catch { return false; }
};
const isOn = (cmd) => {
  try { return !!document.queryCommandState?.(cmd); } catch { return false; }
};

// The field's DOM → runs of text with their style.
function readRuns(root) {
  const runs = [];
  const push = (text, s) => runs.push({ text, b: s.b, u: s.u, ...(s.h ? { h: s.h } : {}) });
  const walk = (node, s) => {
    if (node.nodeType === 3) { if (node.data) push(node.data.replace(/\u00a0/g, " "), s); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === "BR") { if (!node.hasAttribute("data-te-tail")) push("\n", s); return; }
    const block = tag === "DIV" || tag === "P";
    const text = runs.map(r => r.text).join("");
    if (block && text && !text.endsWith("\n")) push("\n", s);
    const st = node.style || {};
    const next = {
      b: s.b || tag === "B" || tag === "STRONG" || st.fontWeight === "bold" || Number(st.fontWeight) >= 600,
      u: s.u || tag === "U" || /underline/.test(st.textDecoration || st.textDecorationLine || ""),
      h: st.backgroundColor ? highlightFromPaint(st.backgroundColor) : s.h,
    };
    node.childNodes.forEach(c => walk(c, next));
  };
  root.childNodes.forEach(c => walk(c, { b: false, u: false }));
  return runs;
}

// Stored text → the field's DOM (no innerHTML: the text is the person's own).
function writeRuns(root, text, highlights = []) {
  root.replaceChildren();
  const runs = notebookRuns(text, highlights);
  runs.forEach(r => {
    let host = root;
    if (r.h) { const mark = document.createElement("mark"); mark.style.backgroundColor = highlightPaint(r.h); mark.style.color = "inherit"; host.appendChild(mark); host = mark; }
    if (r.b) { const b = document.createElement("b"); host.appendChild(b); host = b; }
    if (r.u) { const u = document.createElement("u"); host.appendChild(u); host = u; }
    r.text.split("\n").forEach((part, i) => {
      if (i > 0) host.appendChild(document.createElement("br"));
      if (part) host.appendChild(document.createTextNode(part));
    });
  });
  // A last line break needs a second <br> to show its empty line.
  if (notebookText(text).endsWith("\n")) { const tail = document.createElement("br"); tail.setAttribute("data-te-tail", ""); root.appendChild(tail); }
}

function fieldSelection(root) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return { start: 0, end: 0 };
  const range = selection.getRangeAt(0);
  const offset = (node, at) => {
    const before = document.createRange();
    before.selectNodeContents(root);
    before.setEnd(node, at);
    return readRuns(before.cloneContents()).reduce((n, r) => n + r.text.length, 0);
  };
  return { start: offset(range.startContainer, range.startOffset), end: offset(range.endContainer, range.endOffset) };
}

function restoreFieldSelection(root, start, end) {
  const point = position => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n; let offset = 0;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 3) {
        if (position <= offset + n.data.length) return [n, Math.max(0, position - offset)];
        offset += n.data.length;
      } else if (n.tagName === "BR" && !n.hasAttribute("data-te-tail")) {
        // A caret on an empty line belongs before its next <br>, rather than
        // at the next text node (which may be several blank lines later).
        if (position === offset) return [n.parentNode, [...n.parentNode.childNodes].indexOf(n)];
        offset += 1;
      }
    }
    return [root, Math.max(0, root.childNodes.length - (root.lastChild?.hasAttribute?.("data-te-tail") ? 1 : 0))];
  };
  const range = document.createRange();
  range.setStart(...point(start));
  range.setEnd(...point(end));
  const selection = window.getSelection();
  selection.removeAllRanges(); selection.addRange(range);
}

const plainLength = (text) => parseThought(text).reduce((n, r) => n + r.text.length, 0);

const ThoughtEditor = forwardRef(function ThoughtEditor({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  label = "Thought",
  placeholder = "What\u2019s on your mind?",
  hint = <>ENTER SAVES<span className="te-hint-more"> · SHIFT+ENTER NEW LINE</span></>,
  saveLabel = "Save thought",
  saveDisabled = false,
  maxLength = THOUGHT_MAX_CHARS,
  notebook = false,
  highlights = [],
  disabled = false,
  // 78 §6: at 50 the field gives way to this line; what was typed is kept.
  fullMessage = null,
  autoFocus = false,
  className = "",
  fieldClassName = "",
}, ref) {
  const fieldRef = useRef(null);
  const emitted = useRef(null);
  const emittedHighlights = useRef("");
  const savedRange = useRef(null);
  const [focused, setFocused] = useState(false);
  const [marks, setMarks] = useState({ b: false, u: false });
  const [emojiAt, setEmojiAt] = useState(-1); // -1: closed
  const emojiRefs = useRef([]);
  const [formatOpen, setFormatOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const formatRef = useRef(null);
  const newlineRef = useRef(null);
  const highlightKey = JSON.stringify(normalizeHighlights(highlights, notebookText(value)));
  // Visible text only: bold spaces ("** **") are still empty.
  const empty = !plainThought(value);
  const off = disabled || !!fullMessage;

  // Show a value that came from outside (cleared after Save, a prefill).
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el || (value === emitted.current && highlightKey === emittedHighlights.current)) return;
    writeRuns(el, String(value || ""), JSON.parse(highlightKey));
    emitted.current = value;
    emittedHighlights.current = highlightKey;
  }, [value, highlightKey]);

  const emit = useCallback(() => {
    const el = fieldRef.current;
    if (!el) return;
    const draft = notebookDraft(readRuns(el));
    const next = notebook ? draft.text : serializeRuns(readRuns(el));
    const paint = JSON.stringify(draft.highlights);
    if (next === emitted.current && (!notebook || paint === emittedHighlights.current)) return;
    emitted.current = next;
    emittedHighlights.current = paint;
    if (notebook) onChange?.(next, draft.highlights); else onChange?.(next);
  }, [onChange, notebook]);

  const refreshMarks = useCallback(() => {
    if (document.activeElement !== fieldRef.current) return;
    setMarks(m => {
      const b = isOn("bold"); const u = isOn("underline");
      return m.b === b && m.u === u ? m : { b, u };
    });
  }, []);

  const caretToEnd = () => {
    const el = fieldRef.current;
    const sel = window.getSelection?.();
    if (!el || !sel) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  };

  useImperativeHandle(ref, () => ({
    focus: () => { fieldRef.current?.focus(); caretToEnd(); },
    get element() { return fieldRef.current; },
  }), []);

  useEffect(() => {
    if (autoFocus && !off) { fieldRef.current?.focus(); caretToEnd(); }
    // Mount only: autofocus is a first-open thing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => { if (!off && !empty && !saveDisabled && plainLength(value) <= maxLength) onSubmit?.(); };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  // Phones send Return as beforeinput (insertParagraph), not always as a
  // keydown Enter. A long thought stops at maxLength.
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return undefined;
    const onBefore = (e) => {
      if (e.inputType === "insertParagraph" && !e.isComposing) { e.preventDefault(); if (notebook) newlineRef.current?.(true); else submitRef.current(); return; }
      if (!e.inputType?.startsWith("insert")) return;
      const sel = window.getSelection?.();
      const replaced = sel && !sel.isCollapsed ? sel.toString().length : 0;
      const added = (e.data ?? e.dataTransfer?.getData("text/plain") ?? "x").length;
      // A composition can't always be cancelled; Save stays disabled above the cap.
      if (plainLength(emitted.current || "") - replaced + added > maxLength && e.cancelable) e.preventDefault();
    };
    el.addEventListener("beforeinput", onBefore);
    return () => el.removeEventListener("beforeinput", onBefore);
  }, [maxLength, notebook]);
  useEffect(() => {
    if (!focused) return undefined;
    document.addEventListener("selectionchange", refreshMarks);
    return () => document.removeEventListener("selectionchange", refreshMarks);
  }, [focused, refreshMarks]);

  const toggle = (cmd) => {
    if (off) return;
    if (document.activeElement !== fieldRef.current) fieldRef.current?.focus();
    exec(cmd);
    emit();
    refreshMarks();
  };

  const handleKeyDown = (e) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const mod = e.metaKey || e.ctrlKey;
    if (notebook && e.key === "Enter" && mod && !e.altKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); return; }
    if (e.key === "Enter" && !e.nativeEvent.isComposing && !mod && !e.altKey) {
      if (notebook) { e.preventDefault(); newlineRef.current?.(!e.shiftKey); return; }
      if (e.shiftKey) return;
      e.preventDefault();
      submit();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey && (e.key === "b" || e.key === "B" || e.key === "u" || e.key === "U")) {
      e.preventDefault();
      toggle(e.key.toLowerCase() === "b" ? "bold" : "underline");
    }
  };

  const insertPlain = (text) => {
    const room = Math.max(0, maxLength - plainLength(emitted.current || ""));
    const sel = window.getSelection?.();
    const replacing = sel && !sel.isCollapsed ? sel.toString().length : 0;
    // Cut at whole characters: half an emoji would save as a broken glyph.
    let clip = "";
    for (const ch of text) {
      if (clip.length + ch.length > room + replacing) break;
      clip += ch;
    }
    if (clip) exec("insertText", clip);
    emit();
  };

  // Emoji: remember the caret, move into the grid, put the caret back.
  const openEmoji = () => {
    if (off) return;
    setFormatOpen(false);
    if (emojiAt >= 0) { closeEmoji(); return; }
    const sel = window.getSelection?.();
    if (sel?.rangeCount && fieldRef.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
    else savedRange.current = null;
    setEmojiAt(0);
  };
  useEffect(() => { if (emojiAt >= 0) emojiRefs.current[emojiAt]?.focus(); }, [emojiAt]);
  const backToField = () => {
    const el = fieldRef.current;
    el?.focus();
    const sel = window.getSelection?.();
    if (savedRange.current && sel) { sel.removeAllRanges(); sel.addRange(savedRange.current); } else caretToEnd();
  };
  const closeEmoji = () => { setEmojiAt(-1); backToField(); };
  const pickEmoji = (emoji) => {
    setEmojiAt(-1);
    backToField();
    insertPlain(emoji);
  };
  const applyNotebookEdit = result => {
    const field = fieldRef.current;
    const draft = notebookDraft(result.runs);
    if (!field || notebookText(draft.text).length > maxLength) return;
    const box = document.createElement("div");
    writeRuns(box, draft.text, draft.highlights);
    field.focus();
    const range = document.createRange(); range.selectNodeContents(field);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    // HTML is generated solely from text nodes and our allowlisted marks.
    // Using the browser command keeps list/newline changes in native Undo.
    if (!exec("insertHTML", box.innerHTML)) writeRuns(field, draft.text, draft.highlights);
    restoreFieldSelection(field, result.start, result.end);
    savedRange.current = null;
    emit(); refreshMarks();
  };
  newlineRef.current = continueList => {
    const field = fieldRef.current;
    if (!field) return;
    const { start, end } = fieldSelection(field);
    applyNotebookEdit(notebookNewline(readRuns(field), start, end, continueList));
  };
  const openFormat = () => {
    if (formatOpen) { setFormatOpen(false); backToField(); return; }
    const sel = window.getSelection();
    savedRange.current = sel?.rangeCount && fieldRef.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    setEmojiAt(-1); setFormatOpen(true);
  };
  useEffect(() => { if (formatOpen) formatRef.current?.querySelector("button")?.focus(); }, [formatOpen]);
  const formatAction = action => {
    backToField(); setFormatOpen(false); action();
  };
  const makeList = kind => formatAction(() => {
    const field = fieldRef.current;
    const { start, end } = fieldSelection(field);
    applyNotebookEdit(toggleNotebookList(readRuns(field), start, end, kind));
  });
  const paintSelection = color => formatAction(() => {
    const field = fieldRef.current;
    const { start, end } = fieldSelection(field);
    applyNotebookEdit(highlightNotebookSelection(readRuns(field), start, end, color));
  });
  const emojiKeys = (e) => {
    const n = THOUGHT_EMOJI.length;
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: EMOJI_COLS, ArrowUp: -EMOJI_COLS }[e.key];
    if (move) {
      e.preventDefault();
      const next = emojiAt + move;
      if (next >= 0 && next < n) setEmojiAt(next);
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeEmoji(); return; }
    if (e.key === "Tab") { setEmojiAt(-1); }
  };

  const keepFocus = (e) => e.preventDefault();

  return (
    <div className={`te${notebook ? " is-notebook" : ""}${expanded ? " is-expanded" : ""}${focused ? " is-focused" : ""}${off ? " is-disabled" : ""}${fullMessage ? " is-full" : ""} ${className}`.trim()}>
      <div className="te-box">
        {fullMessage && <p className="te-full">{fullMessage}</p>}
        <div
          ref={fieldRef}
          className={`te-field${empty ? " is-empty" : ""} ${fieldClassName}`.trim()}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          aria-disabled={off || undefined}
          hidden={!!fullMessage}
          data-placeholder={placeholder}
          contentEditable={!off}
          suppressContentEditableWarning
          enterKeyHint={notebook ? "enter" : "done"}
          spellCheck
          tabIndex={off ? -1 : 0}
          onInput={() => { emit(); refreshMarks(); }}
          onKeyDown={handleKeyDown}
          onKeyUp={refreshMarks}
          onMouseUp={refreshMarks}
          onFocus={() => { setFocused(true); exec("styleWithCSS", false); refreshMarks(); }}
          onBlur={() => setFocused(false)}
          onPaste={(e) => { e.preventDefault(); insertPlain(e.clipboardData?.getData("text/plain") || ""); }}
          onDrop={(e) => e.preventDefault()}
        />
        <div className="te-foot">
          <button type="button" className={`te-tool te-basic${marks.b && focused ? " is-on" : ""}`} aria-label="Bold" title="Bold (Ctrl+B)"
            aria-pressed={marks.b && focused} disabled={off} onMouseDown={keepFocus} onClick={() => toggle("bold")}>
            <IconBold size={18} />
          </button>
          <button type="button" className={`te-tool te-basic${marks.u && focused ? " is-on" : ""}`} aria-label="Underline" title="Underline (Ctrl+U)"
            aria-pressed={marks.u && focused} disabled={off} onMouseDown={keepFocus} onClick={() => toggle("underline")}>
            <IconUnderline size={18} />
          </button>
          {notebook && <button type="button" className="te-tool" aria-label="Formatting" title="Lists and highlights" aria-expanded={formatOpen} disabled={off} onMouseDown={keepFocus} onClick={openFormat}>Aa</button>}
          <button type="button" className={`te-tool${emojiAt >= 0 ? " is-on" : ""}`} aria-label="Emoji" title="Emoji"
            aria-expanded={emojiAt >= 0} aria-haspopup="true" disabled={off} onMouseDown={keepFocus} onClick={openEmoji}>
            <IconSmile size={18} />
          </button>
          {notebook && <button type="button" className="te-tool" aria-label={expanded ? "Reduce writing area" : "Expand writing area"} aria-expanded={expanded} disabled={off} onMouseDown={keepFocus} onClick={() => setExpanded(v => !v)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={expanded ? "M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" : "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"} /></svg>
          </button>}
          <span className="te-hint" aria-hidden="true">{notebook ? "CTRL/⌘+ENTER SAVES" : hint}</span>
          <button type="button" className="te-save" disabled={off || empty || saveDisabled || plainLength(value) > maxLength} onMouseDown={keepFocus} onClick={submit}>{saveLabel}</button>
        </div>
      </div>
      {notebook && !fullMessage && <div className="te-count" aria-live="off">{plainLength(value)} / {maxLength} characters</div>}
      {formatOpen && (
        <div ref={formatRef} className="te-format" role="group" aria-label="Thought formatting"
          onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFormatOpen(false); }}
          onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setFormatOpen(false); backToField(); } }}>
          <div className="te-format-actions">
            <button type="button" onMouseDown={keepFocus} onClick={() => formatAction(() => toggle("bold"))}>Bold</button>
            <button type="button" onMouseDown={keepFocus} onClick={() => formatAction(() => toggle("underline"))}>Underline</button>
            <button type="button" onMouseDown={keepFocus} onClick={() => makeList("bullet")}>Bulleted list</button>
            <button type="button" onMouseDown={keepFocus} onClick={() => makeList("number")}>Numbered list</button>
          </div>
          <div className="te-highlight-colors" role="group" aria-label="Highlight colour">
            {THOUGHT_HIGHLIGHTS.map(h => <button key={h.color} type="button" style={{ backgroundColor: h.paint }} disabled={!savedRange.current || savedRange.current.collapsed} onMouseDown={keepFocus} onClick={() => paintSelection(h.color)}>{h.label} highlight</button>)}
            <button type="button" disabled={!savedRange.current || savedRange.current.collapsed} onMouseDown={keepFocus} onClick={() => paintSelection(null)}>Remove highlight</button>
          </div>
          <p className="te-count">Select text to highlight it.</p>
        </div>
      )}
      {emojiAt >= 0 && (
        <div className="te-emoji" role="group" aria-label="Emoji" onKeyDown={emojiKeys}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setEmojiAt(-1); }}>
          <div className="te-emoji-grid">
            {THOUGHT_EMOJI.map((emoji, i) => (
              <button key={emoji} type="button" ref={el => { emojiRefs.current[i] = el; }}
                className={`te-emoji-cell${i === emojiAt ? " is-at" : ""}`} tabIndex={i === emojiAt ? 0 : -1}
                onMouseDown={keepFocus} onClick={() => pickEmoji(emoji)} onFocus={() => setEmojiAt(i)}>
                {emoji}
              </button>
            ))}
          </div>
          <p className="te-emoji-hint" aria-hidden="true">ARROWS MOVE · ENTER ADDS · ESC CLOSES</p>
        </div>
      )}
    </div>
  );
});

export default ThoughtEditor;
