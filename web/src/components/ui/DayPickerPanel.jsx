import React from "react";
import { DayPicker } from "@daypicker/react";
import "@daypicker/react/style.css";
import { dateToYmd, localeWeekStart, ymdToDate } from "../../utils/dateField";

// The calendar inside DateField's popover. Loaded only when a calendar is
// first opened (React.lazy), so phones and first paint never download it.
export default function DayPickerPanel({ value, min, today, onPick }) {
  const selected = ymdToDate(value) || undefined;
  const minDate = ymdToDate(min);
  const todayDate = ymdToDate(today) || undefined;
  return (
    <DayPicker
      mode="single"
      required
      selected={selected}
      onSelect={(d) => d && onPick(dateToYmd(d))}
      defaultMonth={selected || todayDate}
      today={todayDate}
      disabled={minDate ? { before: minDate } : undefined}
      weekStartsOn={localeWeekStart()}
      showOutsideDays
      autoFocus
    />
  );
}
