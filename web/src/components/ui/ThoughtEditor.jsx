import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { IconBold, IconSmile, IconUnderline } from "./icons";
import { parseThought, serializeRuns } from "../../utils/thoughtFormat";
import "../../styles/thoughtEditor.css";

// 78 §5: the Brain dump editor, shared by Mind Box and Today's Add › Thought.
// Ruled lines; Enter saves, Shift+Enter makes a new line; B and U (and
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
  const push = (text, s) => runs.push({ text, b: s.b, u: s.u });
  const walk = (node, s) => {
    if (node.nodeType === 3) { if (node.data) push(node.data.replace(/\u00a0/g, " "), s); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (tag === "BR") { push("\n", s); return; }
    const block = tag === "DIV" || tag === "P";
    const text = runs.map(r => r.text).join("");
    if (block && text && !text.endsWith("\n")) push("\n", s);
    const st = node.style || {};
    const next = {
      b: s.b || tag === "B" || tag === "STRONG" || st.fontWeight === "bold" || Number(st.fontWeight) >= 600,
      u: s.u || tag === "U" || /underline/.test(st.textDecoration || st.textDecorationLine || ""),
    };
    node.childNodes.forEach(c => walk(c, next));
  };
  root.childNodes.forEach(c => walk(c, { b: false, u: false }));
  return runs;
}

// Stored text → the field's DOM (no innerHTML: the text is the person's own).
function writeRuns(root, text) {
  root.replaceChildren();
  const runs = parseThought(text);
  runs.forEach(r => {
    let host = root;
    if (r.b) { const b = document.createElement("b"); host.appendChild(b); host = b; }
    if (r.u) { const u = document.createElement("u"); host.appendChild(u); host = u; }
    r.text.split("\n").forEach((part, i) => {
      if (i > 0) host.appendChild(document.createElement("br"));
      if (part) host.appendChild(document.createTextNode(part));
    });
  });
  // A last line break needs a second <br> to show its empty line.
  if (text.endsWith("\n")) root.appendChild(document.createElement("br"));
}

const plainLength = (text) => parseThought(text).reduce((n, r) => n + r.text.length, 0);

const ThoughtEditor = forwardRef(function ThoughtEditor({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  label = "Thought",
  placeholder = "What\u2019s on your mind?",
  hint = "ENTER SAVES · SHIFT+ENTER NEW LINE",
  saveLabel = "Save thought",
  maxLength = 500,
  disabled = false,
  autoFocus = false,
  className = "",
  fieldClassName = "",
}, ref) {
  const fieldRef = useRef(null);
  const emitted = useRef(null);
  const savedRange = useRef(null);
  const [focused, setFocused] = useState(false);
  const [marks, setMarks] = useState({ b: false, u: false });
  const [emojiAt, setEmojiAt] = useState(-1); // -1: closed
  const emojiRefs = useRef([]);
  const empty = !String(value || "").trim();

  // Show a value that came from outside (cleared after Save, a prefill).
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el || value === emitted.current) return;
    writeRuns(el, String(value || ""));
    emitted.current = value;
  }, [value]);

  const emit = useCallback(() => {
    const el = fieldRef.current;
    if (!el) return;
    const next = serializeRuns(readRuns(el));
    if (next === emitted.current) return;
    emitted.current = next;
    onChange?.(next);
  }, [onChange]);

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
    if (autoFocus && !disabled) { fieldRef.current?.focus(); caretToEnd(); }
    // Mount only: autofocus is a first-open thing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = () => { if (!disabled && !empty) onSubmit?.(); };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  // Phones send Return as beforeinput (insertParagraph), not always as a
  // keydown Enter. A long thought stops at maxLength.
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return undefined;
    const onBefore = (e) => {
      if (e.inputType === "insertParagraph") { e.preventDefault(); submitRef.current(); return; }
      if (!e.inputType?.startsWith("insert")) return;
      const sel = window.getSelection?.();
      const replacing = sel && !sel.isCollapsed;
      if (!replacing && plainLength(emitted.current || "") >= maxLength) e.preventDefault();
    };
    el.addEventListener("beforeinput", onBefore);
    return () => el.removeEventListener("beforeinput", onBefore);
  }, [maxLength]);
  useEffect(() => {
    if (!focused) return undefined;
    document.addEventListener("selectionchange", refreshMarks);
    return () => document.removeEventListener("selectionchange", refreshMarks);
  }, [focused, refreshMarks]);

  const toggle = (cmd) => {
    if (disabled) return;
    if (document.activeElement !== fieldRef.current) fieldRef.current?.focus();
    exec(cmd);
    emit();
    refreshMarks();
  };

  const handleKeyDown = (e) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Enter" && !e.nativeEvent.isComposing && !mod && !e.altKey) {
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
    if (disabled) return;
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
    <div className={`te${focused ? " is-focused" : ""}${disabled ? " is-disabled" : ""} ${className}`.trim()}>
      <div className="te-box">
        <div
          ref={fieldRef}
          className={`te-field${empty ? " is-empty" : ""} ${fieldClassName}`.trim()}
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          aria-disabled={disabled || undefined}
          data-placeholder={placeholder}
          contentEditable={!disabled}
          suppressContentEditableWarning
          enterKeyHint="done"
          spellCheck
          tabIndex={disabled ? -1 : 0}
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
          <button type="button" className={`te-tool${marks.b && focused ? " is-on" : ""}`} aria-label="Bold" title="Bold (Ctrl+B)"
            aria-pressed={marks.b && focused} disabled={disabled} onMouseDown={keepFocus} onClick={() => toggle("bold")}>
            <IconBold size={18} />
          </button>
          <button type="button" className={`te-tool${marks.u && focused ? " is-on" : ""}`} aria-label="Underline" title="Underline (Ctrl+U)"
            aria-pressed={marks.u && focused} disabled={disabled} onMouseDown={keepFocus} onClick={() => toggle("underline")}>
            <IconUnderline size={18} />
          </button>
          <button type="button" className={`te-tool${emojiAt >= 0 ? " is-on" : ""}`} aria-label="Emoji" title="Emoji"
            aria-expanded={emojiAt >= 0} aria-haspopup="true" disabled={disabled} onMouseDown={keepFocus} onClick={openEmoji}>
            <IconSmile size={18} />
          </button>
          <span className="te-hint" aria-hidden="true">{hint}</span>
          <button type="button" className="te-save" disabled={disabled || empty} onMouseDown={keepFocus} onClick={submit}>{saveLabel}</button>
        </div>
      </div>
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
