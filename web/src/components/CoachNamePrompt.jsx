import React, { useState } from "react";
import "../styles/firstRun.css";

// #653: the coach's name is asked once, the first time a new account opens
// Coach (not during the welcome or the tour). Keep leaves the name as it is;
// Settings › Coach can change it any time.
export default function CoachNamePrompt({ currentName, onSave, onKeep }) {
  const [name, setName] = useState("");
  const shown = (currentName || "").trim() || "Your coach";
  return (
    <section className="cnp" aria-labelledby="cnp-title">
      <h2 id="cnp-title" className="cnp-title">Name your coach</h2>
      <p className="cnp-text">Your coach is called “{shown}” for now. Give it a name you’d like, or keep this one. You can change it any time in Settings.</p>
      <form className="cnp-row" onSubmit={e => { e.preventDefault(); if (name.trim()) onSave(name.trim()); }}>
        <label className="sr-only" htmlFor="cnp-name">Coach name</label>
        <input id="cnp-name" className="frw-input" value={name} maxLength={100} placeholder="e.g. Sage"
          onChange={e => setName(e.target.value)} />
        <button type="submit" className="frw-primary" disabled={!name.trim()}>Save</button>
      </form>
      <button type="button" className="frw-link cnp-keep" onClick={onKeep}>Keep “{shown}”</button>
    </section>
  );
}
