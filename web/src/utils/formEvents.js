// Submits the enclosing <form> when Enter is pressed in a multi-line textarea,
// without submitting on Shift+Enter (newline) or while an IME composition is in progress.
export function submitOnEnter(e) {
  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }
}
